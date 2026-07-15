/**
 * Turso/LibSQL Memory Adapter — Edge-compatible SQLite implementation of MemoryAdapter.
 *
 * Features:
 *   - Uses @libsql/client (async API, unlike better-sqlite3)
 *   - Supports remote Turso databases and local files
 *   - FTS5 for full-text search (when supported by the instance)
 *   - Cosine similarity computed in JavaScript for vector search
 *   - Edge-compatible (works in Cloudflare Workers, Deno Deploy, etc.)
 *
 * Requires: @libsql/client (optional peer dependency).
 * Best for: Edge computing, serverless, globally replicated SQLite.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface TursoAdapterConfig {
  /** Turso/LibSQL URL (e.g., libsql://your-db.turso.io or file:local.db) */
  url: string;
  /** Turso auth token (required for remote databases) */
  authToken?: string;
  /** Table name (default: 'kernova_memories') */
  table?: string;
}

export class TursoMemoryAdapter implements MemoryAdapter {
  readonly name = 'turso';
  private client: any = null;
  private config: TursoAdapterConfig;
  private table: string;
  private hasFts = false;

  constructor(config: TursoAdapterConfig) {
    this.config = config;
    this.table = config.table || 'kernova_memories';
  }

  async initialize(): Promise<void> {
    let libsql: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      libsql = require('@libsql/client');
    } catch {
      try {
        libsql = await (Function('m', 'return import(m)')('@libsql/client'));
      } catch {
        throw new Error('Turso adapter requires "@libsql/client" package. Install: npm install @libsql/client');
      }
    }

    const createClient = libsql.createClient || libsql.default?.createClient;
    this.client = createClient({
      url: this.config.url,
      authToken: this.config.authToken,
    });

