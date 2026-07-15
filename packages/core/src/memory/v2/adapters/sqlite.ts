/**
 * SQLite Memory Adapter — Local-first implementation of MemoryAdapter.
 *
 * Features:
 *   - FTS5 for full-text search
 *   - Cosine similarity computed in JavaScript (no native vector support)
 *   - Embeddings stored as JSON text
 *   - Zero-config (single file database)
 *   - Great for local development and small-scale production
 *
 * Requires: better-sqlite3 (optional peer dependency).
 * Note: better-sqlite3 is synchronous — all methods are wrapped in async.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface SqliteAdapterConfig {
  /** Path to SQLite database file (default: './kernova-data/memory.db') */
  path?: string;
  /** Table name (default: 'kernova_memories') */
  table?: string;
}

export class SqliteMemoryAdapter implements MemoryAdapter {
  readonly name = 'sqlite';
  private db: any = null;
  private config: SqliteAdapterConfig;
  private table: string;

  constructor(config: SqliteAdapterConfig = {}) {
    this.config = config;
    this.table = config.table || 'kernova_memories';
  }

  async initialize(): Promise<void> {
    // Dynamic import of better-sqlite3
    let Database: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      Database = require('better-sqlite3');
    } catch {
      try {
        // @ts-ignore — better-sqlite3 is an optional peer dependency
        const mod = await (Function('m', 'return import(m)')('better-sqlite3'));
        Database = mod.default || mod;
      } catch {
        throw new Error('SQLite adapter requires "better-sqlite3" package. Install: npm install better-sqlite3');
      }
    }

    const dbPath = this.config.path || './kernova-data/memory.db';

    // Ensure directory exists
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    try { mkdirSync(dirname(dbPath), { recursive: true }); } catch {}

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent reads
    this.db.pragma('journal_mode = WAL');

    // Create main table
    this.db.exec(`
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

    // Create indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_layer ON ${this.table}(layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_namespace ON ${this.table}(namespace)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_ns_layer ON ${this.table}(namespace, layer)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_created ON ${this.table}(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_accessed ON ${this.table}(last_accessed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_expires ON ${this.table}(expires_at)`,
    ];

    for (const sql of indexes) {
      try { this.db.exec(sql); } catch {}
    }

