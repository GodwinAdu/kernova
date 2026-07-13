/**
 * CheckpointStore — Persists execution state to SQLite.
 * Enables recovery after crashes.
 */

import type { Checkpoint, DurableTaskState } from './types.js';

export class CheckpointStore {
  private db: any;

  constructor(db: any) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS durable_tasks (
        task_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        result TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step INTEGER NOT NULL,
        state TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (task_id) REFERENCES durable_tasks(task_id)
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);
    `);
  }

  saveTask(task: DurableTaskState): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO durable_tasks (task_id, name, current_step, total_steps, status, result, error, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.taskId,
      task.name,
      task.currentStep,
      task.totalSteps,
      task.status,
      task.result ? JSON.stringify(task.result) : null,
      task.error || null,
      task.startedAt,
      task.updatedAt,
    );
  }

  saveCheckpoint(checkpoint: Checkpoint): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints (id, task_id, step, state, status, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      checkpoint.id,
      checkpoint.taskId,
      checkpoint.step,
      JSON.stringify(checkpoint.state),
      checkpoint.status,
      checkpoint.createdAt,
      checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null,
    );
  }

  getTask(taskId: string): DurableTaskState | null {
    if (!this.db) return null;

    const row = this.db.prepare('SELECT * FROM durable_tasks WHERE task_id = ?').get(taskId);
    if (!row) return null;

    return {
      taskId: row.task_id,
      name: row.name,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      checkpoints: this.getCheckpoints(taskId),
    };
  }

  getCheckpoints(taskId: string): Checkpoint[] {
    if (!this.db) return [];

    const rows = this.db.prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY step').all(taskId);
    return rows.map((row: any) => ({
      id: row.id,
      taskId: row.task_id,
      step: row.step,
      state: JSON.parse(row.state),
      status: row.status,
      createdAt: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  getLatestCheckpoint(taskId: string): Checkpoint | null {
    if (!this.db) return null;

    const row = this.db.prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY step DESC LIMIT 1').get(taskId);
    if (!row) return null;

    return {
      id: row.id,
      taskId: row.task_id,
      step: row.step,
      state: JSON.parse(row.state),
      status: row.status,
      createdAt: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  getIncompleteTasks(): DurableTaskState[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      "SELECT * FROM durable_tasks WHERE status IN ('running', 'paused', 'awaiting_approval')"
    ).all();

    return rows.map((row: any) => ({
      taskId: row.task_id,
      name: row.name,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      checkpoints: this.getCheckpoints(row.task_id),
    }));
  }

  deleteTask(taskId: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM checkpoints WHERE task_id = ?').run(taskId);
    this.db.prepare('DELETE FROM durable_tasks WHERE task_id = ?').run(taskId);
  }
}