    // Create main table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        layer TEXT NOT NULL DEFAULT 'longterm',
        namespace TEXT NOT NULL DEFAULT 'default',
        tags TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        embedding TEXT,
        relevance REAL DEFAULT 0.7,
        confidence REAL DEFAULT 0.8,
        access_count INTEGER DEFAULT 0,
        last_accessed_at TEXT,
        ttl INTEGER,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Create indexes (one per statement)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_layer ON ${this.table}(layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_namespace ON ${this.table}(namespace)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_ns_layer ON ${this.table}(namespace, layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_created ON ${this.table}(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_accessed ON ${this.table}(last_accessed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_expires ON ${this.table}(expires_at)`,
    ];

    for (const sql of indexes) {
      try { await this.client.execute(sql); } catch {}
    }

    // Try to create FTS5 virtual table
    try {
      await this.client.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table}_fts
        USING fts5(id, content, tokenize='porter unicode61')
      `);
      this.hasFts = true;

      // Triggers to keep FTS in sync
      await this.client.execute(`
        CREATE TRIGGER IF NOT EXISTS ${this.table}_fts_insert
        AFTER INSERT ON ${this.table}
        BEGIN
          INSERT OR REPLACE INTO ${this.table}_fts(id, content) VALUES (NEW.id, NEW.content);
        END
      `);
      await this.client.execute(`
        CREATE TRIGGER IF NOT EXISTS ${this.table}_fts_update
        AFTER UPDATE OF content ON ${this.table}
        BEGIN
          UPDATE ${this.table}_fts SET content = NEW.content WHERE id = NEW.id;
        END
      `);
      await this.client.execute(`
        CREATE TRIGGER IF NOT EXISTS ${this.table}_fts_delete
        AFTER DELETE ON ${this.table}
        BEGIN
          DELETE FROM ${this.table}_fts WHERE id = OLD.id;
        END
      `);
    } catch {
      this.hasFts = false;
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const embeddingStr = entry.embedding ? JSON.stringify(entry.embedding) : null;

    await this.client.execute({
      sql: `INSERT OR REPLACE INTO ${this.table}
        (id, content, layer, namespace, tags, metadata, embedding, relevance, confidence, access_count, last_accessed_at, ttl, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.id, entry.content, entry.layer, entry.namespace,
        JSON.stringify(entry.tags || []), JSON.stringify(entry.metadata || {}),
        embeddingStr, entry.relevance ?? 0.7, entry.confidence ?? 0.8,
        entry.accessCount || 0, entry.lastAccessedAt || new Date().toISOString(),
        entry.ttl || null, entry.expiresAt || null,
        entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString(),
      ],
    });
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const statements = entries.map(entry => ({
      sql: `INSERT OR REPLACE INTO ${this.table}
        (id, content, layer, namespace, tags, metadata, embedding, relevance, confidence, access_count, last_accessed_at, ttl, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.id, entry.content, entry.layer, entry.namespace,
        JSON.stringify(entry.tags || []), JSON.stringify(entry.metadata || {}),
        entry.embedding ? JSON.stringify(entry.embedding) : null,
        entry.relevance ?? 0.7, entry.confidence ?? 0.8,
        entry.accessCount || 0, entry.lastAccessedAt || new Date().toISOString(),
        entry.ttl || null, entry.expiresAt || null,
        entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString(),
      ],
    }));

    await this.client.batch(statements, 'write');
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM ${this.table} WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row ? this.rowToEntry(row) : null;
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const result = await this.client.execute({
      sql: `SELECT * FROM ${this.table} WHERE id IN (${placeholders})`,
      args: ids,
    });
    return result.rows.map((r: any) => this.rowToEntry(r));
  }

  async delete(id: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM ${this.table} WHERE id = ?`,
      args: [id],
    });
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.client.execute({
      sql: `DELETE FROM ${this.table} WHERE id IN (${placeholders})`,
      args: ids,
    });
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    let sql = `DELETE FROM ${this.table} WHERE 1=1`;
    const args: any[] = [];

    if (filter.namespace) { sql += ` AND namespace = ?`; args.push(filter.namespace); }
    if (filter.layer) { sql += ` AND layer = ?`; args.push(filter.layer); }
    if (filter.olderThan) { sql += ` AND created_at < ?`; args.push(filter.olderThan); }
    if (filter.tags?.length) {
      for (const tag of filter.tags) {
        sql += ` AND tags LIKE ?`;
        args.push(`%"${tag}"%`);
      }
    }

    const result = await this.client.execute({ sql, args });
    return result.rowsAffected || 0;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const sets: string[] = ['updated_at = ?'];
    const args: any[] = [new Date().toISOString()];

    if (updates.content !== undefined) { sets.push('content = ?'); args.push(updates.content); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); args.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push('metadata = ?'); args.push(JSON.stringify(updates.metadata)); }
    if (updates.relevance !== undefined) { sets.push('relevance = ?'); args.push(updates.relevance); }
    if (updates.confidence !== undefined) { sets.push('confidence = ?'); args.push(updates.confidence); }
    if (updates.accessCount !== undefined) { sets.push('access_count = ?'); args.push(updates.accessCount); }
    if (updates.lastAccessedAt !== undefined) { sets.push('last_accessed_at = ?'); args.push(updates.lastAccessedAt); }
    if (updates.namespace !== undefined) { sets.push('namespace = ?'); args.push(updates.namespace); }
    if (updates.embedding !== undefined) { sets.push('embedding = ?'); args.push(JSON.stringify(updates.embedding)); }

    args.push(id);
    await this.client.execute({
      sql: `UPDATE ${this.table} SET ${sets.join(', ')} WHERE id = ?`,
      args,
    });
  }

  async count(filter?: MemoryFilter): Promise<number> {
    let sql = `SELECT COUNT(*) as c FROM ${this.table} WHERE 1=1`;
    const args: any[] = [];

    if (filter?.namespace) { sql += ` AND namespace = ?`; args.push(filter.namespace); }
    if (filter?.layer) { sql += ` AND layer = ?`; args.push(filter.layer); }

    const result = await this.client.execute({ sql, args });
    return Number(result.rows[0]?.c) || 0;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // No native vector support — load entries with embeddings and compute cosine in JS
    let sql = `SELECT * FROM ${this.table} WHERE embedding IS NOT NULL`;
    const args: any[] = [];

    if (options.namespace) { sql += ` AND namespace = ?`; args.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = ?`; args.push(options.layer); }
    if (options.tags?.length) {
      for (const tag of options.tags) {
        sql += ` AND tags LIKE ?`;
        args.push(`%"${tag}"%`);
      }
    }
    sql += ` AND (expires_at IS NULL OR expires_at > ?)`;
    args.push(new Date().toISOString());

    const result = await this.client.execute({ sql, args });
    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];

