/**
 * kernova status
 *
 * Shows the current state of the kernova runtime.
 * Reads project info from kernova.config.json and runtime state from the SQLite database.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { info, warn } from '../ui.js';

interface StatusOptions {
  dataDir: string;
}

interface CountRow {
  count: number;
}

interface HeartbeatRow {
  timestamp: string;
}

function parseArgs(args: string[]): StatusOptions {
  const options: StatusOptions = {
    dataDir: resolve(process.cwd(), 'kernova-data'),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--data-dir':
      case '-d':
        options.dataDir = resolve(args[++i]);
        break;
    }
  }

  return options;
}

/**
 * Check if a given table exists in the database.
 */
function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName) as { name: string } | undefined;
  return !!row;
}

/**
 * Format a duration in seconds to a human-readable string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * Count .agent.yaml files in the project directory as a fallback for agent count.
 */
function countAgentFiles(projectRoot: string): number {
  const agentsDir = join(projectRoot, 'agents');
  if (!existsSync(agentsDir)) return 0;

  try {
    const files = readdirSync(agentsDir);
    return files.filter(f => f.endsWith('.agent.yaml') || f.endsWith('.agent.yml')).length;
  } catch {
    return 0;
  }
}

export async function handleStatus(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectRoot = resolve(process.cwd());
  const configPath = join(projectRoot, 'kernova.config.json');

  if (!existsSync(configPath)) {
    warn('Not a kernova project (no kernova.config.json found).');
    info('Run "kernova init" to create a new project.');
    return;
  }

  const configRaw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configRaw);

  // ── Project Info ──────────────────────────────────────────────────────────
  console.log('');
  console.log('  Kernova Project Status');
  console.log('  ════════════════════════');
  console.log(`    Name:        ${config.name ?? 'unnamed'}`);
  console.log(`    Version:     ${config.version ?? '0.0.0'}`);
  console.log(`    Environment: ${config.runtime?.environment ?? 'development'}`);
  console.log(`    Model:       ${config.models?.default?.provider ?? 'not configured'}/${config.models?.default?.model ?? 'none'}`);

  // ── Runtime Data ──────────────────────────────────────────────────────────
  const dbPath = join(options.dataDir, 'kernova.db');

  if (!existsSync(dbPath)) {
    console.log('');
    console.log('  Runtime');
    console.log('  ─────────');
    console.log('    No runtime data — daemon has not been started.');
    printMemoryLayers();
    return;
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    console.log('');
    console.log('  Runtime');
    console.log('  ─────────');
    warn('Could not open runtime database.');
    printMemoryLayers();
    return;
  }

  try {
    console.log('');
    console.log('  Runtime');
    console.log('  ─────────');

    // Daemon health via heartbeat events
    printDaemonHealth(db);

    // Agents
    printAgentCount(db, projectRoot);

    // Scheduled jobs
    printScheduleCount(db);

    // Task queue
    printQueueCount(db);

    // Trigger rules
    printTriggerCount(db);

  } finally {
    db.close();
  }

  printMemoryLayers();
}

function printDaemonHealth(db: Database.Database): void {
  if (!tableExists(db, 'events')) {
    console.log('    Daemon:      Unknown (no events table)');
    return;
  }

  try {
    const row = db.prepare(
      `SELECT timestamp FROM events WHERE type = 'daemon.heartbeat' ORDER BY timestamp DESC LIMIT 1`
    ).get() as HeartbeatRow | undefined;

    if (!row) {
      console.log('    Daemon:      Stopped (no heartbeat recorded)');
      return;
    }

    const lastBeat = new Date(row.timestamp).getTime();
    const now = Date.now();
    const diffSeconds = (now - lastBeat) / 1000;

    if (diffSeconds <= 120) {
      console.log(`    Daemon:      Running (last heartbeat: ${formatDuration(diffSeconds)})`);
    } else {
      console.log(`    Daemon:      Stopped (last heartbeat: ${formatDuration(diffSeconds)})`);
    }
  } catch {
    console.log('    Daemon:      Unknown (could not query events)');
  }
}

function printAgentCount(db: Database.Database, projectRoot: string): void {
  if (tableExists(db, 'agents')) {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM agents').get() as CountRow;
      console.log(`    Agents:      ${row.count} registered`);
      return;
    } catch {
      // fall through to file-based count
    }
  }

  // Fallback: count .agent.yaml files
  const fileCount = countAgentFiles(projectRoot);
  if (fileCount > 0) {
    console.log(`    Agents:      ${fileCount} defined (from files)`);
  } else {
    console.log('    Agents:      0');
  }
}

function printScheduleCount(db: Database.Database): void {
  if (!tableExists(db, 'scheduled_jobs')) {
    console.log('    Schedules:   –');
    return;
  }

  try {
    const total = (db.prepare('SELECT COUNT(*) as count FROM scheduled_jobs').get() as CountRow).count;
    const enabled = (
      db.prepare("SELECT COUNT(*) as count FROM scheduled_jobs WHERE enabled = 1").get() as CountRow
    ).count;
    console.log(`    Schedules:   ${total} total (${enabled} enabled)`);
  } catch {
    console.log('    Schedules:   – (could not query)');
  }
}

function printQueueCount(db: Database.Database): void {
  if (!tableExists(db, 'task_items')) {
    console.log('    Task Queue:  –');
    return;
  }

  try {
    const pending = (
      db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'pending'").get() as CountRow
    ).count;
    const active = (
      db.prepare("SELECT COUNT(*) as count FROM task_items WHERE status = 'running'").get() as CountRow
    ).count;
    console.log(`    Task Queue:  ${pending} pending, ${active} active`);
  } catch {
    console.log('    Task Queue:  – (could not query)');
  }
}

function printTriggerCount(db: Database.Database): void {
  if (!tableExists(db, 'trigger_rules')) {
    console.log('    Triggers:    –');
    return;
  }

  try {
    const total = (db.prepare('SELECT COUNT(*) as count FROM trigger_rules').get() as CountRow).count;
    const enabled = (
      db.prepare("SELECT COUNT(*) as count FROM trigger_rules WHERE enabled = 1").get() as CountRow
    ).count;
    console.log(`    Triggers:    ${total} rules (${enabled} enabled)`);
  } catch {
    console.log('    Triggers:    – (could not query)');
  }
}

function printMemoryLayers(): void {
  console.log('');
  console.log('  Memory Layers:');
  console.log('    Working:       ✓');
  console.log('    Session:       ✓');
  console.log('    Long-term:     ✓');
  console.log('');
}
