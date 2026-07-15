/**
 * PostgreSQL Memory Adapter — Production-grade implementation of MemoryAdapter.
 *
 * Features:
 *   - pgvector for semantic similarity search
 *   - Full-text search via tsvector + GIN index
 *   - JSONB for flexible metadata
 *   - Namespace partitioning
 *   - TTL-based expiration
 *   - Access count tracking
 *   - Batch operations
 *
 * Requires: PostgreSQL 14+ with pgvector extension.
 * Works with: Neon, Supabase, AWS RDS, self-hosted, etc.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface PostgresAdapterConfig {
  /** PostgreSQL connection URL */
  url: string;
  /** Table name (default: 'kernova_memories') */
  table?: string;
  /** Vector dimensions (default: 1536 for text-embedding-3-small) */
  vectorDimensions?: number;
  /** Schema name (default: 'public') */
  schema?: string;
}

export class PostgresMemoryAdapter implements MemoryAdapter {
  readonly name = 'postgres';
  private pool: any = null;
  private config: PostgresAdapterConfig;
  private table: string;
  private schema: string;

  constructor(config: PostgresAdapterConfig) {
    this.config = config;
    this.table = config.table || 'kernova_memories';
    this.schema = config.schema || 'public';
  }

  async initialize(): Promise<void> {
    // Dynamic import of pg
    let pg: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      pg = require('pg');
    } catch {
      try {
        // @ts-ignore — pg is an optional peer dependency
        pg = await (Function('m', 'return import(m)')('pg'));
      } catch {
        throw new Error('PostgreSQL adapter requires "pg" package. Install: npm install pg');
      }
    }

    const Pool = pg.default?.Pool || pg.Pool;
    this.pool = new Pool({ connectionString: this.config.url });

    const dims = this.config.vectorDimensions || 1536;
    const t = `${this.schema}.${this.table}`;

    // Enable pgvector
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch {
      // pgvector not available — vector search will be disabled
    }

    // Create table (each statement separate for Neon compatibility)
    try {
      await this.pool.query(`
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
      `);
    } catch (err: any) {
      if (!err.message?.includes('already exists')) {
        console.error(`[PostgresAdapter] Table creation failed:`, err.message);
      }
    }

