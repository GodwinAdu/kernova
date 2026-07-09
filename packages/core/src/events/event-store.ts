/**
 * Nexus Event Store (SQLite)
 * 
 * Persistent storage for events using SQLite.
 * 
 * Design decisions:
 * - WAL mode for concurrent read/write performance
 * - JSON columns for flexible event payloads
 * - Indexes on subject, type, correlation, and timestamp
 * - Auto-migration: creates schema on first run
 * - Batch inserts for high-throughput scenarios
 * 
 * File location:
 *   Development: ./kernova-data/kernova.db
 *   Configurable via EventStoreConfig.path
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NexusEvent, NexusId, EventCategory, EventSeverity } from '@kernova/types';

export interface EventStoreConfig {
  /** Path to the SQLite database file */
  path?: string;

  /** Enable WAL mode (recommended for performance) */
  walMode?: boolean;

  /** Batch size for async writes */
  batchSize?: number;

  /** Flush interval in ms */
  flushIntervalMs?: number;
}

export interface EventQuery {
  /** Filter by event type (supports wildcards: "intent.*") */
  type?: string;

  /** Filter by category */
  category?: EventCategory;

  /** Filter by severity */
  severity?: EventSeverity;

  /** Filter by subject ID */
  subjectId?: NexusId;

  /** Filter by actor ID */
  actorId?: NexusId;

  /** Filter by correlation ID */
  correlationId?: NexusId;

  /** Events after this timestamp */
  after?: string;

  /** Events before this timestamp */
  before?: string;

  /** Maximum results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Sort order */
  order?: 'asc' | 'desc';
}

export class EventStore {
  private db: Database.Database;
  private buffer: NexusEvent[] = [];
  private batchSize: number;
  private flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private insertStmt: Database.Statement;
  private closed = false;

