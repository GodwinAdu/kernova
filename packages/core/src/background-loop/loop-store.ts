/**
 * Kernova Background Loop Store (SQLite)
 *
 * Persistent storage for background loop definitions using SQLite.
 *
 * Design decisions:
 * - WAL mode for concurrent read/write performance
 * - Auto-migration: creates schema on first run
 * - Prepared statements for all operations
 * - Follows the EventStore pattern for consistency
 */

import Database from 'better-sqlite3';
import type { BackgroundLoopDef, LoopState, KernovaId } from '@kernova/types';
import { now } from '../utils.js';
import { resolveStorePath } from '../storage/store-path.js';

export interface LoopStoreConfig {
  dataDir: string;
}

/** Database row shape for background_loops table */
interface LoopRow {
  id: string;
  name: string;
  interval_ms: number;
  state: string;
  created_at: string;
  updated_at: string;
}

export class LoopStore {
  private db: Database.Database;
  private saveStmt: Database.Statement;
  private loadAllStmt: Database.Statement;
  private removeStmt: Database.Statement;
  private updateStateStmt: Database.Statement;

  constructor(config: LoopStoreConfig) {
    // Open database (in memory when dataDir is ':memory:')
    this.db = new Database(resolveStorePath(config.dataDir));

    // Configure for performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');

    // Create schema
    this.migrate();

    // Prepare statements
    this.saveStmt = this.db.prepare(`
      INSERT INTO background_loops (id, name, interval_ms, state, created_at, updated_at)
      VALUES (@id, @name, @interval_ms, @state, @created_at, @updated_at)
    `);

    this.loadAllStmt = this.db.prepare(`
      SELECT id, name, interval_ms, state, created_at, updated_at
      FROM background_loops
    `);

    this.removeStmt = this.db.prepare(`
      DELETE FROM background_loops WHERE id = ?
    `);

    this.updateStateStmt = this.db.prepare(`
      UPDATE background_loops SET state = @state, updated_at = @updated_at WHERE id = @id
    `);
  }

  /**
   * Persist a background loop definition to SQLite
   */
  save(loop: BackgroundLoopDef): void {
    this.saveStmt.run({
      id: loop.id,
      name: loop.name,
      interval_ms: loop.intervalMs,
      state: loop.state,
      created_at: loop.createdAt,
      updated_at: loop.updatedAt,
    });
  }

  /**
   * Load all persisted background loop definitions
   */
  loadAll(): BackgroundLoopDef[] {
    const rows = this.loadAllStmt.all() as LoopRow[];
    return rows.map(rowToLoop);
  }

  /**
   * Remove a background loop by ID.
   * Returns true if a row was deleted, false if not found.
   */
  remove(loopId: KernovaId): boolean {
    const result = this.removeStmt.run(loopId);
    return result.changes > 0;
  }

  /**
   * Update the state of a background loop
   */
  updateState(loopId: KernovaId, state: LoopState): void {
    this.updateStateStmt.run({
      id: loopId,
      state,
      updated_at: now(),
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
      CREATE TABLE IF NOT EXISTS background_loops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        interval_ms INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
}

/** Convert a database row to a BackgroundLoopDef */
function rowToLoop(row: LoopRow): BackgroundLoopDef {
  return {
    id: row.id,
    name: row.name,
    intervalMs: row.interval_ms,
    state: row.state as LoopState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
