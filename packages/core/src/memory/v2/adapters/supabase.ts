/**
 * Supabase Memory Adapter — PostgreSQL-backed implementation via Supabase client.
 *
 * Features:
 *   - Uses Supabase JS client (better DX than raw pg)
 *   - pgvector via Supabase's rpc() calling a match function
 *   - PostgreSQL full-text search via tsvector
 *   - Row Level Security (RLS) compatible
 *   - Auto-creates table and match function on initialize
 *   - Realtime-compatible schema
 *
 * Requires: @supabase/supabase-js (optional peer dependency).
 * Best for: Hosted PostgreSQL, auth-integrated apps, serverless.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface SupabaseAdapterConfig {
  /** Supabase project URL */
  url: string;
  /** Supabase anon key (for client-side or public operations) */
  anonKey: string;
  /** Service role key (for admin operations like table creation) */
  serviceKey?: string;
  /** Table name (default: 'kernova_memories') */
  table?: string;
  /** Vector dimensions (default: 1536) */
  vectorSize?: number;
}

export class SupabaseMemoryAdapter implements MemoryAdapter {
  readonly name = 'supabase';
  private client: any = null;
  private adminClient: any = null;
  private config: SupabaseAdapterConfig;
  private table: string;
  private vectorSize: number;

  constructor(config: SupabaseAdapterConfig) {
    this.config = config;
    this.table = config.table || 'kernova_memories';
    this.vectorSize = config.vectorSize || 1536;
  }

  async initialize(): Promise<void> {
    let supabase: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      supabase = require('@supabase/supabase-js');
    } catch {
      try {
        supabase = await (Function('m', 'return import(m)')('@supabase/supabase-js'));
      } catch {
        throw new Error('Supabase adapter requires "@supabase/supabase-js" package. Install: npm install @supabase/supabase-js');
      }
    }

    const createClient = supabase.createClient || supabase.default?.createClient;

    // Create main client with anon key
    this.client = createClient(this.config.url, this.config.anonKey);

    // Create admin client with service key (for DDL operations)
    if (this.config.serviceKey) {
      this.adminClient = createClient(this.config.url, this.config.serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    } else {
      this.adminClient = this.client;
    }

    // Auto-create table and function via SQL (requires service key for DDL)
    await this.setupSchema();
  }

  private async setupSchema(): Promise<void> {
    const t = this.table;
    const dims = this.vectorSize;

    // Enable pgvector extension
    try {
      await this.adminClient.rpc('exec_sql', {
        query: 'CREATE EXTENSION IF NOT EXISTS vector'
      });
    } catch {
      // Extension might already exist or rpc not available
      // Try direct SQL via the REST API
      try {
        await this.adminClient.from('_migrations').select('id').limit(0);
      } catch {}
    }

    // Create table (use rpc if available, otherwise rely on table existing)
    try {
      await this.adminClient.rpc('exec_sql', {
        query: `
          CREATE TABLE IF NOT EXISTS ${t} (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            layer TEXT NOT NULL DEFAULT 'longterm',
            namespace TEXT NOT NULL DEFAULT 'default',
            tags JSONB DEFAULT '[]'::jsonb,
            metadata JSONB DEFAULT '{}'::jsonb,
            embedding vector(${dims}),
            relevance REAL DEFAULT 0.7,
            confidence REAL DEFAULT 0.8,
            access_count INTEGER DEFAULT 0,
            last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
            ttl INTEGER,
            expires_at TIMESTAMPTZ,
            search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `
      });
    } catch {
      // Table may already exist or exec_sql not available
    }

    // Create vector match function
    try {
      await this.adminClient.rpc('exec_sql', {
        query: `
          CREATE OR REPLACE FUNCTION match_${t}(
            query_embedding vector(${dims}),
            match_count int DEFAULT 10,
            match_namespace text DEFAULT NULL,
            match_layer text DEFAULT NULL,
            min_score float DEFAULT 0
          )
          RETURNS TABLE (
            id text,
            content text,
            layer text,
            namespace text,
            tags jsonb,
            metadata jsonb,
            relevance real,
            confidence real,
            access_count integer,
            last_accessed_at timestamptz,
            ttl integer,
            expires_at timestamptz,
            created_at timestamptz,
            updated_at timestamptz,
            similarity float
          )
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RETURN QUERY
            SELECT
              t.id, t.content, t.layer, t.namespace, t.tags, t.metadata,
              t.relevance, t.confidence, t.access_count, t.last_accessed_at,
              t.ttl, t.expires_at, t.created_at, t.updated_at,
              1 - (t.embedding <=> query_embedding) as similarity
            FROM ${t} t
            WHERE t.embedding IS NOT NULL
              AND (t.expires_at IS NULL OR t.expires_at > NOW())
              AND (match_namespace IS NULL OR t.namespace = match_namespace)
              AND (match_layer IS NULL OR t.layer = match_layer)
              AND 1 - (t.embedding <=> query_embedding) >= min_score
            ORDER BY t.embedding <=> query_embedding
            LIMIT match_count;
          END;
          $$
        `
      });
    } catch {
      // Function may already exist or exec_sql not available
    }

    // Create indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${t}_layer ON ${t}(layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${t}_namespace ON ${t}(namespace)`,
      `CREATE INDEX IF NOT EXISTS idx_${t}_ns_layer ON ${t}(namespace, layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${t}_created ON ${t}(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${t}_expires ON ${t}(expires_at) WHERE expires_at IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_${t}_search ON ${t} USING GIN(search_vector)`,
      `CREATE INDEX IF NOT EXISTS idx_${t}_tags ON ${t} USING GIN(tags)`,
    ];

