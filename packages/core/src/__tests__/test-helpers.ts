/**
 * Shared Test Utilities for Kernova Core
 *
 * Provides reusable helpers and fast-check arbitraries for property-based testing
 * across all autonomy modules.
 */

import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fc from 'fast-check';
import { EventBus } from '../events/event-bus.js';
import type { NexusEvent } from '@kernova/types';

/**
 * Create an in-memory EventBus for testing (no SQLite persistence).
 * Automatically starts the bus; caller should call stop() in afterEach.
 */
export async function createTestEventBus(): Promise<EventBus> {
  const bus = new EventBus({ persistent: false });
  await bus.start();
  return bus;
}

/**
 * Create a temporary data directory for SQLite databases in tests.
 * Returns the path and a cleanup function that removes the directory.
 */
export function createTestDataDir(): { path: string; cleanup: () => void } {
  const dirPath = join(tmpdir(), `kernova-test-${randomUUID()}`);
  mkdirSync(dirPath, { recursive: true });

  const cleanup = () => {
    rmSync(dirPath, { recursive: true, force: true });
  };

  return { path: dirPath, cleanup };
}

/**
 * Subscribe to all events on a bus and collect them into an array.
 * Returns the mutable array that will be populated as events arrive.
 */
export function collectEvents(bus: EventBus): NexusEvent[] {
  const events: NexusEvent[] = [];
  bus.subscribe(['*'], (event) => {
    events.push(event);
  });
  return events;
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/**
 * Arbitrary that generates valid 5-field cron expressions.
 * Fields: minute (0-59), hour (0-23), day-of-month (1-31), month (1-12), day-of-week (0-6)
 * Supports single values and wildcards (*).
 */
export const arbCronExpression: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(fc.constant('*'), fc.integer({ min: 0, max: 59 }).map(String)),
    fc.oneof(fc.constant('*'), fc.integer({ min: 0, max: 23 }).map(String)),
    fc.oneof(fc.constant('*'), fc.integer({ min: 1, max: 31 }).map(String)),
    fc.oneof(fc.constant('*'), fc.integer({ min: 1, max: 12 }).map(String)),
    fc.oneof(fc.constant('*'), fc.integer({ min: 0, max: 6 }).map(String)),
  )
  .map(
    ([minute, hour, dom, month, dow]: [string, string, string, string, string]) =>
      `${minute} ${hour} ${dom} ${month} ${dow}`,
  );

/**
 * Arbitrary that generates valid dot-separated event patterns.
 * Each segment is alphanumeric or '*', total length ≤256 characters.
 */
export const arbEventPattern: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      fc.constant('*'),
      fc.stringOf(fc.char().filter((c: string) => /[a-z0-9]/i.test(c)), { minLength: 1, maxLength: 20 }),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((segments: string[]) => segments.join('.'))
  .filter((pattern: string) => pattern.length <= 256);

/**
 * Arbitrary that generates one of the four valid priority levels.
 */
export const arbPriority: fc.Arbitrary<'critical' | 'high' | 'medium' | 'low'> = fc.constantFrom(
  'critical' as const,
  'high' as const,
  'medium' as const,
  'low' as const,
);
