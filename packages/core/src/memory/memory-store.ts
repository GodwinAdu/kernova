/**
 * Kernova Memory Store (SQLite + FTS5)
 * 
 * Persistent storage for the five-layer memory system.
 * 
 * Features:
 * - SQLite persistence (survives restarts)
 * - FTS5 full-text search (built into SQLite)
 * - Layer-partitioned queries
 * - Relevance scoring (FTS rank + recency + frequency)
 * - Memory decay (relevance decreases over time)
 * - Relations between memories
 * 
 * Uses the same database file as EventStore (kernova.db).
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  MemoryEntry,
  MemoryQuery,
  MemoryLayer,
  MemoryType,
  MemoryRelation,
  KernovaId,
} from '@kernova/types';
import { now } from '../utils.js';

export interface MemoryStoreConfig {
  /** Path to SQLite database file */
  path?: string;
}

export class MemoryStore {
  private db: Database.Database;
  private closed = false;

  constructor(config: MemoryStoreConfig = {}) {
    const dbPath = config.path || './kernova-data/kernova.db';

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.migrate();
  }

  /**
   * Store a memory entry
   */
  store(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (
        id, layer, memory_type, content, data, relevance, confidence,
        tags, source, owner, status, access_count, last_accessed_at,
        created_at, updated_at
      ) VALUES (
        @id, @layer, @memory_type, @content, @data, @relevance, @confidence,
        @tags, @source, @owner, @status, @access_count, @last_accessed_at,
        @created_at, @updated_at
      )
    `);

    stmt.run({
      id: entry.id,
      layer: entry.layer,
      memory_type: entry.memoryType,
      content: entry.content,
      data: entry.data ? JSON.stringify(entry.data) : null,
      relevance: entry.relevance,
      confidence: entry.confidence,
      tags: JSON.stringify(entry.tags),
      source: JSON.stringify(entry.source),
      owner: entry.owner,
      status: entry.status,
      access_count: entry.accessCount,
      last_accessed_at: entry.lastAccessedAt,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    });

    // Update FTS index
    this.db.prepare(`
      INSERT OR REPLACE INTO memories_fts (rowid, content, tags)
      VALUES (
        (SELECT rowid FROM memories WHERE id = @id),
        @content,
        @tags_text
      )
    `).run({
      id: entry.id,
      content: entry.content,
      tags_text: entry.tags.join(' '),
    });

    // Store relations
    if (entry.relations.length > 0) {
      const relStmt = this.db.prepare(`
        INSERT OR REPLACE INTO memory_relations (source_id, target_id, relation_type, strength)
        VALUES (@source_id, @target_id, @relation_type, @strength)
      `);

      for (const rel of entry.relations) {
        relStmt.run({
          source_id: entry.id,
          target_id: rel.targetId,
          relation_type: rel.relationType,
          strength: rel.strength,
        });
      }
    }
  }

  /**
   * Query memories with filters and full-text search
   */
  query(params: MemoryQuery): MemoryEntry[] {
    // If there's a text query, use FTS5
    if (params.query) {
      return this.queryWithFTS(params);
    }

    // Otherwise, use regular SQL filtering
    return this.queryWithFilters(params);
  }

  /**
   * Get a single memory by ID
   */
  get(id: KernovaId): MemoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    if (!row) return undefined;

    // Update access tracking
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?
    `).run(now(), id);

