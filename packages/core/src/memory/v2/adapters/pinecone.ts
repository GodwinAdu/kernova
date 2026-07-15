/**
 * Pinecone Memory Adapter — Managed vector database implementation of MemoryAdapter.
 *
 * Features:
 *   - Native vector search via Pinecone's query API
 *   - Metadata-based filtering (namespace, layer, tags)
 *   - Pinecone namespace support for data partitioning
 *   - Serverless and pod-based index support
 *   - String IDs (native Pinecone support)
 *
 * Requires: @pinecone-database/pinecone (optional peer dependency).
 * Best for: Managed vector search, serverless deployments, production AI systems.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface PineconeAdapterConfig {
  /** Pinecone API key */
  apiKey: string;
  /** Index name (e.g., 'kernova-memories') */
  indexName: string;
  /** Pinecone namespace (default: '') */
  namespace?: string;
  /** Environment (for older Pinecone instances) */
  environment?: string;
}

export class PineconeMemoryAdapter implements MemoryAdapter {
  readonly name = 'pinecone';
  private client: any = null;
  private index: any = null;
  private config: PineconeAdapterConfig;
  private pineconeNamespace: string;
  private vectorSize = 1536;

  constructor(config: PineconeAdapterConfig) {
    this.config = config;
    this.pineconeNamespace = config.namespace || '';
  }

  async initialize(): Promise<void> {
    let pinecone: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      pinecone = require('@pinecone-database/pinecone');
    } catch {
      try {
        pinecone = await (Function('m', 'return import(m)')('@pinecone-database/pinecone'));
      } catch {
        throw new Error(
          'Pinecone adapter requires "@pinecone-database/pinecone" package. Install: npm install @pinecone-database/pinecone'
        );
      }
    }

    const Pinecone = pinecone.Pinecone || pinecone.default?.Pinecone;
    this.client = new Pinecone({ apiKey: this.config.apiKey });
    this.index = this.client.index(this.config.indexName);

