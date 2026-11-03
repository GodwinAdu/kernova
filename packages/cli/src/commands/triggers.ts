/**
 * kernova triggers
 *
 * Manage proactive trigger rules.
 *
 * Commands:
 *   kernova triggers list [--data-dir <path>]
 *   kernova triggers enable <id|name> [--data-dir <path>]
 *   kernova triggers disable <id|name> [--data-dir <path>]
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { info, warn, defaultDataDir } from '../ui.js';

/** Shape of a trigger_rules row in the database */
interface TriggerRuleRow {
  id: string;
  name: string;
  event_pattern: string;
  enabled: number;
  cooldown_ms: number;
  last_fired_at: string | null;
}

/**
 * Parse --data-dir option from args.
 * Returns the resolved dataDir and remaining args.
 */
function parseArgs(args: string[]): { dataDir: string; rest: string[] } {
  const rest: string[] = [];
  let dataDir = defaultDataDir();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) {
      dataDir = resolve(args[i + 1]);
      i++; // skip the value
    } else if (args[i].startsWith('--data-dir=')) {
      dataDir = resolve(args[i].split('=')[1]);
    } else {
      rest.push(args[i]);
    }
  }

  return { dataDir, rest };
}

/**
 * Format a cooldown value in milliseconds to a human-friendly string.
 */
function formatCooldown(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * Format a timestamp for display. Returns "never" if null/undefined.
 */
function formatLastFired(timestamp: string | null): string {
  if (!timestamp) return 'never';
  return timestamp;
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

export async function handleTriggers(args: string[]): Promise<void> {
  const { dataDir, rest } = parseArgs(args);
  const subcommand = rest[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printTriggersHelp();
    return;
  }

  switch (subcommand) {
    case 'list':
      await handleTriggersList(dataDir);
      break;
    case 'enable':
      await handleTriggersSetEnabled(dataDir, rest[1], true);
      break;
    case 'disable':
      await handleTriggersSetEnabled(dataDir, rest[1], false);
      break;
    default:
      warn(`Unknown triggers subcommand: ${subcommand}`);
      printTriggersHelp();
      process.exit(1);
  }
}

async function handleTriggersList(dataDir: string): Promise<void> {
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
    // Check if the trigger_rules table exists
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='trigger_rules'`
    ).get() as { name: string } | undefined;

    if (!tableCheck) {
      info('No trigger rules table found. No triggers have been registered yet.');
      return;
    }

    const rules = db.prepare(
      `SELECT id, name, event_pattern, enabled, cooldown_ms, last_fired_at FROM trigger_rules`
    ).all() as TriggerRuleRow[];

    if (rules.length === 0) {
      info('No trigger rules registered.');
      return;
    }

    // Column widths
    const colId = 14;
    const colName = 20;
    const colPattern = 24;
    const colEnabled = 8;
    const colCooldown = 10;
    const colLastFired = 24;

    // Header
    const header = [
      pad('ID', colId),
      pad('Name', colName),
      pad('Pattern', colPattern),
      pad('Enabled', colEnabled),
      pad('Cooldown', colCooldown),
      pad('Last Fired', colLastFired),
    ].join('  ');

    const separator = '─'.repeat(header.length);

    console.log('');
    console.log(`  Trigger Rules (${rules.length})`);
    console.log(`  ${separator}`);
    console.log(`  ${header}`);
    console.log(`  ${separator}`);

    for (const rule of rules) {
      const row = [
        pad(rule.id, colId),
        pad(rule.name, colName),
        pad(rule.event_pattern, colPattern),
        pad(rule.enabled ? 'yes' : 'no', colEnabled),
        pad(formatCooldown(rule.cooldown_ms), colCooldown),
        pad(formatLastFired(rule.last_fired_at), colLastFired),
      ].join('  ');

      console.log(`  ${row}`);
    }

    console.log(`  ${separator}`);
    console.log('');
  } finally {
    db.close();
  }
}

async function handleTriggersSetEnabled(dataDir: string, id: string | undefined, enabled: boolean): Promise<void> {
  const action = enabled ? 'enable' : 'disable';

  if (!id) {
    warn(`Missing rule ID. Usage: kernova triggers ${action} <id>`);
    process.exit(1);
  }

  const dbPath = join(dataDir, 'kernova.db');

  if (!existsSync(dbPath)) {
    warn(`No database found at "${dbPath}".`);
    info('Make sure a kernova runtime has been started with this data directory.');
    process.exit(1);
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch {
    warn(`Could not open database at "${dbPath}".`);
    process.exit(1);
  }

  try {
    // Check if the trigger_rules table exists
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='trigger_rules'`
    ).get() as { name: string } | undefined;

    if (!tableCheck) {
      warn(`Trigger rule "${id}" not found.`);
      process.exit(1);
    }

    // Accept the full ID, the rule name, or an unambiguous ID prefix (list output shortens IDs)
    const matches = db.prepare(
      `SELECT id, name FROM trigger_rules WHERE id = ? OR name = ? OR id LIKE ? || '%'`
    ).all(id, id, id) as Array<{ id: string; name: string }>;
    const rule = matches.find(r => r.id === id || r.name === id) ?? (matches.length === 1 ? matches[0] : undefined);

    if (!rule) {
      warn(matches.length > 1
        ? `"${id}" matches ${matches.length} trigger rules. Use more of the ID.`
        : `Trigger rule "${id}" not found.`);
      process.exit(1);
    }

    // Update the enabled state
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE trigger_rules SET enabled = ?, updated_at = ? WHERE id = ?`
    ).run(enabled ? 1 : 0, now, rule.id);

    const state = enabled ? 'enabled' : 'disabled';
    info(`Trigger rule "${rule.name}" (${rule.id}) ${state}.`);
  } finally {
    db.close();
  }
}

function printTriggersHelp(): void {
  console.log(`
  Usage: kernova triggers <command> [options]

  Commands:
    list              List all registered trigger rules
    enable <id|name>  Enable a trigger rule (ID, ID prefix, or name)
    disable <id|name> Disable a trigger rule (ID, ID prefix, or name)

  Options:
    --data-dir <path> Path to the kernova data directory (default: $KERNOVA_DATA_DIR or ./kernova-data)
    -h, --help        Show this help message

  Examples:
    kernova triggers list
    kernova triggers list --data-dir ./my-data
    kernova triggers enable my-rule-id
    kernova triggers disable my-rule-id
  `);
}
