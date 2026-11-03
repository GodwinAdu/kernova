/**
 * kernova queue
 * 
 * Manage the task queue.
 *   kernova queue status          — Show queue statistics
 *   kernova queue replay <id>     — Replay a dead-lettered task
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { info, error, success, defaultDataDir } from '../ui.js';

interface QueueOptions {
  dataDir: string;
}

function parseQueueArgs(args: string[]): { subcommand: string; rest: string[]; options: QueueOptions } {
  const options: QueueOptions = {
    dataDir: defaultDataDir(),
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--data-dir':
      case '-d':
        options.dataDir = resolve(args[++i]);
        break;
      default:
        positional.push(args[i]);
        break;
    }
  }

  const subcommand = positional[0] || '';
  const rest = positional.slice(1);

  return { subcommand, rest, options };
}

interface CountRow {
  count: number;
}

function openDatabase(dataDir: string): Database.Database {
  const dbPath = join(dataDir, 'kernova.db');

  if (!existsSync(dbPath)) {
    error(`Database not found at ${dbPath}`);
    error(`Make sure the daemon has been started at least once, or specify --data-dir.`);
    process.exit(1);
  }

  return new Database(dbPath, { readonly: false });
}

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = `${prefix}_`;
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function handleStatus(options: QueueOptions): Promise<void> {
  const db = openDatabase(options.dataDir);

  try {
    const pending = (
      db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'pending'").get() as CountRow
    ).count;
    const active = (
      db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'running'").get() as CountRow
    ).count;
    const completed = (
      db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'completed'").get() as CountRow
    ).count;
    const failed = (
      db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'failed'").get() as CountRow
    ).count;
    const deadLettered = (
      db.prepare("SELECT COUNT(*) as count FROM dead_letter_items WHERE status = 'active'").get() as CountRow
    ).count;

    console.log('');
    console.log('  Task Queue Status');
    console.log('  ═════════════════');
    console.log(`    Pending:       ${pending}`);
    console.log(`    Active:        ${active}`);
    console.log(`    Completed:     ${completed}`);
    console.log(`    Failed:        ${failed}`);
    console.log(`    Dead-lettered: ${deadLettered}`);
    console.log('');
  } finally {
    db.close();
  }
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

async function handleReplay(id: string, options: QueueOptions): Promise<void> {
  if (!id) {
    error('Usage: kernova queue replay <id>');
    process.exit(1);
  }

  const db = openDatabase(options.dataDir);

  try {
    const deadLetter = db.prepare('SELECT * FROM dead_letter_items WHERE id = ?').get(id) as DeadLetterRow | undefined;

    if (!deadLetter) {
      error(`Dead-letter item not found: ${id}`);
      process.exit(1);
    }

    if (deadLetter.status === 'replayed') {
      error(`Dead-letter item already replayed: ${id}`);
      process.exit(1);
    }

    // Create a new pending task from the dead-letter item
    const timestamp = new Date().toISOString();
    const newTaskId = generateId('task');

    db.prepare(`
      INSERT INTO task_items (id, priority, status, payload, handler, attempt, max_retries, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, 0, 3, ?, ?)
    `).run(newTaskId, 2, deadLetter.payload, deadLetter.handler, timestamp, timestamp);

    // Mark dead-letter item as replayed
    db.prepare("UPDATE dead_letter_items SET status = 'replayed' WHERE id = ?").run(id);

    success(`Replayed dead-letter ${id} → new task ${newTaskId} (status: pending)`);
  } finally {
    db.close();
  }
}

export async function handleQueue(args: string[]): Promise<void> {
  const { subcommand, rest, options } = parseQueueArgs(args);

  switch (subcommand) {
    case 'status':
      await handleStatus(options);
      break;
    case 'replay':
      await handleReplay(rest[0], options);
      break;
    default:
      console.log('');
      console.log('  Usage: kernova queue <subcommand> [options]');
      console.log('');
      console.log('  Subcommands:');
      console.log('    status            Show task queue statistics');
      console.log('    replay <id>       Replay a dead-lettered task back to the queue');
      console.log('');
      console.log('  Options:');
      console.log('    --data-dir, -d    Path to the data directory (default: $KERNOVA_DATA_DIR or ./kernova-data)');
      console.log('');
      console.log('  Examples:');
      console.log('    kernova queue status');
      console.log('    kernova queue status --data-dir /var/kernova/data');
      console.log('    kernova queue replay dl_abc123');
      console.log('');
      if (subcommand) {
        error(`Unknown subcommand: ${subcommand}`);
        process.exit(1);
      }
      break;
  }
}
