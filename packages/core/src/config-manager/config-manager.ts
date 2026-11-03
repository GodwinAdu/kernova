/**
 * Kernova Config Manager
 *
 * Layered configuration with:
 * - Multiple sources (defaults, file, env, runtime)
 * - Hot reload (file watch)
 * - Change event emission
 * - Type-safe access with dot-path notation
 * - Override precedence: defaults < file < env < runtime
 *
 * Inspired by OpenClaw's config system.
 */

import type { KernovaId, KernovaEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface ConfigManagerOptions {
  /** Default configuration values */
  defaults?: Record<string, unknown>;
  /** File-based configuration (loaded from JSON/YAML) */
  fileConfig?: Record<string, unknown>;
  /** Environment variable prefix (e.g., 'KERNOVA_') */
  envPrefix?: string;
}

type ConfigLayer = 'defaults' | 'file' | 'env' | 'runtime';

export class ConfigManager {
  private readonly eventBus: EventBus;
  private readonly envPrefix: string;
  private layers: Map<ConfigLayer, Record<string, unknown>> = new Map();
  private watchers: Map<string, Array<(value: unknown) => void>> = new Map();

  constructor(eventBus: EventBus, options?: ConfigManagerOptions) {
    this.eventBus = eventBus;
    this.envPrefix = options?.envPrefix ?? 'KERNOVA_';

    // Initialize layers
    this.layers.set('defaults', options?.defaults ?? {});
    this.layers.set('file', options?.fileConfig ?? {});
    this.layers.set('env', this.loadFromEnv());
    this.layers.set('runtime', {});
  }

  /**
   * Get a config value by dot-path (e.g., 'models.default.provider').
   * Resolves through layers: runtime > env > file > defaults.
   */
  get<T = unknown>(path: string): T | undefined {
    const layers: ConfigLayer[] = ['runtime', 'env', 'file', 'defaults'];
    for (const layer of layers) {
      const config = this.layers.get(layer);
      if (!config) continue;
      const value = this.resolvePath(config, path);
      if (value !== undefined) return value as T;
    }
    return undefined;
  }

  /**
   * Get a config value with a default fallback.
   */
  getOrDefault<T>(path: string, defaultValue: T): T {
    const value = this.get<T>(path);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Set a runtime config value (highest priority).
   */
  set(path: string, value: unknown): void {
    const runtime = this.layers.get('runtime')!;
    this.setPath(runtime, path, value);

    // Notify watchers
    const watcherCallbacks = this.watchers.get(path);
    if (watcherCallbacks) {
      for (const cb of watcherCallbacks) cb(value);
    }

    this.emitEvent('config.changed', path, { path, value, layer: 'runtime' });
  }

  /**
   * Reload file configuration (e.g., after file change).
   */
  reload(fileConfig: Record<string, unknown>): void {
    const previous = this.layers.get('file');
    this.layers.set('file', fileConfig);

    // Diff and emit changes
    const changes = this.diffConfigs(previous ?? {}, fileConfig);
    for (const change of changes) {
      this.emitEvent('config.changed', change.path, {
        path: change.path,
        oldValue: change.oldValue,
        newValue: change.newValue,
        layer: 'file',
      });

      // Notify watchers
      const watcherCallbacks = this.watchers.get(change.path);
      if (watcherCallbacks) {
        for (const cb of watcherCallbacks) cb(change.newValue);
      }
    }

    this.emitEvent('config.reloaded', 'config', {
      changeCount: changes.length,
    });
  }

  /**
   * Watch a config path for changes.
   */
  watch(path: string, callback: (value: unknown) => void): () => void {
    if (!this.watchers.has(path)) this.watchers.set(path, []);
    this.watchers.get(path)!.push(callback);
    return () => {
      const cbs = this.watchers.get(path);
      if (cbs) {
        const idx = cbs.indexOf(callback);
        if (idx >= 0) cbs.splice(idx, 1);
      }
    };
  }

  /**
   * Get all resolved configuration (merged layers).
   */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const layers: ConfigLayer[] = ['defaults', 'file', 'env', 'runtime'];
    for (const layer of layers) {
      const config = this.layers.get(layer);
      if (config) this.deepMerge(result, config);
    }
    return result;
  }

  // ─── Private ───────────────────────────────────────────────

  private loadFromEnv(): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(this.envPrefix) && value) {
        const configKey = key.slice(this.envPrefix.length).toLowerCase().replace(/__/g, '.');
        this.setPath(config, configKey, value);
      }
    }
    return config;
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        this.deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }

  private diffConfigs(
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
    prefix = '',
  ): Array<{ path: string; oldValue: unknown; newValue: unknown }> {
    const changes: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

    for (const key of allKeys) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const oldVal = prev[key];
      const newVal = next[key];

      if (oldVal !== newVal) {
        if (typeof oldVal === 'object' && typeof newVal === 'object' && oldVal && newVal && !Array.isArray(oldVal)) {
          changes.push(...this.diffConfigs(
            oldVal as Record<string, unknown>,
            newVal as Record<string, unknown>,
            fullPath,
          ));
        } else {
          changes.push({ path: fullPath, oldValue: oldVal, newValue: newVal });
        }
      }
    }
    return changes;
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'config',
      actorId: 'config-manager',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'config-manager', environment: 'runtime' },
    });
  }
}