    for (const row of result.rows) {
      let storedEmbedding: number[];
      try {
        storedEmbedding = JSON.parse(row.embedding as string);
      } catch {
        continue;
      }

      const similarity = cosineSimilarity(embedding, storedEmbedding);
      if (similarity >= (options.minScore || 0)) {
        results.push({ entry: this.rowToEntry(row), similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Try FTS5 first
    if (this.hasFts) {
      try {
        let sql = `
          SELECT m.*, fts.rank as score
          FROM ${this.table}_fts fts
          JOIN ${this.table} m ON m.id = fts.id
          WHERE ${this.table}_fts MATCH ?
        `;
        const args: any[] = [query];

        if (options.namespace) { sql += ` AND m.namespace = ?`; args.push(options.namespace); }
        if (options.layer) { sql += ` AND m.layer = ?`; args.push(options.layer); }
        if (options.tags?.length) {
          for (const tag of options.tags) {
            sql += ` AND m.tags LIKE ?`;
            args.push(`%"${tag}"%`);
          }
        }
        sql += ` AND (m.expires_at IS NULL OR m.expires_at > ?)`;
        args.push(new Date().toISOString());
        sql += ` ORDER BY fts.rank LIMIT ?`;
        args.push(options.limit);

        const result = await this.client.execute({ sql, args });
        if (result.rows.length > 0) {
          return result.rows.map((r: any) => ({
            entry: this.rowToEntry(r),
            score: Math.abs(r.score || 0.5),
          }));
        }
      } catch {
        // FTS5 query failed, fall through
      }
    }

    // Fallback to LIKE search
    let sql = `SELECT * FROM ${this.table} WHERE content LIKE ?`;
    const args: any[] = [`%${query}%`];

    if (options.namespace) { sql += ` AND namespace = ?`; args.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = ?`; args.push(options.layer); }
    if (options.tags?.length) {
      for (const tag of options.tags) {
        sql += ` AND tags LIKE ?`;
        args.push(`%"${tag}"%`);
      }
    }
    sql += ` AND (expires_at IS NULL OR expires_at > ?)`;
    args.push(new Date().toISOString());
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    args.push(options.limit);

    const result = await this.client.execute({ sql, args });
    return result.rows.map((r: any) => ({ entry: this.rowToEntry(r), score: 0.4 }));
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM ${this.table} WHERE (expires_at IS NULL OR expires_at > ?)`;
    const args: any[] = [new Date().toISOString()];

    if (options.namespace) { sql += ` AND namespace = ?`; args.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = ?`; args.push(options.layer); }
    if (options.tags?.length) {
      for (const tag of options.tags) {
        sql += ` AND tags LIKE ?`;
        args.push(`%"${tag}"%`);
      }
    }

    const orderCol = options.orderBy === 'updatedAt' ? 'updated_at'
      : options.orderBy === 'lastAccessedAt' ? 'last_accessed_at'
      : options.orderBy === 'relevance' ? 'relevance'
      : 'created_at';
    sql += ` ORDER BY ${orderCol} ${options.order || 'DESC'}`;
    sql += ` LIMIT ?`;
    args.push(options.limit || 50);
    if (options.offset) { sql += ` OFFSET ?`; args.push(options.offset); }

    const result = await this.client.execute({ sql, args });
    return result.rows.map((r: any) => this.rowToEntry(r));
  }

  async expireEntries(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.client.execute({
      sql: `DELETE FROM ${this.table} WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      args: [now],
    });
    return result.rowsAffected || 0;
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content || '',
      layer: (row.layer || 'longterm') as MemoryLayer,
      namespace: row.namespace || 'default',
      tags: safeParse(row.tags, []),
      metadata: safeParse(row.metadata, {}),
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
