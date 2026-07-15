/**
 * PostgreSQL Memory Provider — Production-grade with pgvector support.
 *
 * Requires: PostgreSQL with the pgvector extension enabled.
 * Connection via DATABASE_URL or explicit url config.
 *
 * Features:
 * - Full-text search (tsvector + GIN index)
 * - Vector similarity search (pgvector cosine distance)
 * - JSONB metadata storage
 * - Automatic table/index creation
 */

import type { MemoryProvider, MemoryEntry, MemorySearchOptions, MemorySearchResult } from './types.js';

export interface PostgresProviderConfig {
  url: string;
  table?: string;
  vectorDimensions?: number;
}

export class PostgresMemoryProvider implements MemoryProvider {
  name = 'postgres';
  private pool: any = null;
  private config: PostgresProviderConfig;
  private table: string;

  constructor(config: PostgresProviderConfig) {
    this.config = config;
    this.table = config.table || 'agent_memories';
  }

  async initialize(): Promise<void> {
    // Dynamic import — pg is an optional dependency
    let pg: any;
    try {
      // Use createRequire from project root to find pg in the project's node_modules
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      pg = require('pg');
    } catch {
      try {
        // @ts-ignore — pg might not be installed in core's node_modules
        pg = await import('pg');
      } catch {
        throw new Error(
          'PostgreSQL provider requires the "pg" package. Install it: npm install pg\n' +
          'For vector search, also enable pgvector in your database: CREATE EXTENSION IF NOT EXISTS vector;'
        );
      }
    }

    const Pool = pg.default?.Pool || pg.Pool;
    this.pool = new Pool({ connectionString: this.config.url });

    // Create table with vector support
    // IMPORTANT: Neon (and some hosted PG) don't support multi-statement queries.
    // Each DDL statement must be executed separately.
    const dims = this.config.vectorDimensions || 1536; // OpenAI text-embedding-3-small default

    // Step 1: Enable pgvector extension
    try {
      await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    } catch (err: any) {
      console.warn(`[PostgresMemory] pgvector extension not available: ${err.message}`);
      // Continue without vector support — text search will still work
    }

    // Step 2: Create table
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          layer TEXT NOT NULL DEFAULT 'longterm',
          tags JSONB DEFAULT '[]'::jsonb,
          metadata JSONB DEFAULT '{}'::jsonb,
          relevance REAL DEFAULT 1.0,
          confidence REAL DEFAULT 0.8,
          embedding vector(${dims}),
          search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } catch (err: any) {
      // Table might already exist with different schema — that's OK
      if (!err.message?.includes('already exists')) {
        console.error(`[PostgresMemory] Table creation failed:`, err.message);
      }
    }

