/**
 * Kernova Trigger Store (SQLite)
 *
 * Persistent storage for trigger rules using SQLite.
 *
 * Design decisions:
 * - WAL mode for concurrent read/write performance
 * - JSON column for action metadata
 * - Indexes on event_pattern and unique combo for enabled rules
 * - Auto-migration: creates schema on first run
 * - Prepared statements for efficient repeated operations
 *
 * File location:
 *   {dataDir}/kernova.db (shared with other stores)
 */

import Database from 'better-sqlite3';
import type { TriggerRule, TriggerActionDef, KernovaId, Timestamp, Priority } from '@kernova/types';
import type { IntentType } from '@kernova/types';
import { now } from '../utils.js';
import { resolveStorePath } from '../storage/store-path.js';

export interface TriggerStoreConfig {
  dataDir: string;
}

/** Database row shape for trigger_rules table */
interface TriggerRuleRow {
  id: string;
  name: string;
  event_pattern: string;
  condition_description: string | null;
  action_goal: string;
  action_intent_type: string | null;
  action_priority: string | null;
  action_metadata: string | null;
  enabled: number;
  cooldown_ms: number;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export class TriggerStore {
  private db: Database.Database;
  private saveStmt: Database.Statement;
  private loadAllStmt: Database.Statement;
  private removeStmt: Database.Statement;
  private updateEnabledStmt: Database.Statement;
  private updateLastFiredStmt: Database.Statement;

  constructor(config: TriggerStoreConfig) {
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
      INSERT OR REPLACE INTO trigger_rules (
        id, name, event_pattern, condition_description,
        action_goal, action_intent_type, action_priority, action_metadata,
        enabled, cooldown_ms, last_fired_at, created_at, updated_at
      ) VALUES (
        @id, @name, @event_pattern, @condition_description,
        @action_goal, @action_intent_type, @action_priority, @action_metadata,
        @enabled, @cooldown_ms, @last_fired_at, @created_at, @updated_at
      )
    `);

    this.loadAllStmt = this.db.prepare(`
      SELECT * FROM trigger_rules
    `);

    this.removeStmt = this.db.prepare(`
      DELETE FROM trigger_rules WHERE id = ?
    `);

    this.updateEnabledStmt = this.db.prepare(`
      UPDATE trigger_rules SET enabled = ?, updated_at = ? WHERE id = ?
    `);

    this.updateLastFiredStmt = this.db.prepare(`
      UPDATE trigger_rules SET last_fired_at = ?, updated_at = ? WHERE id = ?
    `);
  }

  /**
   * Save (insert or replace) a trigger rule
   */
  save(rule: TriggerRule): void {
    this.saveStmt.run({
      id: rule.id,
      name: rule.name,
      event_pattern: rule.eventPattern,
      condition_description: rule.condition ?? null,
      action_goal: rule.action.goal,
      action_intent_type: rule.action.intentType ?? null,
      action_priority: rule.action.priority ?? null,
      action_metadata: rule.action.metadata ? JSON.stringify(rule.action.metadata) : null,
      enabled: rule.enabled ? 1 : 0,
      cooldown_ms: rule.cooldownMs,
      last_fired_at: rule.lastFiredAt ?? null,
      created_at: rule.createdAt,
      updated_at: rule.updatedAt,
    });
  }

  /**
   * Load all trigger rules from the database
   */
  loadAll(): TriggerRule[] {
    const rows = this.loadAllStmt.all() as TriggerRuleRow[];
    return rows.map(rowToTriggerRule);
  }

  /**
   * Remove a trigger rule by ID. Returns true if a row was deleted.
   */
  remove(ruleId: KernovaId): boolean {
    const result = this.removeStmt.run(ruleId);
    return result.changes > 0;
  }

  /**
   * Update the enabled state of a trigger rule
   */
  updateEnabled(ruleId: KernovaId, enabled: boolean): void {
    this.updateEnabledStmt.run(enabled ? 1 : 0, now(), ruleId);
  }

  /**
   * Update the last fired timestamp of a trigger rule
   */
  updateLastFired(ruleId: KernovaId, lastFiredAt: Timestamp): void {
    this.updateLastFiredStmt.run(lastFiredAt, now(), ruleId);
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

      CREATE INDEX IF NOT EXISTS idx_trigger_rules_pattern
        ON trigger_rules(event_pattern);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_rules_unique_combo
        ON trigger_rules(event_pattern, condition_description) WHERE enabled = 1;
    `);
  }
}

/** Convert a database row to a TriggerRule */
function rowToTriggerRule(row: TriggerRuleRow): TriggerRule {
  const action: TriggerActionDef = {
    goal: row.action_goal,
  };

  if (row.action_intent_type) {
    action.intentType = row.action_intent_type as IntentType;
  }

  if (row.action_priority) {
    action.priority = row.action_priority as Priority;
  }

  if (row.action_metadata) {
    action.metadata = JSON.parse(row.action_metadata);
  }

  return {
    id: row.id,
    name: row.name,
    eventPattern: row.event_pattern,
    condition: row.condition_description ?? undefined,
    action,
    enabled: row.enabled === 1,
    cooldownMs: row.cooldown_ms,
    lastFiredAt: row.last_fired_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