    // Create indexes (each separate)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_layer ON ${t}(layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_namespace ON ${t}(namespace)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_ns_layer ON ${t}(namespace, layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_created ON ${t}(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_accessed ON ${t}(last_accessed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_expires ON ${t}(expires_at) WHERE expires_at IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_search ON ${t} USING GIN(search_vector)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_tags ON ${t} USING GIN(tags)`,
    ];

    for (const sql of indexes) {
      try { await this.pool.query(sql); } catch {}
    }

    // Vector index (needs data to work with IVFFlat)
    try {
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.table}_embedding ON ${t}
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
      `);
    } catch {}
  }

  async store(entry: MemoryEntry): Promise<void> {
    const t = `${this.schema}.${this.table}`;
    const embeddingStr = entry.embedding ? `[${entry.embedding.join(',')}]` : null;

    await this.pool.query(
      `INSERT INTO ${t} (id, content, layer, namespace, tags, metadata, embedding, relevance, confidence, access_count, last_accessed_at, ttl, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content, tags = EXCLUDED.tags, metadata = EXCLUDED.metadata,
         embedding = EXCLUDED.embedding, relevance = EXCLUDED.relevance, confidence = EXCLUDED.confidence,
         updated_at = EXCLUDED.updated_at`,
      [
        entry.id, entry.content, entry.layer, entry.namespace,
        JSON.stringify(entry.tags || []), JSON.stringify(entry.metadata || {}),
        embeddingStr, entry.relevance ?? 0.7, entry.confidence ?? 0.8,
        entry.accessCount || 0, entry.lastAccessedAt || new Date().toISOString(),
        entry.ttl || null, entry.expiresAt || null,
        entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString(),
      ]
    );
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    // Use a transaction for batch efficiency
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        await this.store(entry); // Reuse single-entry logic
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const t = `${this.schema}.${this.table}`;
    const { rows } = await this.pool.query(`SELECT * FROM ${t} WHERE id = $1`, [id]);
    return rows[0] ? this.rowToEntry(rows[0]) : null;
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const t = `${this.schema}.${this.table}`;
    const { rows } = await this.pool.query(`SELECT * FROM ${t} WHERE id = ANY($1)`, [ids]);
    return rows.map((r: any) => this.rowToEntry(r));
  }

  async delete(id: string): Promise<void> {
    const t = `${this.schema}.${this.table}`;
    await this.pool.query(`DELETE FROM ${t} WHERE id = $1`, [id]);
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const t = `${this.schema}.${this.table}`;
    await this.pool.query(`DELETE FROM ${t} WHERE id = ANY($1)`, [ids]);
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const t = `${this.schema}.${this.table}`;
    let sql = `DELETE FROM ${t} WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;

    if (filter.namespace) { sql += ` AND namespace = $${idx++}`; params.push(filter.namespace); }
    if (filter.layer) { sql += ` AND layer = $${idx++}`; params.push(filter.layer); }
    if (filter.olderThan) { sql += ` AND created_at < $${idx++}`; params.push(filter.olderThan); }
    if (filter.tags?.length) { sql += ` AND tags ?| $${idx++}`; params.push(filter.tags); }

    const { rowCount } = await this.pool.query(sql, params);
    return rowCount || 0;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const t = `${this.schema}.${this.table}`;
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let idx = 1;

    if (updates.content !== undefined) { sets.push(`content = $${idx++}`); params.push(updates.content); }
    if (updates.tags !== undefined) { sets.push(`tags = $${idx++}`); params.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(updates.metadata)); }
    if (updates.relevance !== undefined) { sets.push(`relevance = $${idx++}`); params.push(updates.relevance); }
    if (updates.confidence !== undefined) { sets.push(`confidence = $${idx++}`); params.push(updates.confidence); }
    if (updates.accessCount !== undefined) { sets.push(`access_count = $${idx++}`); params.push(updates.accessCount); }
    if (updates.lastAccessedAt !== undefined) { sets.push(`last_accessed_at = $${idx++}`); params.push(updates.lastAccessedAt); }
    if (updates.namespace !== undefined) { sets.push(`namespace = $${idx++}`); params.push(updates.namespace); }
    if (updates.embedding !== undefined) {
      const embStr = `[${updates.embedding.join(',')}]`;
      sets.push(`embedding = $${idx++}::vector`); params.push(embStr);
    }

    params.push(id);
    await this.pool.query(`UPDATE ${t} SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    const t = `${this.schema}.${this.table}`;
    let sql = `SELECT COUNT(*) as c FROM ${t} WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;

    if (filter?.namespace) { sql += ` AND namespace = $${idx++}`; params.push(filter.namespace); }
    if (filter?.layer) { sql += ` AND layer = $${idx++}`; params.push(filter.layer); }

    const { rows } = await this.pool.query(sql, params);
    return parseInt(rows[0].c);
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    const t = `${this.schema}.${this.table}`;
    const embStr = `[${embedding.join(',')}]`;

    let sql = `
      SELECT *, 1 - (embedding <=> $1::vector) as similarity
      FROM ${t}
      WHERE embedding IS NOT NULL
    `;
    const params: any[] = [embStr];
    let idx = 2;

    if (options.namespace) { sql += ` AND namespace = $${idx++}`; params.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = $${idx++}`; params.push(options.layer); }
    if (options.minScore) { sql += ` AND 1 - (embedding <=> $1::vector) >= $${idx++}`; params.push(options.minScore); }
    if (options.tags?.length) { sql += ` AND tags ?| $${idx++}`; params.push(options.tags); }

    // Exclude expired
    sql += ` AND (expires_at IS NULL OR expires_at > NOW())`;

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${idx++}`;
    params.push(options.limit);

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), similarity: parseFloat(r.similarity) }));
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    const t = `${this.schema}.${this.table}`;

    // Try full-text search first
    let sql = `
      SELECT *, ts_rank(search_vector, plainto_tsquery('english', $1)) as score
      FROM ${t}
      WHERE search_vector @@ plainto_tsquery('english', $1)
    `;
    const params: any[] = [query];
    let idx = 2;

    if (options.namespace) { sql += ` AND namespace = $${idx++}`; params.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = $${idx++}`; params.push(options.layer); }
    if (options.tags?.length) { sql += ` AND tags ?| $${idx++}`; params.push(options.tags); }
    sql += ` AND (expires_at IS NULL OR expires_at > NOW())`;
    sql += ` ORDER BY score DESC LIMIT $${idx++}`;
    params.push(options.limit);

    const { rows } = await this.pool.query(sql, params);

    if (rows.length > 0) {
      return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: parseFloat(r.score) }));
    }

    // Fallback to ILIKE
    const likeSql = `SELECT * FROM ${t} WHERE content ILIKE $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT $2`;
    const likeRows = await this.pool.query(likeSql, [`%${query}%`, options.limit]);
    return likeRows.rows.map((r: any) => ({ entry: this.rowToEntry(r), score: 0.4 }));
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: string; order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    const t = `${this.schema}.${this.table}`;
    let sql = `SELECT * FROM ${t} WHERE (expires_at IS NULL OR expires_at > NOW())`;
    const params: any[] = [];
    let idx = 1;

    if (options.namespace) { sql += ` AND namespace = $${idx++}`; params.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = $${idx++}`; params.push(options.layer); }
    if (options.tags?.length) { sql += ` AND tags ?| $${idx++}`; params.push(options.tags); }

    const orderCol = options.orderBy === 'updatedAt' ? 'updated_at'
      : options.orderBy === 'lastAccessedAt' ? 'last_accessed_at'
      : options.orderBy === 'relevance' ? 'relevance'
      : 'created_at';
    sql += ` ORDER BY ${orderCol} ${options.order || 'desc'}`;
    sql += ` LIMIT $${idx++}`;
    params.push(options.limit || 50);
    if (options.offset) { sql += ` OFFSET $${idx++}`; params.push(options.offset); }

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r: any) => this.rowToEntry(r));
  }

  async expireEntries(): Promise<number> {
    const t = `${this.schema}.${this.table}`;
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${t} WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
    );
    return rowCount || 0;
  }

  async close(): Promise<void> {
    if (this.pool) { await this.pool.end(); this.pool = null; }
  }

  // ─── Private ───────────────────────────────────────────

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      layer: row.layer as MemoryLayer,
      namespace: row.namespace || 'default',
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      relevance: row.relevance ?? 0.7,
      confidence: row.confidence ?? 0.8,
      accessCount: row.access_count || 0,
      lastAccessedAt: row.last_accessed_at?.toISOString?.() || row.last_accessed_at || '',
      createdAt: row.created_at?.toISOString?.() || row.created_at || '',
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at || '',
      ttl: row.ttl || null,
      expiresAt: row.expires_at?.toISOString?.() || row.expires_at || null,
    };
  }
}