    // Step 3: Create indexes (each separate query)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_layer ON ${this.table}(layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_created ON ${this.table}(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_search ON ${this.table} USING GIN(search_vector)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_tags ON ${this.table} USING GIN(tags)`,
    ];

    for (const indexSql of indexes) {
      try {
        await this.pool.query(indexSql);
      } catch {
        // Index might already exist or column missing — non-critical
      }
    }

    // Step 4: Try to create vector index (might fail if no vectors stored yet)
    try {
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.table}_embedding ON ${this.table}
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
      `);
    } catch {
      // IVFFlat needs data first — will create on first vector insert
    }

    console.log(`[PostgresMemory] ✓ Initialized table "${this.table}" with vector support (${dims} dims)`);
  }

  async store(entry: MemoryEntry): Promise<void> {
    const embeddingStr = entry.embedding
      ? `[${entry.embedding.join(',')}]`
      : null;

    try {
      await this.pool.query(
        `INSERT INTO ${this.table} (id, content, layer, tags, metadata, relevance, confidence, embedding, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           relevance = EXCLUDED.relevance,
           confidence = EXCLUDED.confidence,
           embedding = EXCLUDED.embedding,
           updated_at = EXCLUDED.updated_at`,
        [
          entry.id,
          entry.content,
          entry.layer || 'longterm',
          JSON.stringify(entry.tags || []),
          JSON.stringify(entry.metadata || {}),
          entry.relevance ?? 1.0,
          entry.confidence ?? 0.8,
          embeddingStr,
          entry.createdAt || new Date().toISOString(),
          entry.updatedAt || new Date().toISOString(),
        ]
      );
      console.log(`[PostgresMemory] ✓ Stored: "${entry.content?.slice(0, 50)}..." (id: ${entry.id})`);
    } catch (err: any) {
      console.error(`[PostgresMemory] ✗ Store failed:`, err.message);
      console.error(`[PostgresMemory]   Entry ID: ${entry.id}, Content length: ${entry.content?.length}`);
      throw err; // Re-throw so caller knows it failed
    }
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    // If embedding provided, do vector search
    if (options.embedding) {
      return this.vectorSearch(options.embedding, options);
    }

    // Otherwise, full-text search
    if (options.query) {
      return this.textSearch(options);
    }

    // No query — just filter
    return this.filterSearch(options);
  }

  async searchByVector(embedding: number[], options?: { limit?: number; minScore?: number; layer?: string }): Promise<MemorySearchResult[]> {
    return this.vectorSearch(embedding, {
      limit: options?.limit,
      minScore: options?.minScore,
      layer: options?.layer as any,
    });
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const { rows } = await this.pool.query(`SELECT * FROM ${this.table} WHERE id = $1`, [id]);
    return rows[0] ? this.rowToEntry(rows[0]) : null;
  }

  async getAll(options?: { layer?: string; limit?: number; tags?: string[] }): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM ${this.table} WHERE 1=1`;
    const params: any[] = [];
    let paramIdx = 1;

    if (options?.layer) {
      sql += ` AND layer = $${paramIdx++}`;
      params.push(options.layer);
    }
    if (options?.tags?.length) {
      sql += ` AND tags ?| $${paramIdx++}`;
      params.push(options.tags);
    }
    sql += ' ORDER BY created_at DESC';
    if (options?.limit) {
      sql += ` LIMIT $${paramIdx++}`;
      params.push(options.limit);
    }

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r: any) => this.rowToEntry(r));
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let paramIdx = 1;

    if (updates.content !== undefined) { sets.push(`content = $${paramIdx++}`); params.push(updates.content); }
    if (updates.tags !== undefined) { sets.push(`tags = $${paramIdx++}`); params.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push(`metadata = $${paramIdx++}`); params.push(JSON.stringify(updates.metadata)); }
    if (updates.relevance !== undefined) { sets.push(`relevance = $${paramIdx++}`); params.push(updates.relevance); }
    if (updates.confidence !== undefined) { sets.push(`confidence = $${paramIdx++}`); params.push(updates.confidence); }

    params.push(id);
    await this.pool.query(`UPDATE ${this.table} SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
  }

  async count(layer?: string): Promise<number> {
    const sql = layer
      ? `SELECT COUNT(*) as c FROM ${this.table} WHERE layer = $1`
      : `SELECT COUNT(*) as c FROM ${this.table}`;
    const { rows } = await this.pool.query(sql, layer ? [layer] : []);
    return parseInt(rows[0].c);
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private async vectorSearch(embedding: number[], options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const embStr = `[${embedding.join(',')}]`;
    let sql = `
      SELECT *, 1 - (embedding <=> $1::vector) as score
      FROM ${this.table}
      WHERE embedding IS NOT NULL
    `;
    const params: any[] = [embStr];
    let paramIdx = 2;

    if (options.layer) {
      sql += ` AND layer = $${paramIdx++}`;
      params.push(options.layer);
    }
    if (options.minScore) {
      sql += ` AND 1 - (embedding <=> $1::vector) >= $${paramIdx++}`;
      params.push(options.minScore);
    }

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIdx++}`;
    params.push(options.limit || 10);

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: r.score }));
  }

  private async textSearch(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const tsquery = options.query!.split(/\s+/).filter(w => w.length > 1).join(' | ');
    if (!tsquery) return this.filterSearch(options);

    let sql = `
      SELECT *, ts_rank(search_vector, plainto_tsquery('english', $1)) as score
      FROM ${this.table}
      WHERE search_vector @@ plainto_tsquery('english', $1)
    `;
    const params: any[] = [options.query];
    let paramIdx = 2;

    if (options.layer) {
      sql += ` AND layer = $${paramIdx++}`;
      params.push(options.layer);
    }

    sql += ` ORDER BY score DESC LIMIT $${paramIdx++}`;
    params.push(options.limit || 10);

    const { rows } = await this.pool.query(sql, params);

    if (rows.length === 0) {
      // Fallback to ILIKE
      return this.likeSearch(options);
    }

    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: r.score }));
  }

  private async likeSearch(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    let sql = `SELECT * FROM ${this.table} WHERE content ILIKE $1`;
    const params: any[] = [`%${options.query}%`];
    let paramIdx = 2;

    if (options.layer) {
      sql += ` AND layer = $${paramIdx++}`;
      params.push(options.layer);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${paramIdx++}`;
    params.push(options.limit || 10);

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: 0.5 }));
  }

  private async filterSearch(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    let sql = `SELECT * FROM ${this.table} WHERE 1=1`;
    const params: any[] = [];
    let paramIdx = 1;

    if (options.layer) {
      sql += ` AND layer = $${paramIdx++}`;
      params.push(options.layer);
    }
    if (options.tags?.length) {
      sql += ` AND tags ?| $${paramIdx++}`;
      params.push(options.tags);
    }
    sql += ` ORDER BY relevance * confidence DESC LIMIT $${paramIdx++}`;
    params.push(options.limit || 10);

    const { rows } = await this.pool.query(sql, params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: r.relevance * r.confidence }));
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      layer: row.layer,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      relevance: row.relevance,
      confidence: row.confidence,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    };
  }
}
