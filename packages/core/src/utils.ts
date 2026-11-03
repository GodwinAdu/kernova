/**
 * Kernova Utilities
 * Core utility functions used throughout the runtime
 */

import { randomUUID } from 'node:crypto';
import type { KernovaId, Timestamp } from '@kernova/types';

/**
 * Generate a unique Kernova ID with optional prefix
 */
export function generateId(prefix?: string): KernovaId {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/**
 * Get current timestamp in ISO 8601 format
 */
export function now(): Timestamp {
  return new Date().toISOString();
}

/**
 * Calculate duration between two timestamps in ms
 */
export function duration(start: Timestamp, end?: Timestamp): number {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  return endMs - startMs;
}

/**
 * Deep clone an object (structuredClone wrapper)
 */
export function clone<T>(obj: T): T {
  return structuredClone(obj);
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** The longest delay setTimeout and setInterval accept (about 24.8 days); Node fires longer ones at once */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** A timer from setLongTimeout() or setLongInterval() */
export interface LongTimer {
  /** Stops the timer; it won't fire again */
  cancel(): void;
}

/**
 * setTimeout for delays of any length. A plain setTimeout fires delays over about 24.8 days
 * immediately; this waits in steps instead.
 */
export function setLongTimeout(fn: () => void, delayMs: number): LongTimer {
  const due = Date.now() + Math.max(0, delayMs);
  let handle: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const arm = () => {
    const remaining = Math.max(0, due - Date.now());
    handle = setTimeout(() => {
      if (cancelled) return;
      if (due - Date.now() > 0) arm();
      else fn();
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  };
  arm();
  return {
    cancel() {
      cancelled = true;
      if (handle) clearTimeout(handle);
    },
  };
}

/** setInterval for intervals of any length (see setLongTimeout) */
export function setLongInterval(fn: () => void, intervalMs: number): LongTimer {
  if (intervalMs <= MAX_TIMER_DELAY_MS) {
    const handle = setInterval(fn, Math.max(1, intervalMs));
    return { cancel: () => clearInterval(handle) };
  }
  let current: LongTimer;
  let cancelled = false;
  const schedule = () => {
    current = setLongTimeout(() => {
      if (cancelled) return;
      schedule();
      fn();
    }, intervalMs);
  };
  schedule();
  return {
    cancel() {
      cancelled = true;
      current.cancel();
    },
  };
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoff?: 'exponential' | 'linear' | 'fixed';
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 10000,
    backoff = 'exponential',
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) break;

      let delay: number;
      switch (backoff) {
        case 'exponential':
          delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          break;
        case 'linear':
          delay = Math.min(initialDelayMs * attempt, maxDelayMs);
          break;
        default:
          delay = initialDelayMs;
      }

      await sleep(delay);
    }
  }

  throw lastError;
}
