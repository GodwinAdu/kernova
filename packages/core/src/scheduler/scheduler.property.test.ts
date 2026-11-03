/**
 * Property-Based Tests for Kernova Scheduler
 *
 * Tests cron next execution correctness and persistence round-trip
 * using fast-check for randomized input generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scheduler } from './scheduler.js';
import { getNextCronDate, isValidCron } from './cron-utils.js';
import { EventBus } from '../events/event-bus.js';

// ─── Helpers ─────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kernova-sched-test-'));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Arbitrary for valid 5-field cron expressions.
 * Generates each field with valid cron values.
 */
const cronMinuteArb = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 0, max: 59 }).map(String),
  fc.constant('*/5'),
  fc.constant('*/10'),
  fc.constant('*/15'),
  fc.constant('0,15,30,45'),
);

const cronHourArb = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 0, max: 23 }).map(String),
  fc.constant('*/2'),
  fc.constant('*/6'),
  fc.constant('9-17'),
);

const cronDayOfMonthArb = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 1, max: 28 }).map(String),
  fc.constant('1,15'),
  fc.constant('*/7'),
);

const cronMonthArb = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 1, max: 12 }).map(String),
  fc.constant('1,6'),
  fc.constant('*/3'),
);

const cronDayOfWeekArb = fc.oneof(
  fc.constant('*'),
  fc.integer({ min: 0, max: 6 }).map(String),
  fc.constant('1-5'),
  fc.constant('0,6'),
);

const validCronArb = fc
  .tuple(cronMinuteArb, cronHourArb, cronDayOfMonthArb, cronMonthArb, cronDayOfWeekArb)
  .map(([minute, hour, dom, month, dow]) => `${minute} ${hour} ${dom} ${month} ${dow}`)
  .filter((expr) => isValidCron(expr));

// ─── Property 1: Cron Next Execution > Now ───────────────────

describe('Property 1: Scheduler Cron Parsing Produces Valid Next Execution Times', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * For all valid 5-field cron expressions, the scheduler SHALL compute
   * a `nextExecutionAt` timestamp that is in the future relative to the current time.
   *
   * ∀ cron ∈ ValidCronExpressions:
   *   nextExecution(cron, now) > now
   */

  it('nextExecution(cron, now) > now for all valid cron expressions', () => {
    fc.assert(
      fc.property(validCronArb, (cronExpr) => {
        const now = new Date();
        const next = getNextCronDate(cronExpr, now);

        // The next execution must be strictly after now
        expect(next.getTime()).toBeGreaterThan(now.getTime());
      }),
      { numRuns: 200 }
    );
  });

  it('nextExecution(cron, now) > now for various reference times', () => {
    fc.assert(
      fc.property(
        validCronArb,
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
        (cronExpr, referenceDate) => {
          const next = getNextCronDate(cronExpr, referenceDate);

          // The next execution must be strictly after the reference date
          expect(next.getTime()).toBeGreaterThan(referenceDate.getTime());
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Property 3: Scheduler Persistence Round-Trip ────────────

describe('Property 3: Scheduler Job Persistence Round-Trip', () => {
  /**
   * **Validates: Requirements 3.4, 3.5**
   *
   * For all scheduled jobs registered with the scheduler, stopping and
   * restarting the scheduler SHALL preserve the job definition (name,
   * cron expression, enabled state) without data loss.
   *
   * ∀ job ∈ RegisteredJobs:
   *   stop() → start() → getJob(job.id) ≡ job
   */

  it('registered jobs survive stop and restart with same definition', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            suffix: fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 4, maxLength: 8 }),
            cronExpr: validCronArb,
            goal: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (jobInputs) => {
          // Use a fresh temp dir for each property run
          const runDir = createTempDir();

          try {
            // Generate unique names using index + suffix
            const uniqueInputs = jobInputs.map((input, idx) => ({
              name: `job-${idx}-${input.suffix}`,
              cronExpr: input.cronExpr,
              goal: input.goal,
            }));

            const eventBus = new EventBus({ persistent: false });

            // Phase 1: Create scheduler, register jobs, stop
            const scheduler1 = new Scheduler(eventBus, { dataDir: runDir });
            await scheduler1.start();

            const registeredJobs = uniqueInputs.map((input) =>
              scheduler1.register({
                name: input.name,
                cronExpression: input.cronExpr,
                target: {
                  type: 'intent',
                  goal: input.goal,
                },
              })
            );

            await scheduler1.stop();

            // Phase 2: Create a new scheduler pointing to same dataDir (restart)
            const scheduler2 = new Scheduler(eventBus, { dataDir: runDir });
            await scheduler2.start();

            // Verify all jobs are preserved
            const restoredJobs = scheduler2.list();
            expect(restoredJobs.length).toBe(registeredJobs.length);

            for (const original of registeredJobs) {
              const restored = restoredJobs.find((j) => j.id === original.id);
              expect(restored).toBeDefined();
              expect(restored!.name).toBe(original.name);
              expect(restored!.cronExpression).toBe(original.cronExpression);
              expect(restored!.enabled).toBe(original.enabled);
              expect(restored!.target.type).toBe(original.target.type);
              expect(restored!.target.goal).toBe(original.target.goal);
            }

            await scheduler2.stop();
          } finally {
            cleanupDir(runDir);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('one-shot jobs preserve delayMs and oneShot flag across restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            suffix: fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 4, maxLength: 8 }),
            delayMs: fc.integer({ min: 1000, max: 60_000 }),
            goal: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (jobInputs) => {
          // Use a fresh temp dir for each property run
          const runDir = createTempDir();

          try {
            // Generate unique names using index + suffix
            const uniqueInputs = jobInputs.map((input, idx) => ({
              name: `oneshot-${idx}-${input.suffix}`,
              delayMs: input.delayMs,
              goal: input.goal,
            }));

            const eventBus = new EventBus({ persistent: false });

            // Phase 1: Create scheduler, register one-shot jobs, stop
            const scheduler1 = new Scheduler(eventBus, { dataDir: runDir });
            await scheduler1.start();

            const registeredJobs = uniqueInputs.map((input) =>
              scheduler1.register({
                name: input.name,
                delayMs: input.delayMs,
                oneShot: true,
                target: {
                  type: 'intent',
                  goal: input.goal,
                },
              })
            );

            await scheduler1.stop();

            // Phase 2: Restart
            const scheduler2 = new Scheduler(eventBus, { dataDir: runDir });
            await scheduler2.start();

            // Verify all one-shot jobs are preserved
            const restoredJobs = scheduler2.list();
            expect(restoredJobs.length).toBe(registeredJobs.length);

            for (const original of registeredJobs) {
              const restored = restoredJobs.find((j) => j.id === original.id);
              expect(restored).toBeDefined();
              expect(restored!.name).toBe(original.name);
              expect(restored!.oneShot).toBe(true);
              expect(restored!.delayMs).toBe(original.delayMs);
              expect(restored!.enabled).toBe(original.enabled);
              expect(restored!.target.goal).toBe(original.target.goal);
            }

            await scheduler2.stop();
          } finally {
            cleanupDir(runDir);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