    // Attempt to describe the index to verify connectivity and get vector dimensions
    try {
      const description = await this.client.describeIndex(this.config.indexName);
      if (description?.dimension) {
        this.vectorSize = description.dimension;
      }
    } catch {
      // Index might not be accessible yet — continue with default vector size
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const ns = this.getNamespaceIndex();
    const vector = entry.embedding?.length ? entry.embedding : new Array(this.vectorSize).fill(0);

    await ns.upsert([{
      id: entry.id,
      values: vector,
      metadata: this.entryToMetadata(entry),
    }]);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const ns = this.getNamespaceIndex();

    const vectors = entries.map(entry => ({
      id: entry.id,
      values: entry.embedding?.length ? entry.embedding : new Array(this.vectorSize).fill(0),
      metadata: this.entryToMetadata(entry),
    }));

    // Pinecone upsert supports up to 100 vectors per request
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await ns.upsert(batch);
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const ns = this.getNamespaceIndex();
    try {
      const result = await ns.fetch([id]);
      const record = result?.records?.[id];
      if (!record) return null;
      return this.recordToEntry(id, record);
    } catch {
      return null;
    }
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const ns = this.getNamespaceIndex();
    try {
      const result = await ns.fetch(ids);
      const entries: MemoryEntry[] = [];
      for (const id of ids) {
        const record = result?.records?.[id];
        if (record) {
          entries.push(this.recordToEntry(id, record));
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    const ns = this.getNamespaceIndex();
    await ns.deleteOne(id);
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const ns = this.getNamespaceIndex();
    await ns.deleteMany(ids);
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    // Pinecone doesn't support count before delete, so we query first
    const ns = this.getNamespaceIndex();
    const pineconeFilter = this.buildMetadataFilter(filter);

    // Query to get IDs matching the filter
    const zeroVector = new Array(this.vectorSize).fill(0);
    const results = await ns.query({
      vector: zeroVector,
      topK: 10000,
      filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      includeMetadata: false,
    });

    const ids = (results.matches || []).map((m: any) => m.id);
    if (ids.length === 0) return 0;

    await ns.deleteMany(ids);
    return ids.length;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const merged: MemoryEntry = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.store(merged);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    const ns = this.getNamespaceIndex();

    try {
      // Try using describeIndexStats for total count
      if (!filter) {
        const stats = await this.index.describeIndexStats();
        const nsStats = stats?.namespaces?.[this.pineconeNamespace || ''];
        return nsStats?.recordCount || 0;
      }
    } catch {
      // Fall through to query-based count
    }

    // Query-based count with filter
    const pineconeFilter = filter ? this.buildMetadataFilter(filter) : undefined;
    const zeroVector = new Array(this.vectorSize).fill(0);
    const results = await ns.query({
      vector: zeroVector,
      topK: 10000,
      filter: pineconeFilter && Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      includeMetadata: false,
    });

    return results.matches?.length || 0;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    const ns = this.getNamespaceIndex();
    const filter = this.buildSearchFilter(options);

    const results = await ns.query({
      vector: embedding,
      topK: options.limit,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      includeMetadata: true,
      includeValues: true,
    });

    return (results.matches || [])
      .filter((m: any) => {
        // Filter by min score
        if (options.minScore && (m.score || 0) < options.minScore) return false;
        // Exclude expired entries
        const expiresAt = m.metadata?.expiresAt;
        if (expiresAt && expiresAt <= new Date().toISOString()) return false;
        return true;
      })
      .map((m: any) => ({
        entry: this.matchToEntry(m),
        similarity: m.score || 0,
      }));
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Pinecone doesn't have native text search — fetch entries and filter in JS
    const ns = this.getNamespaceIndex();
    const filter = this.buildSearchFilter(options);
    const queryLower = query.toLowerCase();

    // Use zero vector to fetch entries with metadata filter
    const zeroVector = new Array(this.vectorSize).fill(0);
    const results = await ns.query({
      vector: zeroVector,
      topK: 10000,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      includeMetadata: true,
      includeValues: true,
    });

    const matches: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const m of results.matches || []) {
      const content = m.metadata?.content || '';
      if (typeof content === 'string' && content.toLowerCase().includes(queryLower)) {
        const entry = this.matchToEntry(m);
        // Skip expired
        if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
        // Simple scoring based on position
        const idx = content.toLowerCase().indexOf(queryLower);
        const positionScore = 1 - (idx / Math.max(content.length, 1));
        matches.push({ entry, score: Math.min(positionScore * 0.8, 1) });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, options.limit);
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    const ns = this.getNamespaceIndex();
    const filter = this.buildSearchFilter(options);

    // Pinecone requires a vector for any query — use zero vector
    const zeroVector = new Array(this.vectorSize).fill(0);
    const limit = (options.limit || 50) + (options.offset || 0);

    const results = await ns.query({
      vector: zeroVector,
      topK: Math.min(limit, 10000),
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      includeMetadata: true,
      includeValues: true,
    });

    let entries = (results.matches || [])
      .map((m: any) => this.matchToEntry(m))
      .filter((e: MemoryEntry) => !e.expiresAt || e.expiresAt > new Date().toISOString());

    // Sort
    const orderBy = options.orderBy || 'createdAt';
    const order = options.order || 'desc';
    entries.sort((a: MemoryEntry, b: MemoryEntry) => {
      const aVal = orderBy === 'relevance' ? a.relevance : (a as any)[orderBy] || '';
      const bVal = orderBy === 'relevance' ? b.relevance : (b as any)[orderBy] || '';
      if (order === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return bVal < aVal ? -1 : bVal > aVal ? 1 : 0;
    });

    const offset = options.offset || 0;
    return entries.slice(offset, offset + (options.limit || 50));
  }

  async expireEntries(): Promise<number> {
    const ns = this.getNamespaceIndex();
    const now = new Date().toISOString();

    // Query all entries and filter expired ones
    const zeroVector = new Array(this.vectorSize).fill(0);
    const results = await ns.query({
      vector: zeroVector,
      topK: 10000,
      includeMetadata: true,
    });

    const expiredIds = (results.matches || [])
      .filter((m: any) => m.metadata?.expiresAt && m.metadata.expiresAt <= now)
      .map((m: any) => m.id);

    if (expiredIds.length === 0) return 0;

    await ns.deleteMany(expiredIds);
    return expiredIds.length;
  }

  async close(): Promise<void> {
    // Pinecone client doesn't require explicit close
    this.client = null;
    this.index = null;
  }

  // ─── Private ───────────────────────────────────────────

  private getNamespaceIndex(): any {
    if (this.pineconeNamespace) {
      return this.index.namespace(this.pineconeNamespace);
    }
    return this.index;
  }

  private entryToMetadata(entry: MemoryEntry): Record<string, any> {
    return {
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: entry.tags || [],
      metadata: JSON.stringify(entry.metadata || {}),
      relevance: entry.relevance ?? 0.7,
      confidence: entry.confidence ?? 0.8,
      accessCount: entry.accessCount || 0,
      lastAccessedAt: entry.lastAccessedAt || new Date().toISOString(),
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      ttl: entry.ttl || 0,
      expiresAt: entry.expiresAt || '',
    };
  }

  private recordToEntry(id: string, record: any): MemoryEntry {
    const metadata = record.metadata || {};
    const values = record.values;

    // Check if vector is all zeros (placeholder)
    let embedding: number[] | undefined;
    if (Array.isArray(values) && values.some((v: number) => v !== 0)) {
      embedding = values;
    }

    return {
      id,
      content: metadata.content || '',
      layer: (metadata.layer || 'longterm') as MemoryLayer,
      namespace: metadata.namespace || 'default',
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      metadata: safeParse(metadata.metadata, {}),
      embedding,
      relevance: metadata.relevance ?? 0.7,
      confidence: metadata.confidence ?? 0.8,
      accessCount: metadata.accessCount || 0,
      lastAccessedAt: metadata.lastAccessedAt || '',
      createdAt: metadata.createdAt || '',
      updatedAt: metadata.updatedAt || '',
      ttl: metadata.ttl || null,
      expiresAt: metadata.expiresAt || null,
    };
  }

  private matchToEntry(match: any): MemoryEntry {
    return this.recordToEntry(match.id, { metadata: match.metadata, values: match.values });
  }

  private buildMetadataFilter(filter: MemoryFilter): Record<string, any> {
    const conditions: Record<string, any> = {};

    if (filter.namespace) {
      conditions.namespace = { $eq: filter.namespace };
    }
    if (filter.layer) {
      conditions.layer = { $eq: filter.layer };
    }
    if (filter.tags?.length) {
      conditions.tags = { $in: filter.tags };
    }
    if (filter.olderThan) {
      conditions.createdAt = { $lt: filter.olderThan };
    }
    if (filter.newerThan) {
      conditions.createdAt = { ...conditions.createdAt, $gt: filter.newerThan };
    }

    if (Object.keys(conditions).length <= 1) {
      return conditions;
    }

    return { $and: Object.entries(conditions).map(([key, value]) => ({ [key]: value })) };
  }

  private buildSearchFilter(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
  }): Record<string, any> {
    const conditions: Record<string, any> = {};

    if (options.namespace) {
      conditions.namespace = { $eq: options.namespace };
    }
    if (options.layer) {
      conditions.layer = { $eq: options.layer };
    }
    if (options.tags?.length) {
      conditions.tags = { $in: options.tags };
    }

    if (Object.keys(conditions).length <= 1) {
      return conditions;
    }

    return { $and: Object.entries(conditions).map(([key, value]) => ({ [key]: value })) };
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────

function safeParse<T>(value: string | unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) || fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