    for (const sql of indexes) {
      try {
        await this.adminClient.rpc('exec_sql', { query: sql });
      } catch {}
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const row = this.entryToRow(entry);
    const { error } = await this.client.from(this.table).upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`[SupabaseAdapter] store failed: ${error.message}`);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const rows = entries.map(e => this.entryToRow(e));
    const { error } = await this.client.from(this.table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`[SupabaseAdapter] storeBatch failed: ${error.message}`);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const { data, error } = await this.client.from(this.table).select('*').eq('id', id).single();
    if (error || !data) return null;
    return this.rowToEntry(data);
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client.from(this.table).select('*').in('id', ids);
    if (error || !data) return [];
    return data.map((d: any) => this.rowToEntry(d));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from(this.table).delete().eq('id', id);
    if (error) throw new Error(`[SupabaseAdapter] delete failed: ${error.message}`);
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.client.from(this.table).delete().in('id', ids);
    if (error) throw new Error(`[SupabaseAdapter] deleteBatch failed: ${error.message}`);
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    let query = this.client.from(this.table).delete({ count: 'exact' });
    query = this.applyFilter(query, filter);
    const { count, error } = await query;
    if (error) throw new Error(`[SupabaseAdapter] deleteWhere failed: ${error.message}`);
    return count || 0;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const row: Record<string, any> = { updated_at: new Date().toISOString() };

    if (updates.content !== undefined) row.content = updates.content;
    if (updates.tags !== undefined) row.tags = updates.tags;
    if (updates.metadata !== undefined) row.metadata = updates.metadata;
    if (updates.relevance !== undefined) row.relevance = updates.relevance;
    if (updates.confidence !== undefined) row.confidence = updates.confidence;
    if (updates.accessCount !== undefined) row.access_count = updates.accessCount;
    if (updates.lastAccessedAt !== undefined) row.last_accessed_at = updates.lastAccessedAt;
    if (updates.namespace !== undefined) row.namespace = updates.namespace;
    if (updates.embedding !== undefined) row.embedding = `[${updates.embedding.join(',')}]`;

    const { error } = await this.client.from(this.table).update(row).eq('id', id);
    if (error) throw new Error(`[SupabaseAdapter] update failed: ${error.message}`);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    let query = this.client.from(this.table).select('id', { count: 'exact', head: true });
    if (filter) query = this.applyFilter(query, filter);
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // Try the match function via rpc
    try {
      const { data, error } = await this.client.rpc(`match_${this.table}`, {
        query_embedding: `[${embedding.join(',')}]`,
        match_count: options.limit,
        match_namespace: options.namespace || null,
        match_layer: options.layer || null,
        min_score: options.minScore || 0,
      });

      if (!error && data?.length > 0) {
        let results = data.map((d: any) => ({
          entry: this.rowToEntry(d),
          similarity: d.similarity || 0,
        }));

        // Filter by tags if specified
        if (options.tags?.length) {
          results = results.filter((r: any) =>
            options.tags!.some(t => r.entry.tags.includes(t))
          );
        }

        return results;
      }
    } catch {
      // Match function not available, fall through to brute-force
    }

    // Brute-force fallback: load entries and compute cosine in JS
    let query = this.client.from(this.table).select('*').not('embedding', 'is', null);
    if (options.namespace) query = query.eq('namespace', options.namespace);
    if (options.layer) query = query.eq('layer', options.layer);
    if (options.tags?.length) query = query.contains('tags', options.tags);

