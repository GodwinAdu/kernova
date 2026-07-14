/**
 * SQLite Memory Provider — Default, zero-config provider.
 * Uses better-sqlite3 with FTS5 for full-text search.
 */

import type { MemoryProvider, MemoryEntry, MemorySearchOptions, MemorySearchResult } from './types.js';

export interface SqliteProviderConfig {
  path: string;
}

export class SqliteMemoryProvider implements MemoryProvider {
  name = 'sqlite';
  private db: any = null;
  private config: SqliteProviderConfig;

  constructor(config: SqliteProviderConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database(this.config.path);
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        layer TEXT NOT NULL DEFAULT 'longterm',
        tags TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        relevance REAL DEFAULT 1.0,
        confidence REAL DEFAULT 0.8,
        embedding BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    `);

    // Create FTS5 table for full-text search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          tags,
          content=memories,
          content_rowid=rowid
        );
      `);
    } catch {
      // FTS table might already exist
    }

    // Create triggers to keep FTS in sync
    try {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
          INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
        END;
      `);
    } catch {
      // Triggers might already exist
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, content, layer, tags, metadata, relevance, confidence, embedding, created_at, updated_at)
      VALUES (@id, @content, @layer, @tags, @metadata, @relevance, @confidence, @embedding, @created_at, @updated_at)
    `);

    stmt.run({
      id: entry.id,
      content: entry.content,
      layer: entry.layer,
      tags: JSON.stringify(entry.tags),
      metadata: JSON.stringify(entry.metadata),
      relevance: entry.relevance,
      confidence: entry.confidence,
      embedding: entry.embedding ? Buffer.from(new Float32Array(entry.embedding).buffer) : null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    });
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    if (options.query) {
      return this.ftsSearch(options);
    }
    return this.filterSearch(options);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return row ? this.rowToEntry(row) : null;
  }

  async getAll(options?: { layer?: string; limit?: number; tags?: string[] }): Promise<MemoryEntry[]> {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: any = {};

    if (options?.layer) {
      sql += ' AND layer = @layer';
      params.layer = options.layer;
    }
    if (options?.tags?.length) {
      for (let i = 0; i < options.tags.length; i++) {
        sql += ` AND tags LIKE @tag${i}`;
        params[`tag${i}`] = `%${options.tags[i]}%`;
      }
    }
    sql += ' ORDER BY created_at DESC';
    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    const rows = this.db.prepare(sql).all(params);
    return rows.map((r: any) => this.rowToEntry(r));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const sets: string[] = ['updated_at = @updated_at'];
    const params: any = { id, updated_at: new Date().toISOString() };

    if (updates.content !== undefined) { sets.push('content = @content'); params.content = updates.content; }
    if (updates.tags !== undefined) { sets.push('tags = @tags'); params.tags = JSON.stringify(updates.tags); }
    if (updates.metadata !== undefined) { sets.push('metadata = @metadata'); params.metadata = JSON.stringify(updates.metadata); }
    if (updates.relevance !== undefined) { sets.push('relevance = @relevance'); params.relevance = updates.relevance; }
    if (updates.confidence !== undefined) { sets.push('confidence = @confidence'); params.confidence = updates.confidence; }

    this.db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  async count(layer?: string): Promise<number> {
    if (layer) {
      return this.db.prepare('SELECT COUNT(*) as c FROM memories WHERE layer = ?').get(layer).c;
    }
    return this.db.prepare('SELECT COUNT(*) as c FROM memories').get().c;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private ftsSearch(options: MemorySearchOptions): MemorySearchResult[] {
    const query = options.query!
      .replace(/['"(){}[\]*^~\\]/g, '')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 1)
      .map(w => `"${w}"`)
      .join(' OR ');

    if (!query) return this.filterSearch(options);

    let sql = `
      SELECT m.*, bm25(memories_fts) as score
      FROM memories m
      JOIN memories_fts ON memories_fts.rowid = m.rowid
      WHERE memories_fts MATCH @query
    `;
    const params: any = { query };

    if (options.layer) {
      sql += ' AND m.layer = @layer';
      params.layer = options.layer;
    }
    sql += ` ORDER BY score DESC LIMIT ${options.limit || 10}`;

    try {
      const rows = this.db.prepare(sql).all(params);
      return rows.map((r: any) => ({
        entry: this.rowToEntry(r),
        score: Math.abs(r.score || 0.5),
      }));
    } catch {
      // FTS failed — fallback to LIKE
      return this.likeSearch(options);
    }
  }

  private filterSearch(options: MemorySearchOptions): MemorySearchResult[] {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: any = {};

    if (options.layer) {
      sql += ' AND layer = @layer';
      params.layer = options.layer;
    }
    if (options.tags?.length) {
      for (let i = 0; i < options.tags.length; i++) {
        sql += ` AND tags LIKE @tag${i}`;
        params[`tag${i}`] = `%${options.tags[i]}%`;
      }
    }
    sql += ` ORDER BY relevance * confidence DESC LIMIT ${options.limit || 10}`;

    const rows = this.db.prepare(sql).all(params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: r.relevance * r.confidence }));
  }

  private likeSearch(options: MemorySearchOptions): MemorySearchResult[] {
    let sql = 'SELECT * FROM memories WHERE (content LIKE @q OR tags LIKE @q)';
    const params: any = { q: `%${options.query}%` };

    if (options.layer) {
      sql += ' AND layer = @layer';
      params.layer = options.layer;
    }
    sql += ` ORDER BY relevance * confidence DESC LIMIT ${options.limit || 10}`;

    const rows = this.db.prepare(sql).all(params);
    return rows.map((r: any) => ({ entry: this.rowToEntry(r), score: r.relevance * r.confidence }));
  }

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      layer: row.layer,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      relevance: row.relevance,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
