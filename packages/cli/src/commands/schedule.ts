/**
 * kernova schedule
 *
 * Manage scheduled jobs.
 *
 * Commands:
 *   kernova schedule list [--data-dir <path>]
 *   kernova schedule enable <id|name> [--data-dir <path>]
 *   kernova schedule disable <id|name> [--data-dir <path>]
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { info, warn, success, error, defaultDataDir } from '../ui.js';

/** Shape of a scheduled_jobs row in the database */
interface ScheduledJobRow {
  id: string;
  name: string;
  cron_expression: string | null;
  delay_ms: number | null;
  one_shot: number | null;
  target_type: string | null;
  target_goal: string | null;
  target_metadata: string | null;
  enabled: number;
  last_execution_at: string | null;
  next_execution_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Parse --data-dir option from args.
 * Returns the resolved dataDir, subcommand, and remaining positional args.
 */
function parseArgs(args: string[]): { dataDir: string; subcommand: string; rest: string[] } {
  const positional: string[] = [];
  let dataDir = defaultDataDir();

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--data-dir' || args[i] === '-d') && i + 1 < args.length) {
      dataDir = resolve(args[i + 1]);
      i++; // skip the value
    } else if (args[i].startsWith('--data-dir=')) {
      dataDir = resolve(args[i].split('=')[1]);
    } else {
      positional.push(args[i]);
    }
  }

  const subcommand = positional[0] || '';
  const rest = positional.slice(1);

  return { dataDir, subcommand, rest };
}

/**
 * Pad a string to a fixed width, truncating with ellipsis if too long.
 */
function pad(value: string, width: number): string {
  if (value.length > width) {
    return value.slice(0, width - 1) + '…';
  }
  return value.padEnd(width);
}

/**
 * Format the schedule column (cron expression or delay).
 */
function formatSchedule(job: ScheduledJobRow): string {
  if (job.cron_expression) return job.cron_expression;
  if (job.delay_ms != null) return `${job.delay_ms}ms`;
  return '-';
}

/**
 * Format a timestamp for display. Returns "-" if null/undefined.
 */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return '-';
  return timestamp;
}

export async function handleSchedule(args: string[]): Promise<void> {
  const { dataDir, subcommand, rest } = parseArgs(args);

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printScheduleHelp();
    return;
  }

  switch (subcommand) {
    case 'list':
      await handleScheduleList(dataDir);
      break;
    case 'enable':
      await handleToggle(rest[0], true, dataDir);
      break;
    case 'disable':
      await handleToggle(rest[0], false, dataDir);
      break;
    default:
      error(`Unknown schedule subcommand: ${subcommand}`);
      printScheduleHelp();
      process.exit(1);
  }
}

async function handleScheduleList(dataDir: string): Promise<void> {
  const dbPath = join(dataDir, 'kernova.db');

  if (!existsSync(dbPath)) {
    warn(`No database found at "${dbPath}".`);
    info('Make sure a kernova runtime has been started with this data directory.');
    return;
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    warn(`Could not open database at "${dbPath}".`);
    return;
  }

  try {
    // Check if the scheduled_jobs table exists
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'`
    ).get() as { name: string } | undefined;

    if (!tableCheck) {
      info('No scheduled jobs table found. No jobs have been registered yet.');
      return;
    }

    const jobs = db.prepare(
      `SELECT id, name, cron_expression, delay_ms, enabled, next_execution_at FROM scheduled_jobs`
    ).all() as ScheduledJobRow[];

    if (jobs.length === 0) {
      info('No scheduled jobs registered.');
      return;
    }

    // Column widths
    const colId = 16;
    const colName = 22;
    const colSchedule = 18;
    const colEnabled = 8;
    const colNextExec = 24;

    // Header
    const header = [
      pad('ID', colId),
      pad('Name', colName),
      pad('Cron/Delay', colSchedule),
      pad('Enabled', colEnabled),
      pad('Next Execution', colNextExec),
    ].join('  ');

    const separator = '─'.repeat(header.length);

    console.log('');
    console.log(`  Scheduled Jobs (${jobs.length})`);
    console.log(`  ${separator}`);
    console.log(`  ${header}`);
    console.log(`  ${separator}`);

    for (const job of jobs) {
      const row = [
        pad(job.id, colId),
        pad(job.name, colName),
        pad(formatSchedule(job), colSchedule),
        pad(job.enabled ? 'yes' : 'no', colEnabled),
        pad(formatTimestamp(job.next_execution_at), colNextExec),
      ].join('  ');

      console.log(`  ${row}`);
    }

    console.log(`  ${separator}`);
    console.log('');
  } finally {
    db.close();
  }
}

async function handleToggle(id: string | undefined, enabled: boolean, dataDir: string): Promise<void> {
  const action = enabled ? 'enable' : 'disable';

  if (!id) {
    error(`Job ID is required. Usage: kernova schedule ${action} <id>`);
    process.exit(1);
    return;
  }

  const dbPath = join(dataDir, 'kernova.db');

  if (!existsSync(dbPath)) {
    warn(`No database found at "${dbPath}".`);
    info('Make sure a kernova runtime has been started with this data directory.');
    process.exit(1);
    return;
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: false });
  } catch {
    error(`Could not open database at "${dbPath}".`);
    process.exit(1);
    return;
  }

  try {
    // Check if the scheduled_jobs table exists
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'`
    ).get() as { name: string } | undefined;

    if (!tableCheck) {
      error('No scheduled jobs table found. No jobs have been registered yet.');
      process.exit(1);
      return;
    }

    // Accept the full ID, the job name, or an unambiguous ID prefix (list output shortens IDs)
    const matches = db.prepare(
      `SELECT id, name FROM scheduled_jobs WHERE id = ? OR name = ? OR id LIKE ? || '%'`
    ).all(id, id, id) as Array<{ id: string; name: string }>;
    const job = matches.find(j => j.id === id || j.name === id) ?? (matches.length === 1 ? matches[0] : undefined);

    if (!job) {
      error(matches.length > 1 ? `"${id}" matches ${matches.length} jobs. Use more of the ID.` : `Job not found: ${id}`);
      process.exit(1);
      return;
    }

    // Toggle the enabled field
    db.prepare('UPDATE scheduled_jobs SET enabled = ?, updated_at = ? WHERE id = ?').run(
      enabled ? 1 : 0,
      new Date().toISOString(),
      job.id
    );

    success(`Job "${job.name}" (${job.id}) ${action}d.`);
  } finally {
    db.close();
  }
}

function printScheduleHelp(): void {
  console.log(`
  Usage: kernova schedule <command> [options]

  Commands:
    list              List all scheduled jobs
    enable <id|name>  Enable a scheduled job (ID, ID prefix, or name)
    disable <id|name> Disable a scheduled job (ID, ID prefix, or name)

  Options:
    --data-dir, -d <path>  Path to the kernova data directory (default: $KERNOVA_DATA_DIR or ./kernova-data)
    -h, --help             Show this help message

  Examples:
    kernova schedule list
    kernova schedule list --data-dir ./my-data
    kernova schedule enable job_abc123
    kernova schedule disable job_abc123 --data-dir /var/kernova/data
  `);
}
