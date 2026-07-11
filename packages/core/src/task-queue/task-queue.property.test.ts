/**
 * Property-Based Tests for Kernova Task Queue
 *
 * Tests priority ordering, persistence round-trip, and concurrency limits
 * using fast-check for randomized input generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskQueue } from './task-queue.js';
import { QueueStore } from './queue-store.js';
import { EventBus } from '../events/event-bus.js';
import type { Priority } from '@kernova/types';

// ─── Helpers ─────────────────────────────────────────────────

const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];
const PRIORITY_NUMERIC: Record<Priority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kernova-tq-test-'));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// Arbitrary for priority values
const priorityArb = fc.constantFrom<Priority>('critical', 'high', 'medium', 'low');

// Arbitrary for a task input (handler + priority + payload)
const taskInputArb = fc.record({
  handler: fc.constantFrom('handler-a', 'handler-b', 'handler-c'),
  priority: priorityArb,
  payload: fc.record({
    value: fc.string({ minLength: 1, maxLength: 50 }),
  }),
});

// ─── Property 2: Task Queue Priority Ordering ────────────────

describe('Property 2: Task Queue Priority Ordering', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any set of enqueued tasks, the task queue SHALL dequeue tasks in
   * descending priority order (critical > high > medium > low).
   * Within the same priority level, tasks SHALL be dequeued in FIFO order.
   */

  it('dequeues tasks in descending priority order, FIFO within same level', () => {
    fc.assert(
      fc.property(
        fc.array(taskInputArb, { minLength: 2, maxLength: 30 }),
        (taskInputs) => {
          // Each iteration gets its own data dir for isolation
          const dataDir = createTempDir();
          try {
            const eventBus = new EventBus({ persistent: false });
            const queue = new TaskQueue(eventBus, {
              dataDir,
              concurrency: 50,
            });

            // Enqueue all tasks
            taskInputs.forEach((input) =>
              queue.enqueue({
                handler: input.handler,
                payload: input.payload,
                priority: input.priority,
              })
            );

            // Dequeue all from a fresh store to check ordering
            const store = new QueueStore({ dataDir });
            const dequeued: Array<{ id: string; priority: Priority; createdAt: string }> = [];
            let task = store.dequeue();
            while (task !== null) {
              dequeued.push({ id: task.id, priority: task.priority, createdAt: task.createdAt });
              store.updateStatus(task.id, 'running', task.attempt);
              task = store.dequeue();
            }
            store.close();

            // Verify ordering: higher priority first, FIFO within same level
            for (let i = 0; i < dequeued.length - 1; i++) {
              const current = dequeued[i];
              const next = dequeued[i + 1];
              const currentNumeric = PRIORITY_NUMERIC[current.priority];
              const nextNumeric = PRIORITY_NUMERIC[next.priority];

              if (currentNumeric !== nextNumeric) {
                // Higher priority (higher numeric value) should come first
                expect(currentNumeric).toBeGreaterThanOrEqual(nextNumeric);
              } else {
                // Same priority: FIFO (earlier createdAt comes first)
                expect(current.createdAt <= next.createdAt).toBe(true);
              }
            }

            // Cleanup
            queue.stop();
          } finally {
            cleanupDir(dataDir);
          }

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property 4: Task Queue Persistence Round-Trip ───────────

describe('Property 4: Task Queue Persistence Round-Trip', () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For all tasks in the queue (pending), stopping and restarting the
   * task queue SHALL preserve the task's payload, priority, and status.
   */

  it('enqueued tasks survive stop and restart with same payload and priority', () => {
    fc.assert(
      fc.property(
        fc.array(taskInputArb, { minLength: 1, maxLength: 20 }),
        (taskInputs) => {
          const dataDir = createTempDir();
          try {
            const eventBus = new EventBus({ persistent: false });

            // Phase 1: Create queue, enqueue tasks, stop
            const queue1 = new TaskQueue(eventBus, { dataDir, concurrency: 5 });
            const enqueuedItems = taskInputs.map((input) =>
              queue1.enqueue({
                handler: input.handler,
                payload: input.payload,
                priority: input.priority,
              })
            );
            // Stop the queue (closes the store)
            queue1.stop();

            // Phase 2: Create a new queue pointing to same dataDir (restart simulation)
            const queue2 = new TaskQueue(eventBus, { dataDir, concurrency: 5 });

            // Verify the stats match — all tasks should still be pending
            const stats = queue2.stats();
            expect(stats.pending).toBe(taskInputs.length);

            // Dequeue all and verify payloads are preserved
            const store = new QueueStore({ dataDir });
            const dequeuedMap = new Map<string, { payload: unknown; priority: Priority }>();
            let task = store.dequeue();
            while (task !== null) {
              dequeuedMap.set(task.id, { payload: task.payload, priority: task.priority });
              store.updateStatus(task.id, 'running', task.attempt);
              task = store.dequeue();
            }
            store.close();

            // Verify each enqueued task is present with correct payload and priority
            for (const original of enqueuedItems) {
              const found = dequeuedMap.get(original.id);
              expect(found).toBeDefined();
              expect(found!.payload).toEqual(original.payload);
              expect(found!.priority).toBe(original.priority);
            }

            queue2.stop();
          } finally {
            cleanupDir(dataDir);
          }

          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── Property 9: Concurrency Limit ──────────────────────────

describe('Property 9: Concurrency Limit', () => {
  /**
   * **Validates: Requirements 4.9**
   *
   * With concurrency=N, at no point do more than N tasks execute simultaneously.
   */

  it('never exceeds concurrency limit during execution', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 3, max: 10 }),
        async (concurrencyLimit, taskCount) => {
          const dataDir = createTempDir();
          try {
            const eventBus = new EventBus({ persistent: false });
            const queue = new TaskQueue(eventBus, {
              dataDir,
              concurrency: concurrencyLimit,
              taskTimeout: 10000,
            });

            let currentRunning = 0;
            let maxObservedRunning = 0;
            let violationDetected = false;
            let tasksCompleted = 0;

            // Register a handler that tracks concurrency
            queue.registerHandler('concurrency-test', async (_payload, _signal) => {
              currentRunning++;
              if (currentRunning > concurrencyLimit) {
                violationDetected = true;
              }
              maxObservedRunning = Math.max(maxObservedRunning, currentRunning);

              // Simulate some async work
              await new Promise((resolve) => setTimeout(resolve, 5));

              currentRunning--;
              tasksCompleted++;
            });

            // Start the queue
            await queue.start();

            // Enqueue tasks
            for (let i = 0; i < taskCount; i++) {
              queue.enqueue({
                handler: 'concurrency-test',
                payload: { index: i },
                priority: PRIORITIES[i % PRIORITIES.length],
              });
            }

            // Wait for all tasks to complete (with timeout)
            const deadline = Date.now() + 8000;
            await new Promise<void>((resolve) => {
              const check = () => {
                if (tasksCompleted >= taskCount || Date.now() > deadline) {
                  resolve();
                } else {
                  setTimeout(check, 20);
                }
              };
              setTimeout(check, 30);
            });

            await queue.stop();

            // Assert that concurrency was never violated
            expect(violationDetected).toBe(false);
            expect(maxObservedRunning).toBeLessThanOrEqual(concurrencyLimit);
          } finally {
            cleanupDir(dataDir);
          }

          return true;
        }
      ),
      { numRuns: 10 }
    );
  }, 60000); // 60s timeout for this property test
});
