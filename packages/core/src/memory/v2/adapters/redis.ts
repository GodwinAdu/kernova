/**
 * Redis Memory Adapter — High-performance in-memory implementation of MemoryAdapter.
 *
 * Features:
 *   - Stores entries as JSON in Redis hashes
 *   - Redis sets for tag-based filtering
 *   - Sorted sets for namespace/layer indexing (score = timestamp)
 *   - Native TTL via Redis EXPIRE
 *   - RediSearch (FT.SEARCH) for text search when available, SCAN fallback
 *   - Brute-force cosine similarity in JS for vector search
 *
 * Requires: ioredis (optional peer dependency).
 * Best for: Working memory, cache layers, ephemeral data.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface RedisAdapterConfig {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url: string;
  /** Key prefix (default: 'kernova:memory') */
  prefix?: string;
  /** SCAN batch size (default: 100) */
  maxScanCount?: number;
}

export class RedisMemoryAdapter implements MemoryAdapter {
  readonly name = 'redis';
  private client: any = null;
  private config: RedisAdapterConfig;
  private prefix: string;
  private maxScanCount: number;
  private hasRediSearch = false;

  constructor(config: RedisAdapterConfig) {
    this.config = config;
    this.prefix = config.prefix || 'kernova:memory';
    this.maxScanCount = config.maxScanCount || 100;
  }

  async initialize(): Promise<void> {
    let Redis: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      Redis = require('ioredis');
    } catch {
      try {
        const mod = await (Function('m', 'return import(m)')('ioredis'));
        Redis = mod.default || mod;
      } catch {
        throw new Error('Redis adapter requires "ioredis" package. Install: npm install ioredis');
      }
    }

    const RedisClass = Redis.default || Redis;
    this.client = new RedisClass(this.config.url);

    // Check if RediSearch module is available
    try {
      const modules = await this.client.call('MODULE', 'LIST');
      if (Array.isArray(modules)) {
        const flat = modules.flat();
        this.hasRediSearch = flat.some((m: any) =>
          typeof m === 'string' && m.toLowerCase().includes('search')
        );
      }
    } catch {
      this.hasRediSearch = false;
    }

    // If RediSearch is available, create an index
    if (this.hasRediSearch) {
      try {
        await this.client.call(
          'FT.CREATE', `${this.prefix}:idx`,
          'ON', 'HASH',
          'PREFIX', '1', `${this.prefix}:`,
          'SCHEMA',
          'content', 'TEXT',
          'layer', 'TAG',
          'namespace', 'TAG',
          'tags_str', 'TAG',
          'relevance', 'NUMERIC', 'SORTABLE',
          'created_at', 'NUMERIC', 'SORTABLE'
        );
      } catch (err: any) {
        // Index may already exist
        if (!err.message?.includes('Index already exists')) {
          this.hasRediSearch = false;
        }
      }
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const key = `${this.prefix}:${entry.id}`;
    const createdAtMs = new Date(entry.createdAt || new Date().toISOString()).getTime();

    const data: Record<string, string> = {
      id: entry.id,
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: JSON.stringify(entry.tags || []),
      tags_str: (entry.tags || []).join(','),
      metadata: JSON.stringify(entry.metadata || {}),
      relevance: String(entry.relevance ?? 0.7),
      confidence: String(entry.confidence ?? 0.8),
      access_count: String(entry.accessCount || 0),
      last_accessed_at: entry.lastAccessedAt || new Date().toISOString(),
      created_at: entry.createdAt || new Date().toISOString(),
      updated_at: entry.updatedAt || new Date().toISOString(),
      ttl: String(entry.ttl || 0),
      expires_at: entry.expiresAt || '',
    };

    if (entry.embedding) {
      data.embedding = JSON.stringify(entry.embedding);
    }

    // Store entry as hash
    await this.client.hmset(key, data);

    // Set TTL if configured
    if (entry.ttl && entry.ttl > 0) {
      await this.client.expire(key, entry.ttl);
    }

    // Add to tag sets
    if (entry.tags?.length) {
      for (const tag of entry.tags) {
        await this.client.sadd(`${this.prefix}:tags:${tag}`, entry.id);
      }
    }

    // Add to namespace sorted set (score = timestamp)
    await this.client.zadd(`${this.prefix}:ns:${entry.namespace}`, createdAtMs, entry.id);

    // Add to layer sorted set
    await this.client.zadd(`${this.prefix}:layer:${entry.layer}`, createdAtMs, entry.id);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    const pipeline = this.client.pipeline();
    for (const entry of entries) {
      // We'll store each but within a pipeline for efficiency
      await this.store(entry);
    }
    // Note: for true batching we'd inline the pipeline commands,
    // but since store has multiple operations, sequential is simpler
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const key = `${this.prefix}:${id}`;
    const data = await this.client.hgetall(key);
    if (!data || Object.keys(data).length === 0) return null;
    return this.hashToEntry(data);
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const results: MemoryEntry[] = [];
    const pipeline = this.client.pipeline();
    for (const id of ids) {
      pipeline.hgetall(`${this.prefix}:${id}`);
    }
    const responses = await pipeline.exec();
    if (responses) {
      for (const [err, data] of responses) {
        if (!err && data && Object.keys(data).length > 0) {
          results.push(this.hashToEntry(data));
        }
      }
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;

    const key = `${this.prefix}:${id}`;
    await this.client.del(key);

    // Remove from tag sets
    if (entry.tags?.length) {
      for (const tag of entry.tags) {
        await this.client.srem(`${this.prefix}:tags:${tag}`, id);
      }
    }

    // Remove from namespace/layer sorted sets
    await this.client.zrem(`${this.prefix}:ns:${entry.namespace}`, id);
    await this.client.zrem(`${this.prefix}:layer:${entry.layer}`, id);
  }

  async deleteBatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const entries = await this.scanEntries(filter);
    for (const entry of entries) {
      await this.delete(entry.id);
    }
    return entries.length;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const key = `${this.prefix}:${id}`;
    const exists = await this.client.exists(key);
    if (!exists) return;

    const sets: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.content !== undefined) sets.content = updates.content;
    if (updates.tags !== undefined) {
      sets.tags = JSON.stringify(updates.tags);
      sets.tags_str = updates.tags.join(',');
    }
    if (updates.metadata !== undefined) sets.metadata = JSON.stringify(updates.metadata);
    if (updates.relevance !== undefined) sets.relevance = String(updates.relevance);
    if (updates.confidence !== undefined) sets.confidence = String(updates.confidence);
    if (updates.accessCount !== undefined) sets.access_count = String(updates.accessCount);
    if (updates.lastAccessedAt !== undefined) sets.last_accessed_at = updates.lastAccessedAt;
    if (updates.namespace !== undefined) sets.namespace = updates.namespace;
    if (updates.embedding !== undefined) sets.embedding = JSON.stringify(updates.embedding);

