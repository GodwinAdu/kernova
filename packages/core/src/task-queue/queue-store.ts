/**
 * Kernova Task Queue Store (SQLite)
 *
 * Persistent storage for task queue items and dead-letter records.
 *
 * Design decisions:
 * - WAL mode for concurrent read/write performance
 * - JSON columns for flexible task payloads
 * - Partial index on pending items for fast dequeue
 * - Priority stored as integer for efficient ordering
 * - Auto-migration: creates schema on first run
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  TaskItem,
  QueueTaskStatus,
  QueueStats,
  DeadLetterItem,
  DeadLetterAttempt,
  DeadLetterFilter,
  NexusId,
  Timestamp,
  Priority,
} from '@kernova/types';
import { generateId, now } from '../utils.js';

// ─── Priority Helpers ────────────────────────────────────────

const PRIORITY_MAP: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const NUMBER_TO_PRIORITY: Record<number, Priority> = {
  0: 'critical',
  1: 'high',
  2: 'medium',
  3: 'low',
};

/**
 * Convert a priority string to its numeric representation for SQLite ordering.
 */
export function priorityToNumber(priority: Priority): number {
  const num = PRIORITY_MAP[priority];
  if (num === undefined) {
    throw new Error(`Invalid priority: ${priority}`);
  }
  return num;
}

/**
 * Convert a numeric priority back to its string representation.
 */
export function numberToPriority(num: number): Priority {
  const priority = NUMBER_TO_PRIORITY[num];
  if (priority === undefined) {
    throw new Error(`Invalid priority number: ${num}`);
  }
  return priority;
}

// ─── Config ──────────────────────────────────────────────────

export interface QueueStoreConfig {
  dataDir: string;
}

// ─── Database Row Types ──────────────────────────────────────

interface TaskItemRow {
  id: string;
  priority: number;
  status: string;
  payload: string;
  handler: string;
  attempt: number;
  max_retries: number;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DeadLetterRow {
  id: string;
  task_id: string;
  payload: string;
  handler: string;
  error_message: string;
  error_type: string;
  attempts: string;
  dead_lettered_at: string;
  status: string;
}

interface CountRow {
  count: number;
}

// ─── QueueStore Class ────────────────────────────────────────

export class QueueStore {
  private db: Database.Database;

  // Prepared statements
  private insertTaskStmt: Database.Statement;
  private dequeueStmt: Database.Statement;
  private updateStatusStmt: Database.Statement;
  private insertDeadLetterStmt: Database.Statement;
  private markReplayedStmt: Database.Statement;
  private getDeadLetterByIdStmt: Database.Statement;

  constructor(config: QueueStoreConfig) {
    const dbPath = join(config.dataDir, 'kernova.db');

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database
    this.db = new Database(dbPath);

    // Configure for performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');

    // Create schema
    this.migrate();

    // Prepare statements
    this.insertTaskStmt = this.db.prepare(`
      INSERT INTO task_items (id, priority, status, payload, handler, attempt, max_retries, scheduled_at, created_at, updated_at)
      VALUES (@id, @priority, @status, @payload, @handler, @attempt, @max_retries, @scheduled_at, @created_at, @updated_at)
    `);

    this.dequeueStmt = this.db.prepare(`
      SELECT * FROM task_items
      WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= @now)
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `);

    this.updateStatusStmt = this.db.prepare(`
      UPDATE task_items
      SET status = @status, attempt = @attempt, scheduled_at = @scheduled_at, updated_at = @updated_at
      WHERE id = @id
    `);

    this.insertDeadLetterStmt = this.db.prepare(`
      INSERT INTO dead_letter_items (id, task_id, payload, handler, error_message, error_type, attempts, dead_lettered_at, status)
      VALUES (@id, @task_id, @payload, @handler, @error_message, @error_type, @attempts, @dead_lettered_at, @status)
    `);

    this.markReplayedStmt = this.db.prepare(`
      UPDATE dead_letter_items SET status = 'replayed' WHERE id = @id
    `);

    this.getDeadLetterByIdStmt = this.db.prepare(`
      SELECT * FROM dead_letter_items WHERE id = @id
    `);
  }

  /**
   * Enqueue a task item into the store.
   */
  enqueue(item: TaskItem): void {
    this.insertTaskStmt.run({
      id: item.id,
      priority: priorityToNumber(item.priority),
      status: item.status,
      payload: JSON.stringify(item.payload),
      handler: item.handler,
      attempt: item.attempt,
      max_retries: item.maxRetries,
      scheduled_at: item.scheduledAt || null,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    });
  }