    // Create FTS5 virtual table for full-text search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table}_fts
        USING fts5(id, content, tokenize='porter unicode61')
      `);
    } catch {
      // FTS5 may not be available in all SQLite builds
    }

    // Create triggers to keep FTS in sync
    try {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${this.table}_fts_insert
        AFTER INSERT ON ${this.table}
        BEGIN
          INSERT OR REPLACE INTO ${this.table}_fts(id, content) VALUES (NEW.id, NEW.content);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${this.table}_fts_update
        AFTER UPDATE OF content ON ${this.table}
        BEGIN
          UPDATE ${this.table}_fts SET content = NEW.content WHERE id = NEW.id;
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${this.table}_fts_delete
        AFTER DELETE ON ${this.table}
        BEGIN
          DELETE FROM ${this.table}_fts WHERE id = OLD.id;
        END
      `);
    } catch {
      // Triggers may fail if FTS table doesn't exist
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const embeddingStr = entry.embedding ? JSON.stringify(entry.embedding) : null;

    this.db.prepare(`
      INSERT OR REPLACE INTO ${this.table}
      (id, content, layer, namespace, tags, metadata, embedding, relevance, confidence, access_count, last_accessed_at, ttl, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.content, entry.layer, entry.namespace,
      JSON.stringify(entry.tags || []), JSON.stringify(entry.metadata || {}),
      embeddingStr, entry.relevance ?? 0.7, entry.confidence ?? 0.8,
      entry.accessCount || 0, entry.lastAccessedAt || new Date().toISOString(),
      entry.ttl || null, entry.expiresAt || null,
      entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString(),
    );
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    const transaction = this.db.transaction((items: MemoryEntry[]) => {
      for (const entry of items) {
        const embeddingStr = entry.embedding ? JSON.stringify(entry.embedding) : null;
        this.db.prepare(`
          INSERT OR REPLACE INTO ${this.table}
          (id, content, layer, namespace, tags, metadata, embedding, relevance, confidence, access_count, last_accessed_at, ttl, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entry.id, entry.content, entry.layer, entry.namespace,
          JSON.stringify(entry.tags || []), JSON.stringify(entry.metadata || {}),
          embeddingStr, entry.relevance ?? 0.7, entry.confidence ?? 0.8,
          entry.accessCount || 0, entry.lastAccessedAt || new Date().toISOString(),
          entry.ttl || null, entry.expiresAt || null,
          entry.createdAt || new Date().toISOString(), entry.updatedAt || new Date().toISOString(),
        );
      }
    });
    transaction(entries);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id);
    return row ? this.rowToEntry(row) : null;
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM ${this.table} WHERE id IN (${placeholders})`).all(...ids);
    return rows.map((r: any) => this.rowToEntry(r));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id);
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM ${this.table} WHERE id IN (${placeholders})`).run(...ids);
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    let sql = `DELETE FROM ${this.table} WHERE 1=1`;
    const params: any[] = [];

    if (filter.namespace) { sql += ` AND namespace = ?`; params.push(filter.namespace); }
    if (filter.layer) { sql += ` AND layer = ?`; params.push(filter.layer); }
    if (filter.olderThan) { sql += ` AND created_at < ?`; params.push(filter.olderThan); }
    if (filter.tags?.length) {
      // Check if any tag matches (JSON array stored as text)
      for (const tag of filter.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }

    const result = this.db.prepare(sql).run(...params);
    return result.changes || 0;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [new Date().toISOString()];

    if (updates.content !== undefined) { sets.push('content = ?'); params.push(updates.content); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    if (updates.metadata !== undefined) { sets.push('metadata = ?'); params.push(JSON.stringify(updates.metadata)); }
    if (updates.relevance !== undefined) { sets.push('relevance = ?'); params.push(updates.relevance); }
    if (updates.confidence !== undefined) { sets.push('confidence = ?'); params.push(updates.confidence); }
    if (updates.accessCount !== undefined) { sets.push('access_count = ?'); params.push(updates.accessCount); }
    if (updates.lastAccessedAt !== undefined) { sets.push('last_accessed_at = ?'); params.push(updates.lastAccessedAt); }
    if (updates.namespace !== undefined) { sets.push('namespace = ?'); params.push(updates.namespace); }
    if (updates.embedding !== undefined) { sets.push('embedding = ?'); params.push(JSON.stringify(updates.embedding)); }

    params.push(id);
    this.db.prepare(`UPDATE ${this.table} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    let sql = `SELECT COUNT(*) as c FROM ${this.table} WHERE 1=1`;
    const params: any[] = [];

    if (filter?.namespace) { sql += ` AND namespace = ?`; params.push(filter.namespace); }
    if (filter?.layer) { sql += ` AND layer = ?`; params.push(filter.layer); }

    const row = this.db.prepare(sql).get(...params);
    return row?.c || 0;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // SQLite has no native vector support — load all entries with embeddings and compute cosine similarity in JS
    let sql = `SELECT * FROM ${this.table} WHERE embedding IS NOT NULL`;
    const params: any[] = [];

    if (options.namespace) { sql += ` AND namespace = ?`; params.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = ?`; params.push(options.layer); }
    if (options.tags?.length) {
      for (const tag of options.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }
    sql += ` AND (expires_at IS NULL OR expires_at > ?)`;
    params.push(new Date().toISOString());

    const rows = this.db.prepare(sql).all(...params);

    // Compute cosine similarity for each row
    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];

    for (const row of rows) {
      let storedEmbedding: number[];
      try {
        storedEmbedding = JSON.parse(row.embedding);
      } catch {
        continue;
      }

      const similarity = cosineSimilarity(embedding, storedEmbedding);
      if (similarity >= (options.minScore || 0)) {
        results.push({ entry: this.rowToEntry(row), similarity });
      }
    }

    // Sort by similarity descending and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Try FTS5 first
    try {
      let sql = `
        SELECT m.*, fts.rank as score
        FROM ${this.table}_fts fts
        JOIN ${this.table} m ON m.id = fts.id
        WHERE ${this.table}_fts MATCH ?
      `;
      const params: any[] = [query];

      if (options.namespace) { sql += ` AND m.namespace = ?`; params.push(options.namespace); }
      if (options.layer) { sql += ` AND m.layer = ?`; params.push(options.layer); }
      if (options.tags?.length) {
        for (const tag of options.tags) {
          sql += ` AND m.tags LIKE ?`;
          params.push(`%"${tag}"%`);
        }
      }
      sql += ` AND (m.expires_at IS NULL OR m.expires_at > ?)`;
      params.push(new Date().toISOString());
      sql += ` ORDER BY fts.rank LIMIT ?`;
      params.push(options.limit);

      const rows = this.db.prepare(sql).all(...params);
      if (rows.length > 0) {
        return rows.map((r: any) => ({
          entry: this.rowToEntry(r),
          score: Math.abs(r.score || 0.5), // FTS5 rank is negative (lower = better)
        }));
      }
    } catch {
      // FTS5 not available or query failed
    }

    // Fallback to LIKE search
    let sql = `SELECT * FROM ${this.table} WHERE content LIKE ?`;
    const params: any[] = [`%${query}%`];

    if (options.namespace) { sql += ` AND namespace = ?`; params.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = ?`; params.push(options.layer); }
    sql += ` AND (expires_at IS NULL OR expires_at > ?)`;
    params.push(new Date().toISOString());
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(options.limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: 0.4 }));
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: string; order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM ${this.table} WHERE (expires_at IS NULL OR expires_at > ?)`;
    const params: any[] = [new Date().toISOString()];

    if (options.namespace) { sql += ` AND namespace = ?`; params.push(options.namespace); }
    if (options.layer) { sql += ` AND layer = ?`; params.push(options.layer); }
    if (options.tags?.length) {
      for (const tag of options.tags) {
        sql += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
      }
    }

    const orderCol = options.orderBy === 'updatedAt' ? 'updated_at'
      : options.orderBy === 'lastAccessedAt' ? 'last_accessed_at'
      : options.orderBy === 'relevance' ? 'relevance'
      : 'created_at';
    sql += ` ORDER BY ${orderCol} ${options.order || 'DESC'}`;
    sql += ` LIMIT ?`;
    params.push(options.limit || 50);
    if (options.offset) { sql += ` OFFSET ?`; params.push(options.offset); }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r: any) => this.rowToEntry(r));
  }

  async expireEntries(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `DELETE FROM ${this.table} WHERE expires_at IS NOT NULL AND expires_at <= ?`
    ).run(now);
    return result.changes || 0;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      layer: row.layer as MemoryLayer,
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

/**
 * Compute cosine similarity between two vectors.
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
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

/**
 * Safe JSON parse with fallback.
 */
function safeParse<T>(value: string | unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) || fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
