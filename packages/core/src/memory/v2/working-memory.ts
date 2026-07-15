/**
 * Working Memory — In-process, TTL-based ephemeral storage.
 *
 * No database needed. Lives in RAM. Dies with the process.
 * Used for: current task state, tool outputs, temporary calculations.
 *
 * Features:
 * - O(1) get/set/delete via Map
 * - Automatic TTL expiration (lazy + periodic cleanup)
 * - Prefix-based retrieval for grouped data
 * - Configurable max size (LRU eviction when full)
 */

import type { WorkingMemory, WorkingMemoryEntry } from './types.js';

export interface WorkingMemoryOptions {
  /** Default TTL in seconds (default: 3600 = 1 hour) */
  defaultTTL?: number;
  /** Maximum entries before LRU eviction (default: 1000) */
  maxSize?: number;
  /** How often to run cleanup in ms (default: 60000 = 1 min) */
  cleanupInterval?: number;
}

export class InProcessWorkingMemory implements WorkingMemory {
  private store = new Map<string, WorkingMemoryEntry>();
  private accessOrder: string[] = [];
  private defaultTTL: number;
  private maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WorkingMemoryOptions = {}) {
    this.defaultTTL = options.defaultTTL || 3600;
    this.maxSize = options.maxSize || 1000;

    // Periodic cleanup of expired entries
    const interval = options.cleanupInterval || 60000;
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
    // Don't prevent process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Check expiration (lazy eviction)
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromOrder(key);
      return undefined;
    }

    // Update access order (move to end = most recently used)
    this.removeFromOrder(key);
    this.accessOrder.push(key);

    return entry.value as T;
  }

  set(key: string, value: unknown, ttl?: number): void {
    const effectiveTTL = ttl ?? this.defaultTTL;
    const now = Date.now();

    // Evict LRU if at capacity
    if (!this.store.has(key) && this.store.size >= this.maxSize) {
      this.evictLRU();
    }

    this.store.set(key, {
      key,
      value,
      ttl: effectiveTTL,
      createdAt: now,
      expiresAt: now + effectiveTTL * 1000,
    });

    // Update access order
    this.removeFromOrder(key);
    this.accessOrder.push(key);
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.removeFromOrder(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.store.delete(key);
    this.removeFromOrder(key);
  }

  clear(): void {
    this.store.clear();
    this.accessOrder = [];
  }

  keys(): string[] {
    // Return only non-expired keys
    const validKeys: string[] = [];
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now <= entry.expiresAt) {
        validKeys.push(key);
      }
    }
    return validKeys;
  }

  size(): number {
    return this.keys().length;
  }

  getByPrefix<T = unknown>(prefix: string): Array<{ key: string; value: T }> {
    const results: Array<{ key: string; value: T }> = [];
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (key.startsWith(prefix) && now <= entry.expiresAt) {
        results.push({ key, value: entry.value as T });
      }
    }

    return results;
  }

  /** Stop the cleanup timer (for graceful shutdown) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  // ─── Private ───────────────────────────────────────────

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.store.delete(key);
      this.removeFromOrder(key);
    }
  }

  private evictLRU(): void {
    // Remove the least recently used entry
    while (this.accessOrder.length > 0 && this.store.size >= this.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.store.delete(oldest);
      }
    }
  }

  private removeFromOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }
}
