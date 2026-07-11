/**
 * Integration Test: Full Autonomy Flow
 *
 * Exercises the complete autonomy lifecycle through the SDK:
 * 1. Create app with ephemeral mode
 * 2. Register a scheduled job
 * 3. Enqueue a task
 * 4. Register a trigger
 * 5. Verify events are emitted on the kernel's EventBus
 * 6. Clean up
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Kernova } from '../kernova.js';
import type { NexusEvent } from '@kernova/types';

describe('Full Autonomy Flow (Integration)', () => {
  let app: Kernova;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('create app → schedule job → enqueue task → register trigger → verify events', async () => {
    // Step 1: Create app in ephemeral mode
    app = await Kernova.create({ ephemeral: true });

    const kernel = app.getKernel();
    const eventBus = kernel.events;

    // Collect events as they are emitted
    const collectedEvents: NexusEvent[] = [];
    eventBus.subscribe(['*'], (event) => {
      collectedEvents.push(event);
    });

    // Step 2: Register a scheduled job (one-shot with 5000ms delay)
    const jobName = `test-job-${Date.now()}`;
    app.schedule(jobName, 5000, async () => {});

    // Step 3: Enqueue a task
    const taskId = await app.enqueue('handler', { value: 42 });
    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe('string');
    expect(taskId.length).toBeGreaterThan(0);

    // Step 4: Register a trigger
    const triggerName = `on-task-${Date.now()}`;
    app.trigger(triggerName, 'task.*', { goal: 'handle task event' });

    // Step 5: Verify events and state

    // 5a: Verify the task was enqueued (check event emitted)
    const enqueueEvents = collectedEvents.filter(
      (e) => e.eventType === 'queue.task.enqueued',
    );
    expect(enqueueEvents.length).toBeGreaterThanOrEqual(1);

    // Verify the task ID matches what was returned
    const taskEvent = enqueueEvents.find(
      (e) => (e.data as Record<string, unknown>)?.taskId === taskId,
    );
    expect(taskEvent).toBeDefined();

    // 5b: Verify the trigger was registered (appears in kernel.triggers.list())
    const registeredTriggers = kernel.triggers.list();
    const ourTrigger = registeredTriggers.find((t) => t.name === triggerName);
    expect(ourTrigger).toBeDefined();
    expect(ourTrigger!.eventPattern).toBe('task.*');
    expect(ourTrigger!.action.goal).toBe('handle task event');
    expect(ourTrigger!.enabled).toBe(true);

    // 5c: Verify the scheduled job was registered
    // The scheduler stores jobs — we verify through the kernel's scheduler list
    const scheduledJobs = kernel.scheduler.list();
    const ourJob = scheduledJobs.find((j) => j.name === jobName);
    expect(ourJob).toBeDefined();
    expect(ourJob!.enabled).toBe(true);
    expect(ourJob!.oneShot).toBe(true);
    expect(ourJob!.delayMs).toBe(5000);

    // 5d: Verify the kernel is running (kernel.started fires before our subscription,
    // so we check status instead)
    const status = kernel.getStatus();
    expect(status.running).toBe(true);

    // Step 6: Clean up
    await app.close();
    // Prevent double-close in afterEach
    app = undefined as unknown as Kernova;
  });

  it('events flow end-to-end: enqueue emits event that trigger could match', async () => {
    app = await Kernova.create({ ephemeral: true });

    const kernel = app.getKernel();
    const eventBus = kernel.events;

    // Collect events matching queue task patterns
    const queueEvents: NexusEvent[] = [];
    eventBus.subscribe(['queue.task.*'], (event) => {
      queueEvents.push(event);
    });

    // Register a trigger that listens for queue task events
    const triggerName = `on-queue-${Date.now()}`;
    app.trigger(triggerName, 'queue.task.*', { goal: 'react to queue event' });

    // Enqueue multiple tasks
    const taskId1 = await app.enqueue('process-data', { batch: 1 });
    const taskId2 = await app.enqueue('process-data', { batch: 2 }, { priority: 'high' });

    // Verify both tasks generated enqueue events
    expect(queueEvents.length).toBeGreaterThanOrEqual(2);
    const taskIds = queueEvents.map(
      (e) => (e.data as Record<string, unknown>)?.taskId,
    );
    expect(taskIds).toContain(taskId1);
    expect(taskIds).toContain(taskId2);

    // Verify trigger is still registered and active
    const triggers = kernel.triggers.list();
    const trigger = triggers.find((t) => t.name === triggerName);
    expect(trigger).toBeDefined();
    expect(trigger!.enabled).toBe(true);
  });

  it('multiple scheduled jobs can coexist without conflicts', async () => {
    app = await Kernova.create({ ephemeral: true });

    const kernel = app.getKernel();

    const job1 = `cron-job-${Date.now()}-a`;
    const job2 = `oneshot-job-${Date.now()}-b`;

    // Register a cron job and a one-shot job
    app.schedule(job1, '*/5 * * * *', async () => {});
    app.schedule(job2, 10000, async () => {});

    const jobs = kernel.scheduler.list();
    const cronJob = jobs.find((j) => j.name === job1);
    const oneShotJob = jobs.find((j) => j.name === job2);

    expect(cronJob).toBeDefined();
    expect(cronJob!.cronExpression).toBe('*/5 * * * *');
    expect(cronJob!.oneShot).toBeUndefined();

    expect(oneShotJob).toBeDefined();
    expect(oneShotJob!.oneShot).toBe(true);
    expect(oneShotJob!.delayMs).toBe(10000);
  });
});
