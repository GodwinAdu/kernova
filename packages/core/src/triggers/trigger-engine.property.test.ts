/**
 * Property-Based Tests for Proactive Trigger Engine
 *
 * Tests correctness properties:
 * - Property 7: Cooldown enforcement — rapid events only produce one firing per cooldown window
 * - Property 13: Trigger persistence round-trip — rules survive restart
 * - Property 8: Event pattern matching correctness
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProactiveTriggerEngine } from './trigger-engine.js';
import { EventBus } from '../events/event-bus.js';

// ─── Helpers ─────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kernova-trigger-test-'));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/** Helper to wait a specific number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Arbitraries ────────────────────────────────────────────

/** Generate a valid dot-separated event pattern segment (alphanumeric) */
const segmentArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/);

/** Generate a valid event pattern with wildcards */
const eventPatternArb = fc
  .array(
    fc.oneof(segmentArb, fc.constant('*')),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => parts.join('.'))
  .filter((p) => /^([a-zA-Z0-9]+|\*)(\.[a-zA-Z0-9]+|\.\*)*$/.test(p));

/** Generate a concrete event type (no wildcards) */
const concreteEventTypeArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join('.'));

/** Generate a trigger name */
const triggerNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,20}$/);

/** Generate a goal string */
const goalArb = fc.string({ minLength: 1, maxLength: 100 });

/** Generate a cooldown in range [100, 5000] */
const cooldownArb = fc.integer({ min: 100, max: 5000 });

/** Generate a priority */
const priorityArb = fc.constantFrom('low' as const, 'medium' as const, 'high' as const, 'critical' as const);

// ─── Property 7: Trigger Cooldown Enforcement ─────────────────
// **Validates: Requirements 11.3**
//
// For any trigger rule with cooldown period C, the trigger SHALL NOT fire
// more than once within any time window of duration C.