  constructor(config: EventStoreConfig = {}) {
    const dbPath = config.path || './kernova-data/kernova.db';

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database
    this.db = new Database(dbPath);

    // Configure for performance
    if (config.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');

    this.batchSize = config.batchSize || 100;
    this.flushIntervalMs = config.flushIntervalMs || 1000;

    // Create schema
    this.migrate();

    // Prepare insert statement
    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, event_type, category, severity, timestamp,
        subject_id, subject_type, actor_id,
        correlation_id, causation_id, data, metadata
      ) VALUES (
        @id, @event_type, @category, @severity, @timestamp,
        @subject_id, @subject_type, @actor_id,
        @correlation_id, @causation_id, @data, @metadata
      )
    `);

    // Start flush timer
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  /**
   * Append an event to the store (buffered for performance)
   */
  append(event: NexusEvent): void {
    if (this.closed) return;

    this.buffer.push(event);

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush buffered events to disk
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    const events = this.buffer;
    this.buffer = [];

    const insertMany = this.db.transaction((evts: NexusEvent[]) => {
      for (const event of evts) {
        this.insertStmt.run({
          id: event.id,
          event_type: event.eventType,
          category: event.category,
          severity: event.severity,
          timestamp: event.timestamp,
          subject_id: event.subjectId,
          subject_type: event.subjectType,
          actor_id: event.actorId,
          correlation_id: event.correlationId,
          causation_id: event.causationId || null,
          data: JSON.stringify(event.data),
          metadata: JSON.stringify(event.metadata),
        });
      }
    });

    insertMany(events);
  }

  /**
   * Query events with filters
   */
  query(params: EventQuery = {}): NexusEvent[] {
    // Flush pending events first so query sees latest data
    this.flush();

    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (params.type) {
      if (params.type.includes('*')) {
        // Wildcard: "intent.*" → LIKE "intent.%"
        conditions.push('event_type LIKE @type_pattern');
        bindings.type_pattern = params.type.replace(/\*/g, '%');
      } else {
        conditions.push('event_type = @type');
        bindings.type = params.type;
      }
    }

    if (params.category) {
      conditions.push('category = @category');
      bindings.category = params.category;
    }

    if (params.severity) {
      conditions.push('severity = @severity');
      bindings.severity = params.severity;
    }

    if (params.subjectId) {
      conditions.push('subject_id = @subject_id');
      bindings.subject_id = params.subjectId;
    }

    if (params.actorId) {
      conditions.push('actor_id = @actor_id');
      bindings.actor_id = params.actorId;
    }

    if (params.correlationId) {
      conditions.push('correlation_id = @correlation_id');
      bindings.correlation_id = params.correlationId;
    }

    if (params.after) {
      conditions.push('timestamp > @after');
      bindings.after = params.after;
    }

    if (params.before) {
      conditions.push('timestamp < @before');
      bindings.before = params.before;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const order = params.order === 'asc' ? 'ASC' : 'DESC';
    const limit = params.limit || 100;
    const offset = params.offset || 0;

    const sql = `
      SELECT * FROM events
      ${where}
      ORDER BY timestamp ${order}
      LIMIT @limit OFFSET @offset
    `;

    const rows = this.db.prepare(sql).all({ ...bindings, limit, offset }) as EventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * Get the timeline for a specific object (all events about it)
   */
  getTimeline(subjectId: NexusId, limit = 100): NexusEvent[] {
    return this.query({
      subjectId,
      limit,
      order: 'asc',
    });
  }

  /**
   * Get events by correlation ID (trace a full request flow)
   */
  getCorrelated(correlationId: NexusId, limit = 100): NexusEvent[] {
    return this.query({
      correlationId,
      limit,
      order: 'asc',
    });
  }

  /**
   * Count events matching a query
   */
  count(params: Omit<EventQuery, 'limit' | 'offset' | 'order'> = {}): number {
    this.flush();

    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (params.type) {
      if (params.type.includes('*')) {
        conditions.push('event_type LIKE @type_pattern');
        bindings.type_pattern = params.type.replace(/\*/g, '%');
      } else {
        conditions.push('event_type = @type');
        bindings.type = params.type;
      }
    }

    if (params.category) {
      conditions.push('category = @category');
      bindings.category = params.category;
    }

    if (params.subjectId) {
      conditions.push('subject_id = @subject_id');
      bindings.subject_id = params.subjectId;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const sql = `SELECT COUNT(*) as count FROM events ${where}`;
    const row = this.db.prepare(sql).get(bindings) as { count: number };
    return row.count;
  }

  /**
   * Get statistics about stored events
   */
  getStats(): EventStoreStats {
    this.flush();

    const total = this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
    const categories = this.db.prepare(
      'SELECT category, COUNT(*) as count FROM events GROUP BY category'
    ).all() as Array<{ category: string; count: number }>;
    const oldest = this.db.prepare(
      'SELECT timestamp FROM events ORDER BY timestamp ASC LIMIT 1'
    ).get() as { timestamp: string } | undefined;
    const newest = this.db.prepare(
      'SELECT timestamp FROM events ORDER BY timestamp DESC LIMIT 1'
    ).get() as { timestamp: string } | undefined;

    return {
      totalEvents: total.count,
      byCategory: Object.fromEntries(categories.map(c => [c.category, c.count])),
      oldestEvent: oldest?.timestamp,
      newestEvent: newest?.timestamp,
      databaseSizeBytes: this.getDatabaseSize(),
    };
  }

  /**
   * Apply retention policy — delete events older than the specified number of days.
   * Returns the number of events deleted.
   */
  applyRetention(retentionDays: number): number {
    this.flush();
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const result = this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff);
    return result.changes;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
    this.flush();

    // Close database
    this.db.close();
  }

  /**
   * Create the database schema
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        causation_id TEXT,
        data TEXT NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_subject
        ON events(subject_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type
        ON events(event_type, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_correlation
        ON events(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp
        ON events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_category
        ON events(category, timestamp);
    `);
  }

  /**
   * Get approximate database file size
   */
  private getDatabaseSize(): number {
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    return pageCount * pageSize;
  }
}

/** Database row shape */
interface EventRow {
  id: string;
  event_type: string;
  category: string;
  severity: string;
  timestamp: string;
  subject_id: string;
  subject_type: string;
  actor_id: string;
  correlation_id: string;
  causation_id: string | null;
  data: string;
  metadata: string;
}

/** Convert a database row to a NexusEvent */
function rowToEvent(row: EventRow): NexusEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    category: row.category as EventCategory,
    severity: row.severity as EventSeverity,
    timestamp: row.timestamp,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id || undefined,
    data: JSON.parse(row.data),
    metadata: JSON.parse(row.metadata),
  };
}

/** Event store statistics */
export interface EventStoreStats {
  totalEvents: number;
  byCategory: Record<string, number>;
  oldestEvent?: string;
  newestEvent?: string;
  databaseSizeBytes: number;
}
