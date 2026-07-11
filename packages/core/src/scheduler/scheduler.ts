/**
 * Kernova Scheduler
 *
 * Manages cron-based scheduled job execution.
 * Uses setTimeout chaining (not setInterval) for precise next-tick scheduling.
 * Integrates with EventBus for lifecycle events and supports overlap detection,
 * execution timeout enforcement, and missed execution detection on startup.
 */

import type {
  ScheduledJob,
  ScheduledJobInput,
  ScheduleTarget,
  NexusId,
  NexusEvent,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { SchedulerStore } from './scheduler-store.js';
import { isValidCron, getNextCronDate } from './cron-utils.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';

export interface SchedulerConfig {
  dataDir: string;
  maxExecutionTimeout?: number; // default: 300_000 ms (300 seconds)
  execute?: (target: ScheduleTarget, signal: AbortSignal) => Promise<unknown>;
}

export class Scheduler {
  private readonly eventBus: EventBus;
  private readonly config: SchedulerConfig;
  private readonly maxExecutionTimeout: number;
  private store: SchedulerStore | null = null;
  private jobs: Map<NexusId, ScheduledJob> = new Map();
  private timers: Map<NexusId, ReturnType<typeof setTimeout>> = new Map();
  private runningJobs: Set<NexusId> = new Set();
  private running = false;

  constructor(eventBus: EventBus, config: SchedulerConfig) {
    this.eventBus = eventBus;
    this.config = config;
    this.maxExecutionTimeout = config.maxExecutionTimeout ?? 300_000;
  }

  /**
   * Start the scheduler: load persisted jobs, detect missed executions, schedule timers.
   */
  async start(): Promise<void> {
    this.store = new SchedulerStore({ dataDir: this.config.dataDir });
    this.running = true;

    // Load persisted jobs
    const persisted = this.store.loadAll();
    for (const job of persisted) {
      this.jobs.set(job.id, job);

      // Detect missed executions
      if (job.enabled && job.lastExecutionAt) {
        this.detectMissedExecutions(job);
      }

      // Schedule next execution for enabled jobs
      if (job.enabled) {
        this.scheduleNext(job);
      }
    }
  }

  /**
   * Stop the scheduler: clear all pending timers.
   */
  async stop(): Promise<void> {
    this.running = false;

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Close the store
    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  /**
   * Register a new scheduled job.
   * Validates cron expression (or delayMs for one-shot), name (non-empty, ≤128 chars, unique).
   */
  register(input: ScheduledJobInput): ScheduledJob {
    const isOneShot = input.oneShot === true;

    // Validate: must have either cronExpression or delayMs (for one-shot)
    if (isOneShot) {
      if (input.delayMs === undefined || input.delayMs === null) {
        throw new ValidationError('delayMs', 'One-shot jobs require a delayMs value.');
      }
      if (input.delayMs < 0) {
        throw new ValidationError('delayMs', 'delayMs must be a non-negative number.');
      }
    } else {
      // Regular cron job: cronExpression is required
      if (!input.cronExpression) {
        throw new ValidationError('cronExpression', 'cronExpression is required for recurring jobs.');
      }
      if (!isValidCron(input.cronExpression)) {
        throw new ValidationError('cronExpression', 'Invalid cron expression. Must be a valid 5-field cron format.');
      }
    }

    // Validate name: non-empty
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('name', 'Job name must not be empty.');
    }

    // Validate name: max 128 characters
    if (input.name.length > 128) {
      throw new ValidationError('name', 'Job name must not exceed 128 characters.');
    }

    // Validate name: unique
    for (const existing of this.jobs.values()) {
      if (existing.name === input.name) {
        throw new ValidationError('name', `A job with name '${input.name}' already exists.`);
      }
    }

    const timestamp = now();
    let nextExecution: Date;

    if (isOneShot) {
      // One-shot: compute single execution time from Date.now() + delayMs
      nextExecution = new Date(Date.now() + input.delayMs!);
    } else {
      nextExecution = getNextCronDate(input.cronExpression!);
    }

    const job: ScheduledJob = {
      id: generateId('job'),
      name: input.name,
      cronExpression: input.cronExpression || '',
      delayMs: isOneShot ? input.delayMs : undefined,
      oneShot: isOneShot || undefined,
      target: input.target,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      nextExecutionAt: nextExecution.toISOString(),
    };

    // Persist
    if (this.store) {
      this.store.save(job);
    }

    // Track in memory
    this.jobs.set(job.id, job);

    // Schedule timer if running
    if (this.running) {
      this.scheduleNext(job);
    }

    return job;
  }

  /**
   * Remove a scheduled job by ID.
   */
  remove(jobId: NexusId): void {
    // Cancel pending timer
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }

    // Remove from store
    if (this.store) {
      this.store.remove(jobId);
    }

    // Remove from memory
    this.jobs.delete(jobId);
    this.runningJobs.delete(jobId);
  }

  /**
   * List all registered jobs.
   */
  list(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get a specific job by ID.
   */
  get(jobId: NexusId): ScheduledJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Schedule the next execution for a job using setTimeout.
   */
  private scheduleNext(job: ScheduledJob): void {
    // Clear existing timer for this job
    const existingTimer = this.timers.get(job.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    let nextDate: Date;
    if (job.oneShot && job.nextExecutionAt) {
      // One-shot jobs: use the pre-computed next execution time
      nextDate = new Date(job.nextExecutionAt);
    } else if (job.cronExpression) {
      nextDate = getNextCronDate(job.cronExpression);
      // Update job's nextExecutionAt
      job.nextExecutionAt = nextDate.toISOString();
    } else {
      // No schedule available
      return;
    }

    const delay = Math.max(0, nextDate.getTime() - Date.now());

    const timer = setTimeout(() => {
      this.timers.delete(job.id);
      this.executeJob(job);
    }, delay);

    this.timers.set(job.id, timer);
  }

  /**
   * Execute a scheduled job.
   * Handles overlap detection, timeout enforcement, and event emission.
   * One-shot jobs are auto-disabled after execution.
   */
  private async executeJob(job: ScheduledJob): Promise<void> {
    if (!this.running) return;

    // Overlap detection: skip if still running
    if (this.runningJobs.has(job.id)) {
      this.emitEvent('scheduler.job.skipped', job.id, {
        reason: 'overlap',
        jobName: job.name,
      });
      // Schedule next execution even if skipped (only for recurring jobs)
      if (!job.oneShot) {
        this.scheduleNext(job);
      }
      return;
    }

    this.runningJobs.add(job.id);
    const executionStart = now();

    // Set up abort controller for timeout enforcement
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, this.maxExecutionTimeout);

    try {
      // Execute the job target
      if (this.config.execute) {
        await this.config.execute(job.target, controller.signal);
      }

      clearTimeout(timeoutTimer);

      // Track execution
      const executionEnd = now();
      job.lastExecutionAt = executionEnd;
      job.updatedAt = executionEnd;

      // Auto-disable one-shot jobs after firing
      if (job.oneShot) {
        job.enabled = false;
        job.nextExecutionAt = undefined;
        if (this.store) {
          this.store.save(job);
        }
      } else {
        // Persist execution timestamp for recurring jobs
        if (this.store) {
          const nextDate = getNextCronDate(job.cronExpression);
          this.store.updateExecution(job.id, executionEnd, nextDate.toISOString());
        }
      }

      // Emit completed event
      this.emitEvent('scheduler.job.completed', job.id, {
        jobName: job.name,
        executionStart,
        executionEnd,
        oneShot: job.oneShot || false,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutTimer);

      const executionEnd = now();
      job.lastExecutionAt = executionEnd;
      job.updatedAt = executionEnd;

      // One-shot jobs are still disabled after failure (they don't retry)
      if (job.oneShot) {
        job.enabled = false;
        job.nextExecutionAt = undefined;
        if (this.store) {
          this.store.save(job);
        }
      } else {
        // Persist execution timestamp for recurring jobs
        if (this.store) {
          const nextDate = getNextCronDate(job.cronExpression);
          this.store.updateExecution(job.id, executionEnd, nextDate.toISOString());
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = controller.signal.aborted;

      // Emit failed event
      this.emitEvent('scheduler.job.failed', job.id, {
        jobName: job.name,
        executionStart,
        executionEnd,
        error: errorMessage,
        timeout: isTimeout,
        oneShot: job.oneShot || false,
      });
    } finally {
      this.runningJobs.delete(job.id);

      // Schedule next execution only for recurring jobs
      if (this.running && this.jobs.has(job.id) && !job.oneShot) {
        this.scheduleNext(job);
      }
    }
  }

  /**
   * Detect missed executions on startup.
   * Compares lastExecutionAt against cron expression to find missed ticks.
   * Skips one-shot jobs as they don't reschedule.
   */
  private detectMissedExecutions(job: ScheduledJob): void {
    if (!job.lastExecutionAt) return;
    if (job.oneShot) return; // One-shot jobs don't have missed executions
    if (!job.cronExpression) return;

    const lastExecution = new Date(job.lastExecutionAt);
    const currentTime = new Date();

    // Get the next expected execution after the last one
    let nextExpected = getNextCronDate(job.cronExpression, lastExecution);

    // Emit missed event for each missed occurrence
    while (nextExpected < currentTime) {
      this.emitEvent('scheduler.job.missed', job.id, {
        jobName: job.name,
        missedAt: nextExpected.toISOString(),
        lastExecutionAt: job.lastExecutionAt,
      });

      // Get next occurrence after this one
      nextExpected = getNextCronDate(job.cronExpression, nextExpected);
    }
  }

  /**
   * Emit a NexusEvent through the EventBus.
   */
  private emitEvent(
    eventType: string,
    jobId: NexusId,
    data: Record<string, unknown>,
  ): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('failed') || eventType.includes('missed') ? 'warn' : 'info',
      timestamp: now(),
      subjectId: jobId,
      subjectType: 'scheduled_job',
      actorId: 'scheduler',
      correlationId: jobId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'scheduler',
        environment: 'runtime',
      },
    };

    this.eventBus.publish(event);
  }
}