describe('Property 7: Trigger Cooldown Enforcement', () => {
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
  });

  afterEach(async () => {
    await eventBus.stop();
  });

  it('rapid events only produce one firing per cooldown window', async () => {
    await fc.assert(
      fc.asyncProperty(
        cooldownArb,
        fc.integer({ min: 3, max: 10 }), // number of rapid events to fire
        async (cooldownMs, eventCount) => {
          // Each iteration gets its own isolated data directory
          const iterDir = createTempDir();

          try {
            const firings: number[] = [];
            const engine = new ProactiveTriggerEngine(eventBus, {
              dataDir: iterDir,
              execute: async () => {
                firings.push(Date.now());
              },
            });

            await engine.start();

            // Register a trigger with the given cooldown
            engine.register({
              name: `cooldown-test`,
              eventPattern: 'test.cooldown.*',
              action: { goal: 'test cooldown' },
              cooldownMs,
            });

            // Fire multiple events in rapid succession (within cooldown window)
            for (let i = 0; i < eventCount; i++) {
              eventBus.publish({
                id: `evt-rapid-${i}-${Date.now()}`,
                eventType: 'test.cooldown.event',
                category: 'test',
                severity: 'info',
                timestamp: new Date().toISOString(),
                subjectId: 'test',
                subjectType: 'test',
                actorId: 'test',
                correlationId: `cor-${i}`,
                data: {},
                metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
              });
            }

            // Allow async execute callbacks to resolve
            await sleep(150);

            // PROPERTY: Only one firing should occur within the cooldown window
            // Since all events are fired rapidly (within ms of each other), the cooldown
            // (min 100ms) ensures at most 1 firing.
            expect(firings.length).toBe(1);

            await engine.stop();
          } finally {
            cleanupDir(iterDir);
          }
        },
      ),
      { numRuns: 30 },
    );
  }, 60000);

  it('consecutive firings are always separated by at least cooldownMs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 300 }), // cooldown in ms (keep short for test speed)
        fc.integer({ min: 3, max: 6 }),      // number of event bursts
        async (cooldownMs, burstCount) => {
          const iterDir = createTempDir();

          try {
            const firings: number[] = [];
            const engine = new ProactiveTriggerEngine(eventBus, {
              dataDir: iterDir,
              execute: async () => {
                firings.push(Date.now());
              },
            });

            await engine.start();

            engine.register({
              name: `cooldown-multi-test`,
              eventPattern: 'test.multi.*',
              action: { goal: 'test multi cooldown' },
              cooldownMs,
            });

            // Fire bursts of events, waiting for cooldown to expire between bursts
            for (let burst = 0; burst < burstCount; burst++) {
              // Fire 3 rapid events per burst
              for (let i = 0; i < 3; i++) {
                eventBus.publish({
                  id: `evt-burst-${burst}-${i}-${Date.now()}`,
                  eventType: 'test.multi.event',
                  category: 'test',
                  severity: 'info',
                  timestamp: new Date().toISOString(),
                  subjectId: 'test',
                  subjectType: 'test',
                  actorId: 'test',
                  correlationId: `cor-burst-${burst}-${i}`,
                  data: {},
                  metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
                });
              }

              // Wait for cooldown to expire before next burst
              await sleep(cooldownMs + 30);
            }

            // Allow final async execute callbacks to resolve
            await sleep(50);

            // PROPERTY: For any two consecutive firings, the time between them >= cooldownMs
            expect(firings.length).toBe(burstCount);
            for (let i = 1; i < firings.length; i++) {
              const gap = firings[i] - firings[i - 1];
              expect(gap).toBeGreaterThanOrEqual(cooldownMs);
            }

            await engine.stop();
          } finally {
            cleanupDir(iterDir);
          }
        },
      ),
      { numRuns: 10 },
    );
  }, 30000); // Extended timeout for sequential cooldown waits

  it('after cooldown expires, trigger can fire again', async () => {
    const testDir = createTempDir();

    try {
      const firings: number[] = [];
      const cooldownMs = 100; // Use short cooldown for test speed

      const engine = new ProactiveTriggerEngine(eventBus, {
        dataDir: testDir,
        execute: async () => {
          firings.push(Date.now());
        },
      });

      await engine.start();

      engine.register({
        name: `cooldown-expiry-test`,
        eventPattern: 'test.expire.*',
        action: { goal: 'test expiry' },
        cooldownMs,
      });

      // Fire first event — should trigger
      eventBus.publish({
        id: `evt-first-${Date.now()}`,
        eventType: 'test.expire.event',
        category: 'test',
        severity: 'info',
        timestamp: new Date().toISOString(),
        subjectId: 'test',
        subjectType: 'test',
        actorId: 'test',
        correlationId: 'cor-1',
        data: {},
        metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
      });

      await sleep(50);
      expect(firings.length).toBe(1);

      // Wait for cooldown to expire
      await sleep(cooldownMs + 20);

      // Fire second event — should trigger again
      eventBus.publish({
        id: `evt-second-${Date.now()}`,
        eventType: 'test.expire.event',
        category: 'test',
        severity: 'info',
        timestamp: new Date().toISOString(),
        subjectId: 'test',
        subjectType: 'test',
        actorId: 'test',
        correlationId: 'cor-2',
        data: {},
        metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
      });

      await sleep(50);
      expect(firings.length).toBe(2);

      // Verify the two firings are at least cooldownMs apart
      expect(firings[1] - firings[0]).toBeGreaterThanOrEqual(cooldownMs);

      await engine.stop();
    } finally {
      cleanupDir(testDir);
    }
  });
});

// ─── Property 13: Trigger Persistence Round-Trip ──────────────
// **Validates: Requirements 11.4**
//
// For all trigger rules registered with the engine, stopping and
// restarting SHALL preserve the rule definition.

