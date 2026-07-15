/**
 * Weaviate Memory Adapter — Schema-driven vector database implementation of MemoryAdapter.
 *
 * Features:
 *   - Native nearVector search (HNSW-based)
 *   - BM25/hybrid text search
 *   - Auto-creates collection schema on initialize
 *   - Rich property types (text, number, int, text[], date)
 *   - Namespace + layer filtering via property queries
 *   - Weaviate Cloud or self-hosted support
 *
 * Requires: weaviate-client (v3) (optional peer dependency).
 * Best for: Hybrid search (vector + keyword), multi-modal data, production AI systems.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface WeaviateAdapterConfig {
  /** Weaviate instance URL (e.g., http://localhost:8080) */
  url: string;
  /** API key for Weaviate Cloud (optional) */
  apiKey?: string;
  /** Class/collection name (default: 'KernovaMemory') */
  className?: string;
  /** Vector dimensions (default: 1536) */
  vectorSize?: number;
}

export class WeaviateMemoryAdapter implements MemoryAdapter {
  readonly name = 'weaviate';
  private client: any = null;
  private collection: any = null;
  private config: WeaviateAdapterConfig;
  private className: string;
  private vectorSize: number;

  constructor(config: WeaviateAdapterConfig) {
    this.config = config;
    this.className = config.className || 'KernovaMemory';
    this.vectorSize = config.vectorSize || 1536;
  }

  async initialize(): Promise<void> {
    let weaviate: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      weaviate = require('weaviate-client');
    } catch {
      try {
        weaviate = await (Function('m', 'return import(m)')('weaviate-client'));
      } catch {
        throw new Error(
          'Weaviate adapter requires "weaviate-client" package. Install: npm install weaviate-client'
        );
      }
    }

    const weaviateModule = weaviate.default || weaviate;

    // Connect to Weaviate instance
    const connectOptions: any = {
      httpHost: this.extractHost(this.config.url),
      httpPort: this.extractPort(this.config.url),
      httpSecure: this.config.url.startsWith('https'),
      grpcHost: this.extractHost(this.config.url),
      grpcPort: 50051,
      grpcSecure: this.config.url.startsWith('https'),
    };

    if (this.config.apiKey) {
      connectOptions.authCredentials = new (weaviateModule.ApiKey || weaviate.ApiKey)(this.config.apiKey);
    }

    // Try weaviate-client v3 connect methods
    if (weaviateModule.connectToLocal) {
      try {
        if (this.config.apiKey && this.config.url.includes('weaviate.cloud')) {
          this.client = await weaviateModule.connectToWeaviateCloud(this.config.url, {
            authCredentials: new (weaviateModule.ApiKey || weaviate.ApiKey)(this.config.apiKey),
          });
        } else {
          const host = this.extractHost(this.config.url);
          const port = this.extractPort(this.config.url);
          this.client = await weaviateModule.connectToLocal({ host, port });
        }
      } catch {
        // Fallback to generic connect
        this.client = await weaviateModule.connectToCustom(connectOptions);
      }
    } else if (weaviateModule.client) {
      // Older v2 API fallback
      this.client = weaviateModule.client(connectOptions);
    } else {
      throw new Error('Could not initialize Weaviate client. Ensure weaviate-client v3+ is installed.');
    }

