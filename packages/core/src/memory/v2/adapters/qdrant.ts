/**
 * Qdrant Memory Adapter — Vector-native implementation of MemoryAdapter.
 *
 * Features:
 *   - Native HNSW vector search (highest performance semantic retrieval)
 *   - Payload-based filtering (namespace, layer, tags, metadata)
 *   - Points = entries (id, vector, payload)
 *   - Scroll API for listing and text search
 *   - Automatic collection creation with configurable vector size
 *
 * Requires: @qdrant/js-client-rest (optional peer dependency).
 * Best for: Semantic search, large-scale vector retrieval, production AI systems.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface QdrantAdapterConfig {
  /** Qdrant server URL (e.g., http://localhost:6333) */
  url: string;
  /** API key for Qdrant Cloud (optional) */
  apiKey?: string;
  /** Collection name (default: 'kernova_memories') */
  collectionName?: string;
  /** Vector dimensions (default: 1536 for text-embedding-3-small) */
  vectorSize?: number;
}

export class QdrantMemoryAdapter implements MemoryAdapter {
  readonly name = 'qdrant';
  private client: any = null;
  private config: QdrantAdapterConfig;
  private collectionName: string;
  private vectorSize: number;

  constructor(config: QdrantAdapterConfig) {
    this.config = config;
    this.collectionName = config.collectionName || 'kernova_memories';
    this.vectorSize = config.vectorSize || 1536;
  }

  async initialize(): Promise<void> {
    let qdrant: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      qdrant = require('@qdrant/js-client-rest');
    } catch {
      try {
        qdrant = await (Function('m', 'return import(m)')('@qdrant/js-client-rest'));
      } catch {
        throw new Error('Qdrant adapter requires "@qdrant/js-client-rest" package. Install: npm install @qdrant/js-client-rest');
      }
    }

    const QdrantClient = qdrant.QdrantClient || qdrant.default?.QdrantClient;
    this.client = new QdrantClient({
      url: this.config.url,
      apiKey: this.config.apiKey,
    });