    await this.client.hmset(key, sets);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    if (!filter) {
      // Count all entries via SCAN
      let count = 0;
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}:*`, 'COUNT', this.maxScanCount);
        cursor = next;
        // Only count entry keys (not index keys)
        count += keys.filter((k: string) =>
          !k.includes(':tags:') && !k.includes(':ns:') && !k.includes(':layer:') && !k.includes(':idx')
        ).length;
      } while (cursor !== '0');
      return count;
    }

    const entries = await this.scanEntries(filter);
    return entries.length;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // Redis doesn't have native vector search without RedisStack — brute-force in JS
    const filter: MemoryFilter = {};
    if (options.namespace) filter.namespace = options.namespace;
    if (options.layer) filter.layer = options.layer;
    if (options.tags?.length) filter.tags = options.tags;

    const entries = await this.scanEntries(filter, true);
    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];

    for (const entry of entries) {
      if (!entry.embedding?.length) continue;
      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (similarity >= (options.minScore || 0)) {
        results.push({ entry, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Try RediSearch first
    if (this.hasRediSearch) {
      try {
        const filterParts: string[] = [];
        if (options.namespace) filterParts.push(`@namespace:{${escapeRedisTag(options.namespace)}}`);
        if (options.layer) filterParts.push(`@layer:{${escapeRedisTag(options.layer)}}`);

        const searchQuery = filterParts.length > 0
          ? `${filterParts.join(' ')} ${query}`
          : query;

        const result = await this.client.call('FT.SEARCH', `${this.prefix}:idx`, searchQuery, 'LIMIT', '0', String(options.limit));
        if (Array.isArray(result) && result.length > 1) {
          const results: Array<{ entry: MemoryEntry; score: number }> = [];
          // FT.SEARCH returns [count, key1, fields1, key2, fields2, ...]
          for (let i = 1; i < result.length; i += 2) {
            const fields = result[i + 1];
            if (!Array.isArray(fields)) continue;
            const data: Record<string, string> = {};
            for (let j = 0; j < fields.length; j += 2) {
              data[fields[j]] = fields[j + 1];
            }
            const entry = this.hashToEntry(data);
            if (this.matchesTags(entry, options.tags)) {
              results.push({ entry, score: 0.8 });
            }
          }
          if (results.length > 0) return results;
        }
      } catch {
        // Fall through to SCAN-based search
      }
    }

    // Fallback: SCAN + pattern matching on content
    const filter: MemoryFilter = {};
    if (options.namespace) filter.namespace = options.namespace;
    if (options.layer) filter.layer = options.layer;
    if (options.tags?.length) filter.tags = options.tags;

    const entries = await this.scanEntries(filter);
    const queryLower = query.toLowerCase();
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of entries) {
      if (entry.content.toLowerCase().includes(queryLower)) {
        results.push({ entry, score: 0.5 });
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
    let ids: string[] | null = null;

    // If filtering by namespace, use the sorted set index
    if (options.namespace) {
      const raw = await this.client.zrangebyscore(
        `${this.prefix}:ns:${options.namespace}`, '-inf', '+inf'
      );
      ids = raw;
    } else if (options.layer) {
      const raw = await this.client.zrangebyscore(
        `${this.prefix}:layer:${options.layer}`, '-inf', '+inf'
      );
      ids = raw;
    }

    let entries: MemoryEntry[];
    if (ids) {
      entries = await this.getMany(ids);
    } else {
      const filter: MemoryFilter = {};
      if (options.tags?.length) filter.tags = options.tags;
      entries = await this.scanEntries(filter);
    }

    // Apply remaining filters
    if (options.layer && options.namespace) {
      entries = entries.filter(e => e.layer === options.layer);
    }
    if (options.tags?.length) {
      entries = entries.filter(e => this.matchesTags(e, options.tags));
    }

    // Filter expired
    const now = new Date().toISOString();
    entries = entries.filter(e => !e.expiresAt || e.expiresAt > now);

    // Sort
    const orderBy = options.orderBy || 'createdAt';
    const order = options.order || 'desc';
    entries.sort((a, b) => {
      const aVal = orderBy === 'relevance' ? a.relevance : (a as any)[orderBy] || '';
      const bVal = orderBy === 'relevance' ? b.relevance : (b as any)[orderBy] || '';
      if (order === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return bVal < aVal ? -1 : bVal > aVal ? 1 : 0;
    });

    const offset = options.offset || 0;
    const limit = options.limit || 50;
    return entries.slice(offset, offset + limit);
  }

  async expireEntries(): Promise<number> {
    // Redis handles TTL natively via EXPIRE, but we also check expiresAt manually
    const now = new Date().toISOString();
    let count = 0;
    let cursor = '0';

    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}:*`, 'COUNT', this.maxScanCount);
      cursor = next;

      for (const key of keys) {
        if (key.includes(':tags:') || key.includes(':ns:') || key.includes(':layer:') || key.includes(':idx')) continue;
        const expiresAt = await this.client.hget(key, 'expires_at');
        if (expiresAt && expiresAt !== '' && expiresAt <= now) {
          const id = await this.client.hget(key, 'id');
          if (id) {
            await this.delete(id);
            count++;
          }
        }
      }
    } while (cursor !== '0');

    return count;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private async scanEntries(filter?: MemoryFilter, includeEmbedding = false): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    let cursor = '0';

    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}:*`, 'COUNT', this.maxScanCount);
      cursor = next;

      for (const key of keys) {
        // Skip index keys
        if (key.includes(':tags:') || key.includes(':ns:') || key.includes(':layer:') || key.includes(':idx')) continue;

        const data = await this.client.hgetall(key);
        if (!data || !data.id) continue;

        // Apply filters
        if (filter?.namespace && data.namespace !== filter.namespace) continue;
        if (filter?.layer && data.layer !== filter.layer) continue;
        if (filter?.olderThan && data.created_at >= filter.olderThan) continue;

        const entry = this.hashToEntry(data, includeEmbedding);

        if (filter?.tags?.length) {
          if (!this.matchesTags(entry, filter.tags)) continue;
        }

        entries.push(entry);
      }
    } while (cursor !== '0');

    return entries;
  }

  private matchesTags(entry: MemoryEntry, tags?: string[]): boolean {
    if (!tags?.length) return true;
    return tags.some(t => entry.tags.includes(t));
  }

  private hashToEntry(data: Record<string, string>, includeEmbedding = false): MemoryEntry {
    let embedding: number[] | undefined;
    if (includeEmbedding && data.embedding) {
      try { embedding = JSON.parse(data.embedding); } catch {}
    }

    return {
      id: data.id,
      content: data.content || '',
      layer: (data.layer || 'longterm') as MemoryLayer,
      namespace: data.namespace || 'default',
      tags: safeParse(data.tags, []),
      metadata: safeParse(data.metadata, {}),
      embedding,
      relevance: parseFloat(data.relevance) || 0.7,
      confidence: parseFloat(data.confidence) || 0.8,
      accessCount: parseInt(data.access_count) || 0,
      lastAccessedAt: data.last_accessed_at || '',
      createdAt: data.created_at || '',
      updatedAt: data.updated_at || '',
      ttl: parseInt(data.ttl) || null,
      expiresAt: data.expires_at || null,
    };
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

function escapeRedisTag(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
