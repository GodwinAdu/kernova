/**
 * Kernova Hot Reloader
 *
 * Watches configuration and agent files for changes,
 * then triggers live reload without full restart:
 * - Config file changes → ConfigManager.reload()
 * - Agent file changes → re-register agent definitions
 * - Plugin changes → re-initialize plugins
 *
 * Uses fs.watch with debouncing to avoid rapid-fire reloads.
 */

import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { NexusId, NexusEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface HotReloaderConfig {
  /** Files/directories to watch */
  watchPaths: string[];
  /** Debounce interval in ms */
  debounceMs?: number;          // default: 500
  /** File patterns to react to (glob-like) */
  patterns?: string[];          // default: ['*.json', '*.ts', '*.js']
}

type ReloadHandler = (filePath: string) => Promise<void>;

export class HotReloader {
  private readonly eventBus: EventBus;
  private readonly config: HotReloaderConfig;
  private watchers: FSWatcher[] = [];
  private handlers: Map<string, ReloadHandler> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private running = false;

  constructor(eventBus: EventBus, config: HotReloaderConfig) {
    this.eventBus = eventBus;
    this.config = config;
  }

  /**
   * Register a handler for a file pattern.
   * Pattern supports: '*.json', '*.ts', 'config.*', exact filenames.
   */
  on(pattern: string, handler: ReloadHandler): void {
    this.handlers.set(pattern, handler);
  }

  /**
   * Start watching for file changes.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    for (const watchPath of this.config.watchPaths) {
      try {
        const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (filename && eventType === 'change') {
            this.handleChange(filename);
          }
        });
        this.watchers.push(watcher);
      } catch {
        // Path doesn't exist or can't be watched — skip
      }
    }

    this.emitEvent('hotreload.started', 'hotreload', {
      watchPaths: this.config.watchPaths,
      patterns: Array.from(this.handlers.keys()),
    });
  }

  /**
   * Stop watching.
   */
  stop(): void {
    this.running = false;
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ─── Private ───────────────────────────────────────────────

  private handleChange(filename: string): void {
    const debounceMs = this.config.debounceMs ?? 500;

    // Debounce per-file
    const existing = this.debounceTimers.get(filename);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filename);
      this.triggerReload(filename);
    }, debounceMs);

    this.debounceTimers.set(filename, timer);
  }

  private async triggerReload(filename: string): Promise<void> {
    for (const [pattern, handler] of this.handlers) {
      if (this.matchPattern(filename, pattern)) {
        try {
          await handler(filename);
          this.emitEvent('hotreload.reloaded', filename, {
            file: filename,
            pattern,
          });
        } catch (error) {
          this.emitEvent('hotreload.error', filename, {
            file: filename,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private matchPattern(filename: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === filename) return true;
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // e.g., '.json'
      return filename.endsWith(ext);
    }
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return filename.startsWith(prefix);
    }
    return false;
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('error') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'hot_reload',
      actorId: 'hot-reloader',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'hot-reloader', environment: 'runtime' },
    });
  }
}