    const { data } = await query;
    if (!data) return [];

    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];
    for (const row of data) {
      if (!row.embedding) continue;
      // Supabase may return embedding as string or array
      let storedEmbedding: number[];
      if (typeof row.embedding === 'string') {
        try { storedEmbedding = JSON.parse(row.embedding); } catch { continue; }
      } else if (Array.isArray(row.embedding)) {
        storedEmbedding = row.embedding;
      } else {
        continue;
      }

      const similarity = cosineSimilarity(embedding, storedEmbedding);
      if (similarity >= (options.minScore || 0)) {
        const entry = this.rowToEntry(row);
        if (!entry.expiresAt || entry.expiresAt > new Date().toISOString()) {
          results.push({ entry, similarity });
        }
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Try PostgreSQL full-text search via textSearch
    try {
      let q = this.client.from(this.table)
        .select('*')
        .textSearch('content', query, { type: 'websearch' });

      if (options.namespace) q = q.eq('namespace', options.namespace);
      if (options.layer) q = q.eq('layer', options.layer);
      if (options.tags?.length) q = q.contains('tags', options.tags);
      q = q.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());
      q = q.limit(options.limit);

      const { data, error } = await q;
      if (!error && data?.length > 0) {
        return data.map((d: any) => ({
          entry: this.rowToEntry(d),
          score: 0.7, // Supabase doesn't expose ts_rank via client
        }));
      }
    } catch {
      // textSearch not supported or failed
    }

    // Fallback to ILIKE
    let q = this.client.from(this.table)
      .select('*')
      .ilike('content', `%${query}%`);

    if (options.namespace) q = q.eq('namespace', options.namespace);
    if (options.layer) q = q.eq('layer', options.layer);
    if (options.tags?.length) q = q.contains('tags', options.tags);
    q = q.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());
    q = q.order('created_at', { ascending: false });
    q = q.limit(options.limit);

    const { data } = await q;
    if (!data) return [];

    return data.map((d: any) => ({ entry: this.rowToEntry(d), score: 0.4 }));
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    let query = this.client.from(this.table).select('*');

    if (options.namespace) query = query.eq('namespace', options.namespace);
    if (options.layer) query = query.eq('layer', options.layer);
    if (options.tags?.length) query = query.contains('tags', options.tags);
    query = query.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());

    const orderCol = options.orderBy === 'updatedAt' ? 'updated_at'
      : options.orderBy === 'lastAccessedAt' ? 'last_accessed_at'
      : options.orderBy === 'relevance' ? 'relevance'
      : 'created_at';
    query = query.order(orderCol, { ascending: options.order === 'asc' });
    query = query.limit(options.limit || 50);
    if (options.offset) query = query.range(options.offset, options.offset + (options.limit || 50) - 1);

    const { data } = await query;
    if (!data) return [];

    return data.map((d: any) => this.rowToEntry(d));
  }

  async expireEntries(): Promise<number> {
    const { count, error } = await this.client
      .from(this.table)
      .delete({ count: 'exact' })
      .not('expires_at', 'is', null)
      .lte('expires_at', new Date().toISOString());

    if (error) return 0;
    return count || 0;
  }

  async close(): Promise<void> {
    // Supabase JS client doesn't require explicit close
    this.client = null;
    this.adminClient = null;
  }

  // ─── Private ───────────────────────────────────────────

  private entryToRow(entry: MemoryEntry): Record<string, any> {
    const row: Record<string, any> = {
      id: entry.id,
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: entry.tags || [],
      metadata: entry.metadata || {},
      relevance: entry.relevance ?? 0.7,
      confidence: entry.confidence ?? 0.8,
      access_count: entry.accessCount || 0,
      last_accessed_at: entry.lastAccessedAt || new Date().toISOString(),
      ttl: entry.ttl || null,
      expires_at: entry.expiresAt || null,
      created_at: entry.createdAt || new Date().toISOString(),
      updated_at: entry.updatedAt || new Date().toISOString(),
    };

    if (entry.embedding?.length) {
      row.embedding = `[${entry.embedding.join(',')}]`;
    }

    return row;
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content || '',
      layer: (row.layer || 'longterm') as MemoryLayer,
      namespace: row.namespace || 'default',
      tags: row.tags || [],
      metadata: row.metadata || {},
      relevance: row.relevance ?? 0.7,
      confidence: row.confidence ?? 0.8,
      accessCount: row.access_count || 0,
      lastAccessedAt: row.last_accessed_at || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      ttl: row.ttl || null,
      expiresAt: row.expires_at || null,
    };
  }

  private applyFilter(query: any, filter: MemoryFilter): any {
    if (filter.namespace) query = query.eq('namespace', filter.namespace);
    if (filter.layer) query = query.eq('layer', filter.layer);
    if (filter.tags?.length) query = query.contains('tags', filter.tags);
    if (filter.olderThan) query = query.lt('created_at', filter.olderThan);
    if (filter.newerThan) query = query.gt('created_at', filter.newerThan);
    return query;
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
