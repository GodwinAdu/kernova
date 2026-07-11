/**
 * Integration tests for CLI commands: schedule, queue, triggers
 *
 * Tests verify output format, error handling, and data manipulation
 * using temp SQLite databases.
 *
 * Task 12.7: Write integration tests for each CLI command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ─── Test Helpers ────────────────────────────────────────────

function createTempDir(): string {
  const dir = join(tmpdir(), `kernova-cli-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Sentinel error thrown when process.exit is called in tests */
class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitError';
  }
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(a => String(a)).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(a => String(a)).join(' '));
  };

  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
    output() {
      return logs.join('\n');
    },
    errorOutput() {
      return errors.join('\n');
    },
  };
}

/**
 * Create a test database with the task_items and dead_letter_items tables.
 */
function createQueueDb(dataDir: string): Database.Database {
  const dbPath = join(dataDir, 'kernova.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
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
  `);

  return db;
}

/**
 * Create a test database with the trigger_rules table.
 */
function createTriggersDb(dataDir: string): Database.Database {
  const dbPath = join(dataDir, 'kernova.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS trigger_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event_pattern TEXT NOT NULL,
      condition_description TEXT,
      action_goal TEXT NOT NULL,
      action_intent_type TEXT,
      action_priority TEXT,
      action_metadata TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      cooldown_ms INTEGER NOT NULL DEFAULT 1000,
      last_fired_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return db;
}

// ─── Queue Command Tests ─────────────────────────────────────

describe('CLI: kernova queue', () => {
  let dataDir: string;
  let db: Database.Database;
  let capture: ReturnType<typeof captureConsole>;

  const originalExit = process.exit;

  beforeEach(() => {
    dataDir = createTempDir();
    db = createQueueDb(dataDir);
    capture = captureConsole();
    process.exit = ((code: number) => { throw new ExitError(code ?? 0); }) as never;
  });

  afterEach(() => {
    capture.restore();
    db.close();
    cleanupDir(dataDir);
    process.exit = originalExit;
  });

  describe('queue status', () => {
    it('should display task counts by status', async () => {
      const ts = new Date().toISOString();
      // Insert tasks with various statuses
      const insertTask = db.prepare(`
        INSERT INTO task_items (id, priority, status, payload, handler, attempt, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 3, ?, ?)
      `);
      insertTask.run('task_1', 2, 'pending', '{}', 'handler-a', ts, ts);
      insertTask.run('task_2', 2, 'pending', '{}', 'handler-a', ts, ts);
      insertTask.run('task_3', 1, 'running', '{}', 'handler-b', ts, ts);
      insertTask.run('task_4', 2, 'completed', '{}', 'handler-a', ts, ts);
      insertTask.run('task_5', 2, 'completed', '{}', 'handler-a', ts, ts);
      insertTask.run('task_6', 2, 'completed', '{}', 'handler-a', ts, ts);
      insertTask.run('task_7', 3, 'failed', '{}', 'handler-c', ts, ts);

      // Insert a dead-letter item
      db.prepare(`
        INSERT INTO dead_letter_items (id, task_id, payload, handler, error_message, error_type, attempts, dead_lettered_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dl_1', 'task_old', '{}', 'handler-x', 'timeout', 'TimeoutError', '[]', ts, 'active');

      const { handleQueue } = await import('../commands/queue.js');
      await handleQueue(['status', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('Task Queue Status');
      expect(output).toContain('Pending:');
      expect(output).toContain('2');
      expect(output).toContain('Active:');
      expect(output).toContain('1');
      expect(output).toContain('Completed:');
      expect(output).toContain('3');
      expect(output).toContain('Failed:');
      expect(output).toContain('Dead-lettered:');
    });

    it('should show zeroes when queue is empty', async () => {
      const { handleQueue } = await import('../commands/queue.js');
      await handleQueue(['status', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('Task Queue Status');
      expect(output).toContain('Pending:       0');
      expect(output).toContain('Active:        0');
      expect(output).toContain('Completed:     0');
      expect(output).toContain('Failed:        0');
      expect(output).toContain('Dead-lettered: 0');
    });

    it('should error when database does not exist', async () => {
      const missingDir = join(tmpdir(), `kernova-missing-${randomUUID()}`);
      mkdirSync(missingDir, { recursive: true });
      // Don't create a DB file

      const { handleQueue } = await import('../commands/queue.js');
      await expect(handleQueue(['status', '--data-dir', missingDir])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('Database not found');

      cleanupDir(missingDir);
    });
  });

  describe('queue replay', () => {
    it('should replay a dead-letter item and create a new pending task', async () => {
      const ts = new Date().toISOString();

      db.prepare(`
        INSERT INTO dead_letter_items (id, task_id, payload, handler, error_message, error_type, attempts, dead_lettered_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dl_abc123', 'task_original', '{"key":"value"}', 'email-handler', 'Connection refused', 'NetworkError', '[]', ts, 'active');

      const { handleQueue } = await import('../commands/queue.js');
      await handleQueue(['replay', 'dl_abc123', '--data-dir', dataDir]);

      // Check the dead-letter item is marked replayed
      const dlItem = db.prepare('SELECT * FROM dead_letter_items WHERE id = ?').get('dl_abc123') as { status: string };
      expect(dlItem.status).toBe('replayed');

      // Check a new task was created
      const tasks = db.prepare("SELECT * FROM task_items WHERE status = 'pending'").all() as Array<{ handler: string; payload: string }>;
      expect(tasks.length).toBe(1);
      expect(tasks[0].handler).toBe('email-handler');
      expect(tasks[0].payload).toBe('{"key":"value"}');
    });

    it('should error when dead-letter item is not found', async () => {
      const { handleQueue } = await import('../commands/queue.js');
      await expect(handleQueue(['replay', 'dl_nonexistent', '--data-dir', dataDir])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('Dead-letter item not found');
    });

    it('should error when dead-letter item is already replayed', async () => {
      const ts = new Date().toISOString();

      db.prepare(`
        INSERT INTO dead_letter_items (id, task_id, payload, handler, error_message, error_type, attempts, dead_lettered_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dl_replayed', 'task_old', '{}', 'handler', 'err', 'Error', '[]', ts, 'replayed');

      const { handleQueue } = await import('../commands/queue.js');
      await expect(handleQueue(['replay', 'dl_replayed', '--data-dir', dataDir])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('already replayed');
    });

    it('should error when no ID is provided', async () => {
      const { handleQueue } = await import('../commands/queue.js');
      // With no ID, the replay function should call process.exit(1)
      await expect(handleQueue(['replay', '--data-dir', dataDir])).rejects.toThrow(ExitError);
    });
  });

  describe('queue help', () => {
    it('should display help when no subcommand is given', async () => {
      const { handleQueue } = await import('../commands/queue.js');
      await handleQueue([]);

      const output = capture.output();
      expect(output).toContain('Usage: kernova queue');
      expect(output).toContain('status');
      expect(output).toContain('replay');
    });
  });
});

// ─── Triggers Command Tests ──────────────────────────────────

describe('CLI: kernova triggers', () => {
  let dataDir: string;
  let db: Database.Database;
  let capture: ReturnType<typeof captureConsole>;
  const originalExit = process.exit;

  beforeEach(() => {
    dataDir = createTempDir();
    db = createTriggersDb(dataDir);
    capture = captureConsole();
    process.exit = ((code: number) => { throw new ExitError(code ?? 0); }) as never;
  });

  afterEach(() => {
    capture.restore();
    db.close();
    cleanupDir(dataDir);
    process.exit = originalExit;
  });

  describe('triggers list', () => {
    it('should display trigger rules in table format', async () => {
      const ts = new Date().toISOString();
      const insertRule = db.prepare(`
        INSERT INTO trigger_rules (id, name, event_pattern, enabled, cooldown_ms, last_fired_at, action_goal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertRule.run('trig_001', 'on-new-email', 'channel.message.*', 1, 5000, null, 'Process email', ts, ts);
      insertRule.run('trig_002', 'daily-report', 'scheduler.fired', 1, 60000, ts, 'Generate report', ts, ts);
      insertRule.run('trig_003', 'disabled-rule', 'task.failed', 0, 1000, null, 'Notify admin', ts, ts);

      const { handleTriggers } = await import('../commands/triggers.js');
      await handleTriggers(['list', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('Trigger Rules');
      expect(output).toContain('on-new-email');
      expect(output).toContain('daily-report');
      expect(output).toContain('disabled-rule');
      expect(output).toContain('channel.message.*');
      expect(output).toContain('scheduler.fired');
      expect(output).toContain('task.failed');
    });

    it('should show "no trigger rules" message when table is empty', async () => {
      const { handleTriggers } = await import('../commands/triggers.js');
      await handleTriggers(['list', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('No trigger rules registered');
    });

    it('should show warning when database does not exist', async () => {
      const missingDir = join(tmpdir(), `kernova-notriggers-${randomUUID()}`);
      mkdirSync(missingDir, { recursive: true });

      const { handleTriggers } = await import('../commands/triggers.js');
      await handleTriggers(['list', '--data-dir', missingDir]);

      const output = capture.output();
      expect(output).toContain('No database found');

      cleanupDir(missingDir);
    });

    it('should display enabled/disabled status correctly', async () => {
      const ts = new Date().toISOString();
      db.prepare(`
        INSERT INTO trigger_rules (id, name, event_pattern, enabled, cooldown_ms, last_fired_at, action_goal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('trig_en', 'enabled-trigger', 'task.*', 1, 5000, null, 'Do thing', ts, ts);

      db.prepare(`
        INSERT INTO trigger_rules (id, name, event_pattern, enabled, cooldown_ms, last_fired_at, action_goal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('trig_dis', 'disabled-trigger', 'error.*', 0, 2000, null, 'Alert', ts, ts);

      const { handleTriggers } = await import('../commands/triggers.js');
      await handleTriggers(['list', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('yes');
      expect(output).toContain('no');
    });
  });

  describe('triggers help', () => {
    it('should show help when no subcommand is given', async () => {
      const { handleTriggers } = await import('../commands/triggers.js');
      await handleTriggers([]);

      const output = capture.output();
      expect(output).toContain('Usage: kernova triggers');
      expect(output).toContain('list');
    });

    it('should show help for --help flag', async () => {
      const { handleTriggers } = await import('../commands/triggers.js');
      await handleTriggers(['--help']);

      const output = capture.output();
      expect(output).toContain('Usage: kernova triggers');
    });
  });

  describe('triggers error handling', () => {
    it('should warn on unknown subcommand', async () => {
      const { handleTriggers } = await import('../commands/triggers.js');
      await expect(handleTriggers(['unknown-cmd', '--data-dir', dataDir])).rejects.toThrow(ExitError);

      const output = capture.output();
      expect(output).toContain('Unknown triggers subcommand');
    });
  });
});

// ─── Schedule Command Tests ──────────────────────────────────

/**
 * Create a test database with the scheduled_jobs table.
 */
function createScheduleDb(dataDir: string): Database.Database {
  const dbPath = join(dataDir, 'kernova.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expression TEXT,
      delay_ms INTEGER,
      one_shot INTEGER,
      target_type TEXT,
      target_goal TEXT,
      target_metadata TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_execution_at TEXT,
      next_execution_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return db;
}

describe('CLI: kernova schedule', () => {
  let dataDir: string;
  let db: Database.Database;
  let capture: ReturnType<typeof captureConsole>;
  const originalExit = process.exit;

  beforeEach(() => {
    dataDir = createTempDir();
    db = createScheduleDb(dataDir);
    capture = captureConsole();
    process.exit = ((code: number) => { throw new ExitError(code ?? 0); }) as never;
  });

  afterEach(() => {
    capture.restore();
    db.close();
    cleanupDir(dataDir);
    process.exit = originalExit;
  });

  describe('schedule list', () => {
    it('should display "No scheduled jobs" when table is empty', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await handleSchedule(['list', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('No scheduled jobs registered');
    });

    it('should display jobs with names, schedules, and IDs', async () => {
      const ts = new Date().toISOString();
      const insertJob = db.prepare(`
        INSERT INTO scheduled_jobs (id, name, cron_expression, delay_ms, enabled, next_execution_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertJob.run('job_001', 'hourly-check', '0 * * * *', null, 1, '2025-07-11T15:00:00Z', ts, ts);
      insertJob.run('job_002', 'daily-report', '0 9 * * *', null, 1, '2025-07-12T09:00:00Z', ts, ts);
      insertJob.run('job_003', 'one-shot-task', null, 5000, 0, null, ts, ts);

      const { handleSchedule } = await import('../commands/schedule.js');
      await handleSchedule(['list', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('Scheduled Jobs');
      expect(output).toContain('hourly-check');
      expect(output).toContain('0 * * * *');
      expect(output).toContain('job_001');
      expect(output).toContain('daily-report');
      expect(output).toContain('job_002');
      expect(output).toContain('one-shot-task');
      expect(output).toContain('5000ms');
    });
  });

  describe('schedule enable/disable', () => {
    it('should error when no ID is provided for enable', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await expect(handleSchedule(['enable', '--data-dir', dataDir])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('Job ID is required');
    });

    it('should error when no ID is provided for disable', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await expect(handleSchedule(['disable', '--data-dir', dataDir])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('Job ID is required');
    });

    it('should error when job is not found', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await expect(handleSchedule(['enable', 'nonexistent_job', '--data-dir', dataDir])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('Job not found');
    });

    it('should toggle job and display success message for enable', async () => {
      const ts = new Date().toISOString();
      db.prepare(`
        INSERT INTO scheduled_jobs (id, name, cron_expression, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('job_test', 'test-job', '*/5 * * * *', 0, ts, ts);

      const { handleSchedule } = await import('../commands/schedule.js');
      await handleSchedule(['enable', 'job_test', '--data-dir', dataDir]);

      const output = capture.output();
      expect(output).toContain('enabled');
      expect(output).toContain('test-job');

      // Verify the DB was updated
      const row = db.prepare('SELECT enabled FROM scheduled_jobs WHERE id = ?').get('job_test') as { enabled: number };
      expect(row.enabled).toBe(1);
    });
  });

  describe('schedule help', () => {
    it('should show help when no subcommand is given', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await handleSchedule([]);

      const output = capture.output();
      expect(output).toContain('Usage: kernova schedule');
      expect(output).toContain('list');
      expect(output).toContain('enable');
      expect(output).toContain('disable');
    });

    it('should show help for --help flag', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await handleSchedule(['--help']);

      const output = capture.output();
      expect(output).toContain('Usage: kernova schedule');
    });
  });

  describe('schedule error handling', () => {
    it('should error on unknown subcommand', async () => {
      const { handleSchedule } = await import('../commands/schedule.js');
      await expect(handleSchedule(['unknown'])).rejects.toThrow(ExitError);

      const errOutput = capture.errorOutput();
      expect(errOutput).toContain('Unknown schedule subcommand');
    });
  });
});

// ─── Serve Command Tests ─────────────────────────────────────

describe('CLI: kernova serve', () => {
  let capture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    capture = captureConsole();
  });

  afterEach(() => {
    capture.restore();
    vi.restoreAllMocks();
  });

  describe('serve help', () => {
    it('should display help with --help flag', async () => {
      const { handleServe } = await import('../commands/serve.js');
      await handleServe(['--help']);

      const output = capture.output();
      expect(output).toContain('Usage: kernova serve');
      expect(output).toContain('--config');
      expect(output).toContain('--watch');
      expect(output).toContain('--port');
      expect(output).toContain('--data-dir');
    });

    it('should display help with -h flag', async () => {
      const { handleServe } = await import('../commands/serve.js');
      await handleServe(['-h']);

      const output = capture.output();
      expect(output).toContain('Usage: kernova serve');
    });
  });
});
