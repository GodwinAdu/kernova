/**
 * Nexus File Watcher
 * 
 * Watches agent and workflow files for changes during development.
 * Triggers reload callbacks when files are modified, created, or deleted.
 * 
 * Design:
 * - Uses Node.js native fs.watch (recursive) — no external deps
 * - Debounces rapid changes (100ms) to avoid reload storms
 * - Filters to only .ts and .js files
 * - Reports errors without crashing
 */

import { watch, existsSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import type { FSWatcher } from 'node:fs';

export interface WatcherConfig {
  /** Directories to watch (relative to project root) */
  paths: string[];

  /** File extensions to watch */
  extensions?: string[];

  /** Debounce interval in ms */
  debounceMs?: number;

  /** Project root directory */
  rootDir: string;
}

export type FileChangeEvent = {
  type: 'change' | 'create' | 'delete';
  path: string;
  relativePath: string;
};

export type FileChangeHandler = (event: FileChangeEvent) => void | Promise<void>;

export class FileWatcher {
  private watchers: FSWatcher[] = [];
  private handlers: FileChangeHandler[] = [];
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private config: Required<WatcherConfig>;
  private running = false;

  constructor(config: WatcherConfig) {
    this.config = {
      paths: config.paths,
      extensions: config.extensions || ['.ts', '.js', '.mts', '.mjs'],
      debounceMs: config.debounceMs || 100,
      rootDir: config.rootDir,
    };
  }

  /**
   * Start watching files
   */
  start(): string[] {
    if (this.running) return [];

    const watchedPaths: string[] = [];

    for (const watchPath of this.config.paths) {
      const fullPath = resolve(this.config.rootDir, watchPath);

      if (!existsSync(fullPath)) continue;

      try {
        const watcher = watch(fullPath, { recursive: true }, (eventType, filename) => {
          if (!filename) return;

          const ext = extname(filename);
          if (!this.config.extensions.includes(ext)) return;

          const absolutePath = resolve(fullPath, filename);
          const relativePath = relative(this.config.rootDir, absolutePath);

          this.debouncedEmit(absolutePath, {
            type: eventType === 'rename' ? 'create' : 'change',
            path: absolutePath,
            relativePath,
          });
        });

        this.watchers.push(watcher);
        watchedPaths.push(watchPath);
      } catch (err) {
        // Directory might not exist yet — that's fine
      }
    }

    this.running = true;
    return watchedPaths;
  }

  /**
   * Stop watching
   */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.running = false;
  }

  /**
   * Register a change handler
   */
  onChange(handler: FileChangeHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Debounced event emission
   */
  private debouncedEmit(key: string, event: FileChangeEvent): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emit(event);
    }, this.config.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: FileChangeEvent): void {
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error(`[FileWatcher] Handler error: ${(err as Error).message}`);
          });
        }
      } catch (err) {
        console.error(`[FileWatcher] Handler error: ${(err as Error).message}`);
      }
    }
  }
}
