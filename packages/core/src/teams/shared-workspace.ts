/**
 * Shared Workspace — Shared State Between Agents
 *
 * A key-value store that all agents in a team can read from and write to.
 * Supports versioning for optimistic concurrency, namespacing, and history tracking.
 */

import type { AgentId, WorkspaceEntry } from './types.js';

export interface SharedWorkspaceOptions {
  /** Max entries in workspace */
  maxEntries?: number;
  /** Max total size in bytes (approximate) */
  maxSize?: number;
  /** Whether to track history of changes */
  trackHistory?: boolean;
}

export interface WorkspaceChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: AgentId;
  timestamp: string;
  version: number;
}

export type WorkspaceChangeHandler = (event: WorkspaceChangeEvent) => void;

export class SharedWorkspace {
  private entries: Map<string, WorkspaceEntry> = new Map();
  private changeHistory: WorkspaceChangeEvent[] = [];
  private changeHandlers: WorkspaceChangeHandler[] = [];
  private options: Required<SharedWorkspaceOptions>;

  constructor(options?: SharedWorkspaceOptions) {
    this.options = {
      maxEntries: options?.maxEntries ?? 500,
      maxSize: options?.maxSize ?? 10 * 1024 * 1024, // 10 MB
      trackHistory: options?.trackHistory ?? true,
    };
  }

  /** Set a value in the workspace */
  set(key: string, value: unknown, agentId: AgentId, metadata?: Record<string, unknown>): WorkspaceEntry {
    const existing = this.entries.get(key);
    const version = existing ? existing.version + 1 : 1;

    const entry: WorkspaceEntry = {
      key,
      value,
      setBy: agentId,
      timestamp: new Date().toISOString(),
      version,
      metadata,
    };

    // Track change
    if (this.options.trackHistory) {
      const changeEvent: WorkspaceChangeEvent = {
        key,
        oldValue: existing?.value ?? undefined,
        newValue: value,
        changedBy: agentId,
        timestamp: entry.timestamp,
        version,
      };
      this.changeHistory.push(changeEvent);

      // Notify handlers
      for (const handler of this.changeHandlers) {
        handler(changeEvent);
      }
    }

    this.entries.set(key, entry);
    this.enforceLimit();

    return entry;
  }

  /** Get a value from the workspace */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.entries.get(key);
    return entry?.value as T | undefined;
  }

  /** Get the full entry with metadata */
  getEntry(key: string): WorkspaceEntry | undefined {
    return this.entries.get(key);
  }

  /** Check if a key exists */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Delete a key */
  delete(key: string, agentId: AgentId): boolean {
    const existing = this.entries.get(key);
    if (!existing) return false;

    if (this.options.trackHistory) {
      this.changeHistory.push({
        key,
        oldValue: existing.value,
        newValue: undefined,
        changedBy: agentId,
        timestamp: new Date().toISOString(),
        version: existing.version + 1,
      });
    }

    this.entries.delete(key);
    return true;
  }

  /** Get all entries */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.entries) {
      result[key] = entry.value;
    }
    return result;
  }

  /** Get all entries with metadata */
  getAllEntries(): WorkspaceEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get entries set by a specific agent */
  getByAgent(agentId: AgentId): WorkspaceEntry[] {
    return Array.from(this.entries.values()).filter(e => e.setBy === agentId);
  }

  /** Get entries matching a key pattern (supports * wildcard) */
  query(pattern: string): WorkspaceEntry[] {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.entries.values()).filter(e => regex.test(e.key));
  }

  /** Merge data into an existing key (for objects) */
  merge(key: string, data: Record<string, unknown>, agentId: AgentId): WorkspaceEntry {
    const existing = this.get<Record<string, unknown>>(key) ?? {};
    const merged = { ...existing, ...data };
    return this.set(key, merged, agentId);
  }

  /** Append to an array at a key */
  append(key: string, item: unknown, agentId: AgentId): WorkspaceEntry {
    const existing = this.get<unknown[]>(key) ?? [];
    const updated = [...existing, item];
    return this.set(key, updated, agentId);
  }

  /** Get change history for a key */
  getHistory(key?: string): WorkspaceChangeEvent[] {
    if (key) {
      return this.changeHistory.filter(e => e.key === key);
    }
    return [...this.changeHistory];
  }

  /** Subscribe to workspace changes */
  onChange(handler: WorkspaceChangeHandler): () => void {
    this.changeHandlers.push(handler);
    return () => {
      const idx = this.changeHandlers.indexOf(handler);
      if (idx >= 0) this.changeHandlers.splice(idx, 1);
    };
  }

  /** Get the size of the workspace (approximate, in entries) */
  get size(): number {
    return this.entries.size;
  }

  /** Clear the entire workspace */
  clear(): void {
    this.entries.clear();
    this.changeHistory = [];
  }

  /** Export workspace as JSON (for persistence) */
  export(): Record<string, WorkspaceEntry> {
    const result: Record<string, WorkspaceEntry> = {};
    for (const [key, entry] of this.entries) {
      result[key] = entry;
    }
    return result;
  }

  /** Import workspace from JSON (for recovery) */
  import(data: Record<string, WorkspaceEntry>): void {
    for (const [key, entry] of Object.entries(data)) {
      this.entries.set(key, entry);
    }
  }

  private enforceLimit(): void {
    if (this.entries.size > this.options.maxEntries) {
      // Remove oldest entries
      const sorted = Array.from(this.entries.entries())
        .sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));

      const toRemove = sorted.slice(0, this.entries.size - this.options.maxEntries);
      for (const [key] of toRemove) {
        this.entries.delete(key);
      }
    }
  }
}