  /**
   * Dequeue the next pending task item (priority ASC, created_at ASC).
   * Returns null if no pending items are available.
   */
  dequeue(): TaskItem | null {
    const row = this.dequeueStmt.get({ now: now() }) as TaskItemRow | undefined;
    if (!row) return null;
    return this.rowToTaskItem(row);
  }

  /**
   * Update the status of a task item.
   */
  updateStatus(
    taskId: NexusId,
    status: QueueTaskStatus,
    attempt?: number,
    scheduledAt?: Timestamp,
  ): void {
    // Get current task to preserve attempt if not provided
    const current = this.db.prepare('SELECT attempt FROM task_items WHERE id = @id').get({ id: taskId }) as
      | { attempt: number }
      | undefined;

    this.updateStatusStmt.run({
      id: taskId,
      status,
      attempt: attempt ?? current?.attempt ?? 0,
      scheduled_at: scheduledAt || null,
      updated_at: now(),
    });
  }

  /**
   * Get queue statistics reflecting current persisted state.
   */
  getStats(): QueueStats {
    const pending = (
      this.db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'pending'").get() as CountRow
    ).count;
    const active = (
      this.db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'running'").get() as CountRow
    ).count;
    const completed = (
      this.db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'completed'").get() as CountRow
    ).count;
    const failed = (
      this.db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'failed'").get() as CountRow
    ).count;
    const deadLettered = (
      this.db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'dead-lettered'").get() as CountRow
    ).count;

    return { pending, active, completed, failed, deadLettered };
  }

  /**
   * Query dead-lettered items with optional filters.
   * Returns at most 100 items ordered by dead_lettered_at descending.
   */
  getDeadLetters(filter?: DeadLetterFilter): DeadLetterItem[] {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (filter?.after) {
      conditions.push('dead_lettered_at > @after');
      bindings.after = filter.after;
    }

    if (filter?.before) {
      conditions.push('dead_lettered_at < @before');
      bindings.before = filter.before;
    }

    if (filter?.errorType) {
      conditions.push('error_type = @error_type');
      bindings.error_type = filter.errorType;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT * FROM dead_letter_items
      ${where}
      ORDER BY dead_lettered_at DESC
      LIMIT 100
    `;

    const rows = this.db.prepare(sql).all(bindings) as DeadLetterRow[];
    return rows.map(row => this.rowToDeadLetterItem(row));
  }

  /**
   * Add a dead-letter item to the store.
   */
  addToDeadLetter(item: DeadLetterItem): void {
    this.insertDeadLetterStmt.run({
      id: item.id,
      task_id: item.taskId,
      payload: JSON.stringify(item.payload),
      handler: item.handler,
      error_message: item.errorMessage,
      error_type: item.errorType,
      attempts: JSON.stringify(item.attempts),
      dead_lettered_at: item.deadLetteredAt,
      status: item.status,
    });
  }

  /**
   * Mark a dead-letter item as replayed.
   */
  markReplayed(deadLetterId: NexusId): void {
    this.markReplayedStmt.run({ id: deadLetterId });
  }

  /**
   * Get a single dead-letter item by ID.
   */
  getDeadLetterById(id: NexusId): DeadLetterItem | null {
    const row = this.getDeadLetterByIdStmt.get({ id }) as DeadLetterRow | undefined;
    if (!row) return null;
    return this.rowToDeadLetterItem(row);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_items (
        id TEXT PRIMARY KEY,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        handler TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        scheduled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_items_dequeue
        ON task_items(status, priority, created_at)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_task_items_status ON task_items(status);

      CREATE TABLE IF NOT EXISTS dead_letter_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        handler TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_type TEXT NOT NULL,
        attempts TEXT NOT NULL,
        dead_lettered_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_dead_letter_date
        ON dead_letter_items(dead_lettered_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dead_letter_error_type
        ON dead_letter_items(error_type);
    `);
  }

  private rowToTaskItem(row: TaskItemRow): TaskItem {
    return {
      id: row.id,
      priority: numberToPriority(row.priority),
      status: row.status as QueueTaskStatus,
      payload: JSON.parse(row.payload),
      handler: row.handler,
      attempt: row.attempt,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      scheduledAt: row.scheduled_at || undefined,
    };
  }

  private rowToDeadLetterItem(row: DeadLetterRow): DeadLetterItem {
    return {
      id: row.id,
      taskId: row.task_id,
      payload: JSON.parse(row.payload),
      handler: row.handler,
      errorMessage: row.error_message,
      errorType: row.error_type,
      attempts: JSON.parse(row.attempts) as DeadLetterAttempt[],
      deadLetteredAt: row.dead_lettered_at,
      status: row.status as 'active' | 'replayed',
    };
  }
}
