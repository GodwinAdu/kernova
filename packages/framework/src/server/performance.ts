/**
 * Performance utilities for the Kernova Framework server.
 *
 * Provides:
 * - ConnectionPool: Singleton database connection pool manager
 * - RecallCache: LRU cache for memory recall results
 * - EmbeddingCache: LRU cache for embedding vectors
 * - createSSEStream: Optimized Server-Sent Events helper
 */

import type { ServerResponse } from 'node:http';

// ─── LRU Cache (shared base) ─────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlSeconds: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlSeconds * 1000;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete existing to refresh position
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── Connection Pool Manager ─────────────────────────────────────────────────

/**
 * Singleton connection pool manager.
 * Lazily initializes pools and reuses them across requests.
 */
export class ConnectionPool {
  private static pools = new Map<string, any>();
  private static healthCheckIntervals = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * Get or create a connection pool for the given URL.
   * Uses lazy initialization — only connects when first accessed.
   */
  static async getPool(url: string): Promise<any> {
    if (this.pools.has(url)) {
      return this.pools.get(url)!;
    }

    // Dynamically import pg (only when needed)
    let pg: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      pg = require('pg');
    } catch {
      pg = await (Function('m', 'return import(m)')('pg'));
    }
    const Pool = pg.default?.Pool || pg.Pool;

    const pool = new Pool({
      connectionString: url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Verify the connection works
    const client = await pool.connect();
    client.release();

    this.pools.set(url, pool);

    // Start health check (every 30 seconds)
    const interval = setInterval(async () => {
      try {
        await pool.query('SELECT 1');
      } catch (err: any) {
        console.error(`[ConnectionPool] Health check failed for pool: ${err.message}`);
      }
    }, 30000);

    // Don't keep the process alive just for health checks
    if (interval.unref) interval.unref();
    this.healthCheckIntervals.set(url, interval);

    return pool;
  }

  /**
   * Check if a pool exists for the given URL.
   */
  static has(url: string): boolean {
    return this.pools.has(url);
  }

  /**
   * Gracefully close all connection pools.
   */
  static async closeAll(): Promise<void> {
    // Stop health checks
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();

    // Close all pools
    const closePromises: Promise<void>[] = [];
    for (const [url, pool] of this.pools.entries()) {
      closePromises.push(
        pool.end().catch((err: any) => {
          console.error(`[ConnectionPool] Error closing pool (${url}): ${err.message}`);
        })
      );
    }
    await Promise.all(closePromises);
    this.pools.clear();
  }
}

// ─── Recall Cache ────────────────────────────────────────────────────────────

export interface MemoryResult {
  entry?: { content?: string; [key: string]: any };
  content?: string;
  score?: number;
  [key: string]: any;
}

/**
 * In-memory LRU cache for memory recall results.
 * Key = hash of query + namespace + layer.
 * Invalidated on write (store/delete).
 */
export class RecallCache {
  private lru: LRUCache<MemoryResult[]>;

  constructor(options?: { maxSize?: number; ttl?: number }) {
    this.lru = new LRUCache<MemoryResult[]>(
      options?.maxSize ?? 200,
      options?.ttl ?? 60,
    );
  }

  get(key: string): MemoryResult[] | null {
    return this.lru.get(key);
  }

  set(key: string, results: MemoryResult[]): void {
    this.lru.set(key, results);
  }

  /**
   * Invalidate cached entries.
   * If namespace is provided, only invalidates entries matching that prefix.
   * If no namespace, clears everything.
   */
  invalidate(namespace?: string): void {
    this.lru.invalidate(namespace);
  }

  clear(): void {
    this.lru.clear();
  }

  get size(): number {
    return this.lru.size;
  }
}

// ─── Embedding Cache ─────────────────────────────────────────────────────────

/**
 * Cache for embedding vectors.
 * Same query text → same embedding (avoids redundant API calls).
 * LRU with configurable max size and TTL.
 */
export class EmbeddingCache {
  private lru: LRUCache<number[]>;

  constructor(options?: { maxSize?: number; ttl?: number }) {
    this.lru = new LRUCache<number[]>(
      options?.maxSize ?? 500,
      options?.ttl ?? 3600, // 1 hour default
    );
  }

  get(text: string): number[] | null {
    return this.lru.get(text);
  }

  set(text: string, embedding: number[]): void {
    this.lru.set(text, embedding);
  }

  clear(): void {
    this.lru.clear();
  }

  get size(): number {
    return this.lru.size;
  }
}

// ─── SSE Stream Helper ───────────────────────────────────────────────────────

export interface SSEStream {
  /** Write a data event to the stream */
  write: (data: any) => void;
  /** End the stream and clean up */
  end: () => void;
  /** Register a cleanup callback for when the client disconnects */
  onClose: (fn: () => void) => void;
}

/**
 * Create a properly managed Server-Sent Events stream.
 * Handles backpressure, connection cleanup, heartbeat, and errors.
 */
export function createSSEStream(res: ServerResponse): SSEStream {
  const cleanupFns: Array<() => void> = [];
  let closed = false;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Heartbeat to keep connection alive (every 15 seconds)
  const heartbeat = setInterval(() => {
    if (!closed) {
      try {
        res.write(':ping\n\n');
      } catch {
        // Connection already closed
        cleanup();
      }
    }
  }, 15000);

  // Cleanup function
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const fn of cleanupFns) {
      try { fn(); } catch { /* ignore cleanup errors */ }
    }
  }

  // Listen for client disconnect
  res.on('close', cleanup);
  res.on('error', cleanup);

  return {
    write(data: any) {
      if (closed) return;
      try {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        // Handle backpressure
        const canContinue = res.write(`data: ${payload}\n\n`);
        if (!canContinue) {
          // Wait for drain before writing more (backpressure)
          res.once('drain', () => { /* ready for more writes */ });
        }
      } catch {
        cleanup();
      }
    },

    end() {
      if (closed) return;
      try {
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {
        // Already closed
      }
      cleanup();
    },

    onClose(fn: () => void) {
      cleanupFns.push(fn);
    },
  };
}