describe('Property 13: Trigger Rule Persistence Round-Trip', () => {
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
  });

  afterEach(async () => {
    await eventBus.stop();
  });

  it('registered rules survive stop and restart with same definition', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: triggerNameArb,
            eventPattern: eventPatternArb,
            goal: goalArb,
            cooldownMs: cooldownArb,
            priority: priorityArb,
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (ruleInputs) => {
          const runDir = createTempDir();

          try {
            // Deduplicate names to avoid collision
            const uniqueInputs = ruleInputs.map((input, idx) => ({
              ...input,
              name: `${input.name}-${idx}`,
              // Also make patterns unique to avoid unique index collision
              eventPattern: `${input.eventPattern}`,
              conditionDescription: `cond-${idx}`,
            }));

            // Phase 1: Create engine, register rules, stop
            const engine1 = new ProactiveTriggerEngine(eventBus, { dataDir: runDir });
            await engine1.start();

            const registeredRules = uniqueInputs.map((input) =>
              engine1.register({
                name: input.name,
                eventPattern: input.eventPattern,
                conditionDescription: input.conditionDescription,
                action: {
                  goal: input.goal,
                  priority: input.priority,
                },
                cooldownMs: input.cooldownMs,
              }),
            );

            await engine1.stop();

            // Phase 2: Create a new engine pointing to same dataDir (restart)
            const engine2 = new ProactiveTriggerEngine(eventBus, { dataDir: runDir });
            await engine2.start();

            // Verify all rules are preserved
            const restoredRules = engine2.list();
            expect(restoredRules.length).toBe(registeredRules.length);

            for (const original of registeredRules) {
              const restored = restoredRules.find((r) => r.id === original.id);
              expect(restored).toBeDefined();
              expect(restored!.name).toBe(original.name);
              expect(restored!.eventPattern).toBe(original.eventPattern);
              expect(restored!.action.goal).toBe(original.action.goal);
              expect(restored!.action.priority).toBe(original.action.priority);
              expect(restored!.cooldownMs).toBe(original.cooldownMs);
              expect(restored!.enabled).toBe(original.enabled);
            }

            await engine2.stop();
          } finally {
            cleanupDir(runDir);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('disabled rules preserve their state across restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        triggerNameArb,
        eventPatternArb,
        goalArb,
        async (name, eventPattern, goal) => {
          const runDir = createTempDir();

          try {
            // Phase 1: Register and disable
            const engine1 = new ProactiveTriggerEngine(eventBus, { dataDir: runDir });
            await engine1.start();

            const rule = engine1.register({
              name: `${name}-disabled`,
              eventPattern,
              action: { goal },
              cooldownMs: 1000,
            });

            // Disable the rule
            engine1.disable(rule.id);

            await engine1.stop();

            // Phase 2: Restart and verify disabled state
            const engine2 = new ProactiveTriggerEngine(eventBus, { dataDir: runDir });
            await engine2.start();

            const restoredRules = engine2.list();
            const restored = restoredRules.find((r) => r.id === rule.id);
            expect(restored).toBeDefined();
            expect(restored!.enabled).toBe(false);

            await engine2.stop();
          } finally {
            cleanupDir(runDir);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 8: Event Pattern Matching Correctness ──────────
// **Validates: Requirements 11.1, 11.2**
//
// For events matching a trigger's glob pattern, intent is submitted.
// For non-matching events, no intent.

describe('Property 8: Event Pattern Matching Correctness', () => {
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
  });

  afterEach(async () => {
    await eventBus.stop();
  });

  /**
   * Helper: check if eventType matches a pattern using the same glob logic as EventBus.
   * Pattern matching: each segment must match exactly or be '*'.
   * Pattern and event must have same number of segments.
   */
  function globMatch(eventType: string, pattern: string): boolean {
    if (pattern === '*') return true;
    const patternParts = pattern.split('.');
    const typeParts = eventType.split('.');
    if (patternParts.length !== typeParts.length) return false;
    return patternParts.every((part, i) => part === '*' || part === typeParts[i]);
  }

  it('matching events cause action execution, non-matching do not', async () => {
    await fc.assert(
      fc.asyncProperty(
        eventPatternArb,
        concreteEventTypeArb,
        async (pattern, eventType) => {
          // Use an isolated directory per iteration to avoid stale rules from prior runs
          const iterDir = createTempDir();

          try {
            const fired: string[] = [];

            const engine = new ProactiveTriggerEngine(eventBus, {
              dataDir: iterDir,
              execute: async (action) => {
                fired.push(action.goal);
              },
            });

            await engine.start();

            const uniqueName = `match-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            engine.register({
              name: uniqueName,
              eventPattern: pattern,
              action: { goal: `fire-for-${pattern}` },
              cooldownMs: 100,
            });

            // Publish an event
            eventBus.publish({
              id: `evt-match-${Date.now()}`,
              eventType,
              category: 'test',
              severity: 'info',
              timestamp: new Date().toISOString(),
              subjectId: 'test',
              subjectType: 'test',
              actorId: 'test',
              correlationId: `cor-match-${Date.now()}`,
              data: {},
              metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
            });

            // Allow async execute to resolve
            await sleep(150);

            const shouldMatch = globMatch(eventType, pattern);

            if (shouldMatch) {
              // PROPERTY: matching events cause action execution
              expect(fired.length).toBe(1);
              expect(fired[0]).toBe(`fire-for-${pattern}`);
            } else {
              // PROPERTY: non-matching events do NOT cause action execution
              expect(fired.length).toBe(0);
            }

            await engine.stop();
          } finally {
            cleanupDir(iterDir);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 30000); // Extended timeout for I/O-heavy property test

  it('wildcard segments match any concrete segment of same depth', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(segmentArb, { minLength: 2, maxLength: 4 }),
        fc.integer({ min: 0, max: 3 }),
        async (segments, wildcardIdx) => {
          // Ensure wildcardIdx is valid for the array length
          const idx = wildcardIdx % segments.length;

          // Build a pattern with one wildcard segment
          const patternParts = [...segments];
          patternParts[idx] = '*';
          const pattern = patternParts.join('.');

          // The concrete event type matches (all segments same)
          const eventType = segments.join('.');

          const iterDir = createTempDir();

          try {
            const fired: string[] = [];

            const engine = new ProactiveTriggerEngine(eventBus, {
              dataDir: iterDir,
              execute: async (action) => {
                fired.push(action.goal);
              },
            });

            await engine.start();

            const uniqueName = `wildcard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            engine.register({
              name: uniqueName,
              eventPattern: pattern,
              action: { goal: 'wildcard-match' },
              cooldownMs: 100,
            });

            eventBus.publish({
              id: `evt-wc-${Date.now()}`,
              eventType,
              category: 'test',
              severity: 'info',
              timestamp: new Date().toISOString(),
              subjectId: 'test',
              subjectType: 'test',
              actorId: 'test',
              correlationId: `cor-wc-${Date.now()}`,
              data: {},
              metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
            });

            await sleep(150);

            // PROPERTY: a pattern with a wildcard in one position must match
            // a concrete event type with same number of segments
            expect(fired.length).toBe(1);

            await engine.stop();
          } finally {
            cleanupDir(iterDir);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 60000); // Extended timeout for I/O-heavy property test

  it('events with different segment count than pattern never match', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(segmentArb, { minLength: 2, maxLength: 3 }),
        fc.array(segmentArb, { minLength: 1, maxLength: 4 }),
        async (patternSegments, eventSegments) => {
          // Only test when segment counts differ
          fc.pre(patternSegments.length !== eventSegments.length);

          const pattern = patternSegments.join('.');
          const eventType = eventSegments.join('.');

          const iterDir = createTempDir();

          try {
            const fired: string[] = [];

            const engine = new ProactiveTriggerEngine(eventBus, {
              dataDir: iterDir,
              execute: async (action) => {
                fired.push(action.goal);
              },
            });

            await engine.start();

            const uniqueName = `depth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            engine.register({
              name: uniqueName,
              eventPattern: pattern,
              action: { goal: 'should-not-fire' },
              cooldownMs: 100,
            });

            eventBus.publish({
              id: `evt-depth-${Date.now()}`,
              eventType,
              category: 'test',
              severity: 'info',
              timestamp: new Date().toISOString(),
              subjectId: 'test',
              subjectType: 'test',
              actorId: 'test',
              correlationId: `cor-depth-${Date.now()}`,
              data: {},
              metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
            });

            await sleep(150);

            // PROPERTY: different segment counts never match
            expect(fired.length).toBe(0);

            await engine.stop();
          } finally {
            cleanupDir(iterDir);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 60000); // Extended timeout for I/O-heavy property test
});
