/**
 * Kernova Scheduler Store (SQLite)
 *
 * Persistent storage for scheduled jobs using SQLite.
 * Follows the EventStore pattern: WAL mode, auto-migration, prepared statements.
 *
 * File location: {dataDir}/kernova.db (shared database file)
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScheduledJob, NexusId, Timestamp } from '@kernova/types';

export interface SchedulerStoreConfig {
  dataDir: string;
}

/** Database row shape for the scheduled_jobs table */
interface ScheduledJobRow {
  id: string;
  name: string;
  cron_expression: string;
  delay_ms: number | null;
  one_shot: number | null;
  target_type: string;
  target_id: string | null;
  target_goal: string;
  target_metadata: string | null;
  enabled: number;
  last_execution_at: string | null;
  next_execution_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to a ScheduledJob */
function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    delayMs: row.delay_ms ?? undefined,
    oneShot: row.one_shot === 1 ? true : undefined,
    target: {
      type: row.target_type as 'intent' | 'agent',
      id: row.target_id || undefined,
      goal: row.target_goal,
      metadata: row.target_metadata ? JSON.parse(row.target_metadata) : undefined,
    },
    enabled: row.enabled === 1,
    lastExecutionAt: row.last_execution_at || undefined,
    nextExecutionAt: row.next_execution_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SchedulerStore {
  private db: Database.Database;
  private saveStmt: Database.Statement;
  private loadAllStmt: Database.Statement;
  private removeStmt: Database.Statement;
  private updateExecutionStmt: Database.Statement;

  constructor(config: SchedulerStoreConfig) {
    const dbPath = join(config.dataDir, 'kernova.db');

    // Ensure directory exists
    if (!existsSync(config.dataDir)) {
      mkdirSync(config.dataDir, { recursive: true });
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
    this.saveStmt = this.db.prepare(`
      INSERT OR REPLACE INTO scheduled_jobs (
        id, name, cron_expression, delay_ms, one_shot, target_type, target_id,
        target_goal, target_metadata, enabled,
        last_execution_at, next_execution_at, created_at, updated_at
      ) VALUES (
        @id, @name, @cron_expression, @delay_ms, @one_shot, @target_type, @target_id,
        @target_goal, @target_metadata, @enabled,
        @last_execution_at, @next_execution_at, @created_at, @updated_at
      )
    `);

    this.loadAllStmt = this.db.prepare('SELECT * FROM scheduled_jobs');

    this.removeStmt = this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?');

    this.updateExecutionStmt = this.db.prepare(`
      UPDATE scheduled_jobs
      SET last_execution_at = @last_execution_at,
          next_execution_at = @next_execution_at,
          updated_at = @updated_at
      WHERE id = @id
    `);
  }

  /**
   * Save (insert or update) a scheduled job
   */
  save(job: ScheduledJob): void {
    this.saveStmt.run({
      id: job.id,
      name: job.name,
      cron_expression: job.cronExpression,
      delay_ms: job.delayMs ?? null,
      one_shot: job.oneShot ? 1 : null,
      target_type: job.target.type,
      target_id: job.target.id || null,
      target_goal: job.target.goal,
      target_metadata: job.target.metadata ? JSON.stringify(job.target.metadata) : null,
      enabled: job.enabled ? 1 : 0,
      last_execution_at: job.lastExecutionAt || null,
      next_execution_at: job.nextExecutionAt || null,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    });
  }

  /**
   * Load all persisted scheduled jobs
   */
  loadAll(): ScheduledJob[] {
    const rows = this.loadAllStmt.all() as ScheduledJobRow[];
    return rows.map(rowToJob);
  }

  /**
   * Remove a scheduled job by ID
   * @returns true if a row was deleted, false otherwise
   */
  remove(jobId: NexusId): boolean {
    const result = this.removeStmt.run(jobId);
    return result.changes > 0;
  }

  /**
   * Update execution timestamps for a job
   */
  updateExecution(jobId: NexusId, lastExecutionAt: Timestamp, nextExecutionAt: Timestamp): void {
    this.updateExecutionStmt.run({
      id: jobId,
      last_execution_at: lastExecutionAt,
      next_execution_at: nextExecutionAt,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Create the database schema
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        cron_expression TEXT NOT NULL DEFAULT '',
        delay_ms INTEGER,
        one_shot INTEGER,
        target_type TEXT NOT NULL,
        target_id TEXT,
        target_goal TEXT NOT NULL,
        target_metadata TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_execution_at TEXT,
        next_execution_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_name ON scheduled_jobs(name);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next ON scheduled_jobs(next_execution_at);
    `);

    // Add new columns if migrating from older schema
    try {
      this.db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN delay_ms INTEGER`);
    } catch { /* column already exists */ }
    try {
      this.db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN one_shot INTEGER`);
    } catch { /* column already exists */ }
  }
}