    // Create collection if it doesn't exist
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections?.some(
        (c: any) => c.name === this.collectionName
      );

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine',
          },
        });

        // Create payload indexes for filtering
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'namespace',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'layer',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'tags',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'createdAt',
          field_schema: 'keyword',
        });
      }
    } catch (err: any) {
      // Collection may already exist or permission issues
      if (!err.message?.includes('already exists')) {
        console.error(`[QdrantAdapter] Initialization warning:`, err.message);
      }
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const point: any = {
      id: entry.id,
      payload: this.entryToPayload(entry),
    };

    // Only include vector if embedding exists
    if (entry.embedding?.length) {
      point.vector = entry.embedding;
    } else {
      // Store a zero vector as placeholder (Qdrant requires vectors)
      point.vector = new Array(this.vectorSize).fill(0);
    }

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: [point],
    });
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const points = entries.map(entry => ({
      id: entry.id,
      vector: entry.embedding?.length ? entry.embedding : new Array(this.vectorSize).fill(0),
      payload: this.entryToPayload(entry),
    }));

    await this.client.upsert(this.collectionName, {
      wait: true,
      points,
    });
  }

  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const results = await this.client.retrieve(this.collectionName, {
        ids: [id],
        with_payload: true,
        with_vector: true,
      });

      if (!results || results.length === 0) return null;
      return this.pointToEntry(results[0]);
    } catch {
      return null;
    }
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    try {
      const results = await this.client.retrieve(this.collectionName, {
        ids,
        with_payload: true,
        with_vector: true,
      });
      return (results || []).map((p: any) => this.pointToEntry(p));
    } catch {
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      points: [id],
    });
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.delete(this.collectionName, {
      wait: true,
      points: ids,
    });
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const qdrantFilter = this.buildFilter(filter);
    // Scroll to get matching IDs first (Qdrant delete-by-filter)
    const scrollResult = await this.client.scroll(this.collectionName, {
      filter: qdrantFilter,
      limit: 10000,
      with_payload: false,
    });

    const ids = (scrollResult.points || []).map((p: any) => p.id);
    if (ids.length === 0) return 0;

    await this.client.delete(this.collectionName, {
      wait: true,
      points: ids,
    });
    return ids.length;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    // Merge updates
    const merged: MemoryEntry = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.store(merged);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    const qdrantFilter = filter ? this.buildFilter(filter) : undefined;
    const result = await this.client.count(this.collectionName, {
      filter: qdrantFilter,
      exact: true,
    });
    return result.count || 0;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    const filter = this.buildSearchFilter(options);

    const results = await this.client.search(this.collectionName, {
      vector: embedding,
      limit: options.limit,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      with_payload: true,
      with_vector: true,
      score_threshold: options.minScore || 0,
    });

    return (results || [])
      .filter((r: any) => {
        // Exclude expired entries
        const expiresAt = r.payload?.expiresAt;
        if (expiresAt && expiresAt <= new Date().toISOString()) return false;
        return true;
      })
      .map((r: any) => ({
        entry: this.pointToEntry(r),
        similarity: r.score || 0,
      }));
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Qdrant doesn't have built-in full-text search — scroll + filter in JS
    const filter = this.buildSearchFilter(options);
    const queryLower = query.toLowerCase();

    // Scroll through entries and filter by content match
    const results: Array<{ entry: MemoryEntry; score: number }> = [];
    let offset: string | number | null = null;

    do {
      const scrollParams: any = {
        limit: 100,
        with_payload: true,
        with_vector: true,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      };
      if (offset !== null) scrollParams.offset = offset;

      const scrollResult = await this.client.scroll(this.collectionName, scrollParams);
      const points = scrollResult.points || [];

      for (const point of points) {
        const content = point.payload?.content || '';
        if (typeof content === 'string' && content.toLowerCase().includes(queryLower)) {
          const entry = this.pointToEntry(point);
          // Skip expired
          if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
          // Simple scoring based on position and frequency
          const contentLower = content.toLowerCase();
          const idx = contentLower.indexOf(queryLower);
          const positionScore = 1 - (idx / content.length);
          results.push({ entry, score: Math.min(positionScore * 0.8, 1) });
        }
      }

      offset = scrollResult.next_page_offset ?? null;
    } while (offset !== null && results.length < options.limit);

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.limit);
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    const filter = this.buildSearchFilter(options);

    const scrollResult = await this.client.scroll(this.collectionName, {
      limit: (options.limit || 50) + (options.offset || 0),
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      with_payload: true,
      with_vector: true,
    });

    let entries = (scrollResult.points || [])
      .map((p: any) => this.pointToEntry(p))
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
    const now = new Date().toISOString();

    // Scroll for entries with expiresAt <= now
    const scrollResult = await this.client.scroll(this.collectionName, {
      limit: 1000,
      with_payload: true,
      filter: {
        must: [
          { key: 'expiresAt', match: { any: [] } }, // has expiresAt field
        ],
      },
    });

    const expiredIds = (scrollResult.points || [])
      .filter((p: any) => p.payload?.expiresAt && p.payload.expiresAt <= now)
      .map((p: any) => p.id);

    if (expiredIds.length === 0) return 0;

    await this.client.delete(this.collectionName, {
      wait: true,
      points: expiredIds,
    });

    return expiredIds.length;
  }

  async close(): Promise<void> {
    // Qdrant JS client doesn't require explicit close
    this.client = null;
  }

  // ─── Private ───────────────────────────────────────────

  private entryToPayload(entry: MemoryEntry): Record<string, any> {
    return {
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: entry.tags || [],
      metadata: entry.metadata || {},
      relevance: entry.relevance ?? 0.7,
      confidence: entry.confidence ?? 0.8,
      accessCount: entry.accessCount || 0,
      lastAccessedAt: entry.lastAccessedAt || new Date().toISOString(),
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      ttl: entry.ttl || null,
      expiresAt: entry.expiresAt || null,
    };
  }

  private pointToEntry(point: any): MemoryEntry {
    const payload = point.payload || {};
    const vector = point.vector;

    // Check if vector is all zeros (placeholder)
    let embedding: number[] | undefined;
    if (Array.isArray(vector) && vector.some((v: number) => v !== 0)) {
      embedding = vector;
    }

    return {
      id: point.id,
      content: payload.content || '',
      layer: (payload.layer || 'longterm') as MemoryLayer,
      namespace: payload.namespace || 'default',
      tags: payload.tags || [],
      metadata: payload.metadata || {},
      embedding,
      relevance: payload.relevance ?? 0.7,
      confidence: payload.confidence ?? 0.8,
      accessCount: payload.accessCount || 0,
      lastAccessedAt: payload.lastAccessedAt || '',
      createdAt: payload.createdAt || '',
      updatedAt: payload.updatedAt || '',
      ttl: payload.ttl || null,
      expiresAt: payload.expiresAt || null,
    };
  }

  private buildFilter(filter: MemoryFilter): Record<string, any> {
    const must: any[] = [];

    if (filter.namespace) {
      must.push({ key: 'namespace', match: { value: filter.namespace } });
    }
    if (filter.layer) {
      must.push({ key: 'layer', match: { value: filter.layer } });
    }
    if (filter.tags?.length) {
      must.push({ key: 'tags', match: { any: filter.tags } });
    }
    if (filter.olderThan) {
      must.push({ key: 'createdAt', range: { lt: filter.olderThan } });
    }
    if (filter.newerThan) {
      must.push({ key: 'createdAt', range: { gt: filter.newerThan } });
    }

    return must.length > 0 ? { must } : {};
  }

  private buildSearchFilter(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
  }): Record<string, any> {
    const must: any[] = [];

    if (options.namespace) {
      must.push({ key: 'namespace', match: { value: options.namespace } });
    }
    if (options.layer) {
      must.push({ key: 'layer', match: { value: options.layer } });
    }
    if (options.tags?.length) {
      must.push({ key: 'tags', match: { any: options.tags } });
    }

    return must.length > 0 ? { must } : {};
  }
}