    // Create collection schema if not exists
    await this.ensureCollection();
    this.collection = this.client.collections.get(this.className);
  }

  async store(entry: MemoryEntry): Promise<void> {
    const properties = this.entryToProperties(entry);
    const vector = entry.embedding?.length ? entry.embedding : undefined;

    try {
      // Try to check if it exists first (upsert semantics)
      const existing = await this.collection.query.fetchObjectById(entry.id);
      if (existing) {
        await this.collection.data.update({
          id: entry.id,
          properties,
          vectors: vector,
        });
      } else {
        await this.collection.data.insert({
          id: entry.id,
          properties,
          vectors: vector,
        });
      }
    } catch {
      // If fetch fails, try insert directly
      try {
        await this.collection.data.insert({
          id: entry.id,
          properties,
          vectors: vector,
        });
      } catch {
        // If insert fails (duplicate), update
        await this.collection.data.update({
          id: entry.id,
          properties,
          vectors: vector,
        });
      }
    }
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const objects = entries.map(entry => ({
      id: entry.id,
      properties: this.entryToProperties(entry),
      vectors: entry.embedding?.length ? entry.embedding : undefined,
    }));

    // Weaviate batch insert
    try {
      await this.collection.data.insertMany(objects);
    } catch {
      // Fallback: insert one by one for upsert semantics
      for (const entry of entries) {
        await this.store(entry);
      }
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const result = await this.collection.query.fetchObjectById(id, {
        includeVector: true,
      });
      if (!result) return null;
      return this.objectToEntry(result);
    } catch {
      return null;
    }
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const results: MemoryEntry[] = [];
    for (const id of ids) {
      const entry = await this.get(id);
      if (entry) results.push(entry);
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    try {
      await this.collection.data.deleteById(id);
    } catch {
      // Entry may not exist
    }
  }

  async deleteBatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const entries = await this.queryWithFilter(filter);
    for (const entry of entries) {
      await this.delete(entry.id);
    }
    return entries.length;
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
    try {
      if (!filter) {
        const result = await this.collection.aggregate.overAll();
        return result?.totalCount || 0;
      }

      const entries = await this.queryWithFilter(filter);
      return entries.length;
    } catch {
      return 0;
    }
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    try {
      const filters = this.buildWeaviateFilter(options);

      const queryBuilder: any = {
        nearVector: embedding,
        limit: options.limit,
        returnMetadata: ['distance'],
        includeVector: true,
      };

      if (filters) {
        queryBuilder.filters = filters;
      }

      const result = await this.collection.query.nearVector(embedding, {
        limit: options.limit,
        filters: filters || undefined,
        returnMetadata: ['distance'],
        includeVector: true,
      });

      const entries: Array<{ entry: MemoryEntry; similarity: number }> = [];
      for (const obj of result?.objects || []) {
        const entry = this.objectToEntry(obj);
        // Skip expired
        if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
        // Weaviate returns distance; convert to similarity (1 - distance for cosine)
        const distance = obj.metadata?.distance ?? 0;
        const similarity = 1 - distance;
        if (options.minScore && similarity < options.minScore) continue;
        entries.push({ entry, similarity });
      }

      return entries;
    } catch {
      // Fallback to brute-force cosine similarity
      const allEntries = await this.queryWithFilter({
        namespace: options.namespace,
        layer: options.layer,
        tags: options.tags,
      });

      const results: Array<{ entry: MemoryEntry; similarity: number }> = [];
      for (const entry of allEntries) {
        if (!entry.embedding?.length) continue;
        const similarity = cosineSimilarity(embedding, entry.embedding);
        if (similarity >= (options.minScore || 0)) {
          results.push({ entry, similarity });
        }
      }

      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, options.limit);
    }
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    try {
      // Try BM25 search (keyword-based)
      const filters = this.buildWeaviateFilter(options);
      const result = await this.collection.query.bm25(query, {
        limit: options.limit,
        filters: filters || undefined,
        returnMetadata: ['score'],
        includeVector: true,
      });

      const entries: Array<{ entry: MemoryEntry; score: number }> = [];
      for (const obj of result?.objects || []) {
        const entry = this.objectToEntry(obj);
        // Skip expired
        if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
        const score = obj.metadata?.score ?? 0.5;
        entries.push({ entry, score: Math.min(score, 1) });
      }

      if (entries.length > 0) return entries;
    } catch {
      // Fall through to manual search
    }

    // Fallback: load entries and filter in JS
    const allEntries = await this.queryWithFilter({
      namespace: options.namespace,
      layer: options.layer,
      tags: options.tags,
    });

    const queryLower = query.toLowerCase();
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of allEntries) {
      if (entry.content.toLowerCase().includes(queryLower)) {
        if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
        const idx = entry.content.toLowerCase().indexOf(queryLower);
        const positionScore = 1 - (idx / Math.max(entry.content.length, 1));
        results.push({ entry, score: Math.min(positionScore * 0.8, 1) });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.limit);
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    const filter: MemoryFilter = {};
    if (options.namespace) filter.namespace = options.namespace;
    if (options.layer) filter.layer = options.layer;
    if (options.tags?.length) filter.tags = options.tags;

    let entries = await this.queryWithFilter(filter, (options.limit || 50) + (options.offset || 0));

    // Filter expired
    entries = entries.filter(e => !e.expiresAt || e.expiresAt > new Date().toISOString());

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
    const now = new Date().toISOString();

    try {
      const result = await this.collection.query.fetchObjects({
        limit: 1000,
        includeVector: false,
      });

      const expiredIds: string[] = [];
      for (const obj of result?.objects || []) {
        const expiresAt = obj.properties?.expiresAt;
        if (expiresAt && expiresAt <= now) {
          expiredIds.push(obj.uuid || obj.id);
        }
      }

      for (const id of expiredIds) {
        await this.delete(id);
      }
      return expiredIds.length;
    } catch {
      return 0;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Client may not support close
      }
      this.client = null;
      this.collection = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private async ensureCollection(): Promise<void> {
    try {
      const exists = await this.client.collections.exists(this.className);
      if (exists) return;
    } catch {
      // If exists check fails, try to create anyway
    }

    try {
      await this.client.collections.create({
        name: this.className,
        properties: [
          { name: 'entryId', dataType: 'text' },
          { name: 'content', dataType: 'text' },
          { name: 'layer', dataType: 'text' },
          { name: 'namespace', dataType: 'text' },
          { name: 'tags', dataType: 'text[]' },
          { name: 'metadataJson', dataType: 'text' },
          { name: 'relevance', dataType: 'number' },
          { name: 'confidence', dataType: 'number' },
          { name: 'accessCount', dataType: 'int' },
          { name: 'lastAccessedAt', dataType: 'text' },
          { name: 'createdAt', dataType: 'text' },
          { name: 'updatedAt', dataType: 'text' },
          { name: 'ttl', dataType: 'int' },
          { name: 'expiresAt', dataType: 'text' },
        ],
        vectorizers: [{ name: 'none', vectorizer: 'none' }],
      });
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.error(`[WeaviateAdapter] Collection creation warning:`, err.message);
      }
    }
  }

  private entryToProperties(entry: MemoryEntry): Record<string, any> {
    return {
      entryId: entry.id,
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: entry.tags || [],
      metadataJson: JSON.stringify(entry.metadata || {}),
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

  private objectToEntry(obj: any): MemoryEntry {
    const props = obj.properties || {};
    const vector = obj.vectors?.default || obj.vector;

    let embedding: number[] | undefined;
    if (Array.isArray(vector) && vector.some((v: number) => v !== 0)) {
      embedding = vector;
    }

    return {
      id: props.entryId || obj.uuid || obj.id || '',
      content: props.content || '',
      layer: (props.layer || 'longterm') as MemoryLayer,
      namespace: props.namespace || 'default',
      tags: Array.isArray(props.tags) ? props.tags : [],
      metadata: safeParse(props.metadataJson, {}),
      embedding,
      relevance: props.relevance ?? 0.7,
      confidence: props.confidence ?? 0.8,
      accessCount: props.accessCount || 0,
      lastAccessedAt: props.lastAccessedAt || '',
      createdAt: props.createdAt || '',
      updatedAt: props.updatedAt || '',
      ttl: props.ttl || null,
      expiresAt: props.expiresAt || null,
    };
  }

  private buildWeaviateFilter(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
  }): any {
    const conditions: any[] = [];

    if (options.namespace) {
      conditions.push(this.collection.filter.byProperty('namespace').equal(options.namespace));
    }
    if (options.layer) {
      conditions.push(this.collection.filter.byProperty('layer').equal(options.layer));
    }
    if (options.tags?.length) {
      conditions.push(this.collection.filter.byProperty('tags').containsAny(options.tags));
    }

    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];

    // Combine with AND
    let combined = conditions[0];
    for (let i = 1; i < conditions.length; i++) {
      combined = combined.and(conditions[i]);
    }
    return combined;
  }

  private async queryWithFilter(filter: MemoryFilter | { namespace?: string; layer?: MemoryLayer; tags?: string[] }, limit = 1000): Promise<MemoryEntry[]> {
    try {
      const weaviateFilter = this.buildWeaviateFilter(filter);
      const result = await this.collection.query.fetchObjects({
        limit,
        filters: weaviateFilter || undefined,
        includeVector: true,
      });

      return (result?.objects || []).map((obj: any) => this.objectToEntry(obj));
    } catch {
      return [];
    }
  }

  private extractHost(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return 'localhost';
    }
  }

  private extractPort(url: string): number {
    try {
      const u = new URL(url);
      return u.port ? parseInt(u.port) : (u.protocol === 'https:' ? 443 : 8080);
    } catch {
      return 8080;
    }
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

function safeParse<T>(value: string | unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) || fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