    return this.rowToEntry(row);
  }

  /**
   * Delete a memory
   */
  delete(id: KernovaId): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM memory_relations WHERE source_id = ? OR target_id = ?').run(id, id);
    return result.changes > 0;
  }

  /**
   * Apply memory decay — reduce relevance of memories that haven't been accessed recently
   */
  decay(options: { factor?: number; minRelevance?: number; olderThanMs?: number } = {}): number {
    const factor = options.factor ?? 0.95;
    const minRelevance = options.minRelevance ?? 0.1;
    const olderThanMs = options.olderThanMs ?? 86400000; // 24 hours

    const cutoff = new Date(Date.now() - olderThanMs).toISOString();

    const result = this.db.prepare(`
      UPDATE memories
      SET relevance = MAX(relevance * @factor, @min_relevance),
          updated_at = @now
      WHERE last_accessed_at < @cutoff
        AND relevance > @min_relevance
        AND status = 'active'
    `).run({
      factor,
      min_relevance: minRelevance,
      cutoff,
      now: now(),
    });

    return result.changes;
  }

  /**
   * Get memory statistics by layer
   */
  getStats(): Record<MemoryLayer, number> {
    const rows = this.db.prepare(
      `SELECT layer, COUNT(*) as count FROM memories WHERE status = 'active' GROUP BY layer`
    ).all() as Array<{ layer: string; count: number }>;

    const stats: Record<string, number> = {
      working: 0,
      session: 0,
      longterm: 0,
      organizational: 0,
      global: 0,
    };

    for (const row of rows) {
      stats[row.layer] = row.count;
    }

    return stats as Record<MemoryLayer, number>;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /**
   * Full-text search query using FTS5
   */
  private queryWithFTS(params: MemoryQuery): MemoryEntry[] {
    const conditions: string[] = ["m.status = 'active'"];
    const bindings: Record<string, unknown> = {};

    if (params.layers?.length) {
      conditions.push(`m.layer IN (${params.layers.map((_, i) => `@layer${i}`).join(', ')})`);
      params.layers.forEach((l, i) => { bindings[`layer${i}`] = l; });
    }

    if (params.types?.length) {
      conditions.push(`m.memory_type IN (${params.types.map((_, i) => `@type${i}`).join(', ')})`);
      params.types.forEach((t, i) => { bindings[`type${i}`] = t; });
    }

    if (params.ownerId) {
      conditions.push('m.owner = @owner');
      bindings.owner = params.ownerId;
    }

    if (params.minRelevance !== undefined) {
      conditions.push('m.relevance >= @min_relevance');
      bindings.min_relevance = params.minRelevance;
    }

    if (params.minConfidence !== undefined) {
      conditions.push('m.confidence >= @min_confidence');
      bindings.min_confidence = params.minConfidence;
    }

    if (params.after) {
      conditions.push('m.created_at > @after');
      bindings.after = params.after;
    }

    if (params.before) {
      conditions.push('m.created_at < @before');
      bindings.before = params.before;
    }

    const where = conditions.join(' AND ');
    const limit = params.limit || 20;

    // Sanitize FTS query (escape special chars)
    const ftsQuery = this.sanitizeFtsQuery(params.query!);
    bindings.fts_query = ftsQuery;

    const sql = `
      SELECT m.*, bm25(memories_fts) as fts_rank
      FROM memories m
      JOIN memories_fts ON memories_fts.rowid = m.rowid
      WHERE memories_fts MATCH @fts_query
        AND ${where}
      ORDER BY (bm25(memories_fts) * -1) * m.relevance * m.confidence DESC
      LIMIT @limit
    `;

    try {
      const rows = this.db.prepare(sql).all({ ...bindings, limit }) as (MemoryRow & { fts_rank: number })[];
      return rows.map(r => this.rowToEntry(r));
    } catch {
      // FTS query failed (invalid syntax) — fall back to LIKE search
      return this.queryWithLike(params);
    }
  }

  /**
   * Fallback text search using LIKE (when FTS fails)
   */
  private queryWithLike(params: MemoryQuery): MemoryEntry[] {
    const conditions: string[] = ["status = 'active'"];
    const bindings: Record<string, unknown> = {};

    if (params.query) {
      conditions.push('(content LIKE @like_query OR tags LIKE @like_query)');
      bindings.like_query = `%${params.query}%`;
    }

    if (params.layers?.length) {
      conditions.push(`layer IN (${params.layers.map((_, i) => `@layer${i}`).join(', ')})`);
      params.layers.forEach((l, i) => { bindings[`layer${i}`] = l; });
    }

    if (params.ownerId) {
      conditions.push('owner = @owner');
      bindings.owner = params.ownerId;
    }

    const where = conditions.join(' AND ');
    const limit = params.limit || 20;

    const sql = `
      SELECT * FROM memories
      WHERE ${where}
      ORDER BY relevance * confidence DESC
      LIMIT @limit
    `;

    const rows = this.db.prepare(sql).all({ ...bindings, limit }) as MemoryRow[];
    return rows.map(r => this.rowToEntry(r));
  }

  /**
   * Filter-only query (no text search)
   */
  private queryWithFilters(params: MemoryQuery): MemoryEntry[] {
    const conditions: string[] = ["status = 'active'"];
    const bindings: Record<string, unknown> = {};

    if (params.layers?.length) {
      conditions.push(`layer IN (${params.layers.map((_, i) => `@layer${i}`).join(', ')})`);
      params.layers.forEach((l, i) => { bindings[`layer${i}`] = l; });
    }

    if (params.types?.length) {
      conditions.push(`memory_type IN (${params.types.map((_, i) => `@type${i}`).join(', ')})`);
      params.types.forEach((t, i) => { bindings[`type${i}`] = t; });
    }

    if (params.tags?.length) {
      // Check if any tag matches (JSON array contains)
      const tagConditions = params.tags.map((_, i) => `tags LIKE @tag${i}`);
      conditions.push(`(${tagConditions.join(' OR ')})`);
      params.tags.forEach((t, i) => { bindings[`tag${i}`] = `%"${t}"%`; });
    }

    if (params.ownerId) {
      conditions.push('owner = @owner');
      bindings.owner = params.ownerId;
    }

    if (params.minRelevance !== undefined) {
      conditions.push('relevance >= @min_relevance');
      bindings.min_relevance = params.minRelevance;
    }

    if (params.minConfidence !== undefined) {
      conditions.push('confidence >= @min_confidence');
      bindings.min_confidence = params.minConfidence;
    }

    if (params.after) {
      conditions.push('created_at > @after');
      bindings.after = params.after;
    }

    if (params.before) {
      conditions.push('created_at < @before');
      bindings.before = params.before;
    }

    const where = conditions.join(' AND ');
    const limit = params.limit || 20;

    const sql = `
      SELECT * FROM memories
      WHERE ${where}
      ORDER BY relevance * confidence DESC
      LIMIT @limit
    `;

    const rows = this.db.prepare(sql).all({ ...bindings, limit }) as MemoryRow[];
    return rows.map(r => this.rowToEntry(r));
  }

  /**
   * Sanitize FTS5 query to prevent syntax errors
   */
  private sanitizeFtsQuery(query: string): string {
    // Remove FTS5 special characters and wrap words in quotes for safety
    return query
      .replace(/['"(){}[\]*^~\\]/g, '') // Remove special chars
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => `"${w}"`)
      .join(' OR ');
  }

  /**
   * Convert database row to MemoryEntry
   */
  private rowToEntry(row: MemoryRow): MemoryEntry {
    // Load relations
    const relations = this.db.prepare(
      'SELECT * FROM memory_relations WHERE source_id = ?'
    ).all(row.id) as RelationRow[];

    return {
      id: row.id,
      type: 'memory_entry',
      version: '1.0.0',
      owner: row.owner,
      status: row.status as MemoryEntry['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: {},
      layer: row.layer as MemoryLayer,
      memoryType: row.memory_type as MemoryType,
      content: row.content,
      data: row.data ? JSON.parse(row.data) : undefined,
      relevance: row.relevance,
      confidence: row.confidence,
      tags: JSON.parse(row.tags),
      source: JSON.parse(row.source),
      lastAccessedAt: row.last_accessed_at || row.created_at,
      accessCount: row.access_count,
      relations: relations.map(r => ({
        targetId: r.target_id,
        relationType: r.relation_type as MemoryRelation['relationType'],
        strength: r.strength,
      })),
    };
  }

  /**
   * Create database schema
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        data TEXT,
        relevance REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 0.8,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT '{}',
        owner TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        embedding BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer, status);
      CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner, layer);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
      CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, tokenize='porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS memory_relations (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (source_id, target_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_id);
    `);

    // Add embedding column if upgrading from older schema
    try {
      this.db.exec('ALTER TABLE memories ADD COLUMN embedding BLOB');
    } catch {
      // Column already exists — ignore
    }
  }

  /**
   * Store a vector embedding for a memory
   */
  storeEmbedding(memoryId: KernovaId, vector: number[]): void {
    const buffer = serializeVector(vector);
    this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, memoryId);
  }

  /**
   * Get all memories with embeddings for vector search
   * Filters by layer/owner if specified.
   */
  getEmbeddings(filters: { layers?: MemoryLayer[]; ownerId?: KernovaId } = {}): Array<{ id: string; vector: number[] }> {
    const conditions: string[] = ["status = 'active'", 'embedding IS NOT NULL'];
    const bindings: Record<string, unknown> = {};

    if (filters.layers?.length) {
      conditions.push(`layer IN (${filters.layers.map((_, i) => `@layer${i}`).join(', ')})`);
      filters.layers.forEach((l, i) => { bindings[`layer${i}`] = l; });
    }

    if (filters.ownerId) {
      conditions.push('owner = @owner');
      bindings.owner = filters.ownerId;
    }

    const sql = `SELECT id, embedding FROM memories WHERE ${conditions.join(' AND ')}`;
    const rows = this.db.prepare(sql).all(bindings) as Array<{ id: string; embedding: Buffer }>;

    return rows.map(r => ({
      id: r.id,
      vector: deserializeVector(r.embedding),
    }));
  }
}

/** Database row shape */
interface MemoryRow {
  id: string;
  layer: string;
  memory_type: string;
  content: string;
  data: string | null;
  relevance: number;
  confidence: number;
  tags: string;
  source: string;
  owner: string;
  status: string;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  source_id: string;
  target_id: string;
  relation_type: string;
  strength: number;
}

/** Serialize a vector to Buffer (Float32) for SQLite BLOB storage */
function serializeVector(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer;
}

/** Deserialize a Buffer back to a float vector */
function deserializeVector(buffer: Buffer): number[] {
  const vector: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    vector.push(buffer.readFloatLE(i));
  }
  return vector;
}
