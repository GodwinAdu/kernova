/**
 * Kernova Utilities
 * Core utility functions used throughout the runtime
 */

import { randomUUID } from 'node:crypto';
import type { NexusId, Timestamp } from '@kernova/types';

/**
 * Generate a unique Kernova ID with optional prefix
 */
export function generateId(prefix?: string): NexusId {
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
