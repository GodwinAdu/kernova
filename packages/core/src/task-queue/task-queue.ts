/**
 * Kernova Task Queue
 *
 * Prioritized async task execution with:
 * - Semaphore-based concurrency control (1–50, default 5)
 * - Exponential backoff retry: min(baseDelay × 2^(attempt-1), maxDelay)
 * - Task timeout via AbortController + setTimeout
 * - Graceful shutdown: wait up to shutdownTimeout, then force-cancel
 * - Dead-letter queue for exhausted tasks
 * - EventBus integration for lifecycle events
 */

import type {
  TaskItem,
  TaskItemInput,
  QueueStats,
  DeadLetterItem,
  DeadLetterAttempt,
  DeadLetterFilter,
  NexusId,
  NexusEvent,
  Priority,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { QueueStore, priorityToNumber } from './queue-store.js';
import { createDeadLetterManager, type DeadLetterManager } from './dead-letter.js';
import { generateId, now } from '../utils.js';
import { ValidationError, QueueFullError } from '../errors.js';

// ─── Types ───────────────────────────────────────────────────

export type TaskHandler = (payload: unknown, signal: AbortSignal) => Promise<unknown>;

export interface TaskQueueConfig {
  dataDir: string;
  concurrency?: number;        // default: 5, range: 1–50
  maxRetries?: number;         // default: 3
  baseDelay?: number;          // default: 1000 ms
  maxDelay?: number;           // default: 30000 ms
  taskTimeout?: number;        // default: 30000 ms
  maxQueueDepth?: number;      // default: 1000
  shutdownTimeout?: number;    // default: 10000 ms
}

// ─── Valid Priorities ────────────────────────────────────────

const VALID_PRIORITIES: Set<string> = new Set(['critical', 'high', 'medium', 'low']);

// ─── TaskQueue Class ─────────────────────────────────────────

export class TaskQueue {
  private readonly eventBus: EventBus;
  private readonly store: QueueStore;
  private readonly deadLetterManager: DeadLetterManager;

  // Configuration (with defaults)
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly taskTimeout: number;
  private readonly maxQueueDepth: number;
  private readonly shutdownTimeout: number;

  // Handler registry
  private readonly handlers: Map<string, TaskHandler> = new Map();

  // Concurrency tracking (semaphore)
  private readonly inFlight: Set<NexusId> = new Set();

  // Timeout control per task
  private readonly abortControllers: Map<NexusId, AbortController> = new Map();

  // Processing loop state
  private running = false;
  private stopping = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(eventBus: EventBus, config: TaskQueueConfig) {
    this.eventBus = eventBus;

    // Validate and clamp concurrency
    const concurrency = config.concurrency ?? 5;
    if (concurrency < 1 || concurrency > 50) {
      throw new ValidationError('concurrency', 'must be between 1 and 50');
    }
    this.concurrency = concurrency;

    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelay = config.baseDelay ?? 1000;
    this.maxDelay = config.maxDelay ?? 30000;
    this.taskTimeout = config.taskTimeout ?? 30000;
    this.maxQueueDepth = config.maxQueueDepth ?? 1000;
    this.shutdownTimeout = config.shutdownTimeout ?? 10000;

    // Initialize store and dead-letter manager
    this.store = new QueueStore({ dataDir: config.dataDir });
    this.deadLetterManager = createDeadLetterManager();
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  async start(): Promise<void> {
    this.running = true;
    this.stopping = false;
    this.schedulePoll();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;

    // Stop polling
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for in-flight tasks up to shutdownTimeout
    if (this.inFlight.size > 0) {
      await this.waitForInFlight();
    }

    // Force-cancel any remaining in-flight tasks
    for (const taskId of this.inFlight) {
      const controller = this.abortControllers.get(taskId);
      if (controller) {
        controller.abort();
      }
    }

    // Close the store
    this.store.close();
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Register a handler for a given handler name.
   */
  registerHandler(name: string, handler: TaskHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Enqueue a task item with validation.
   */
  enqueue(input: TaskItemInput): TaskItem {
    if (this.stopping) {
      throw new ValidationError('queue', 'queue is shutting down');
    }

    // Validate priority
    const priority: Priority = input.priority ?? 'medium';
    if (!VALID_PRIORITIES.has(priority)) {
      throw new ValidationError('priority', `invalid priority value: ${priority}. Must be one of: critical, high, medium, low`);
    }

    // Check queue depth
    const stats = this.store.getStats();
    if (stats.pending >= this.maxQueueDepth) {
      throw new QueueFullError(this.maxQueueDepth);
    }

    // Create the task item
    const timestamp = now();
    const taskItem: TaskItem = {
      id: generateId('task'),
      priority,
      status: 'pending',
      payload: input.payload,
      handler: input.handler,
      attempt: 0,
      maxRetries: input.maxRetries ?? this.maxRetries,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Persist to store
    this.store.enqueue(taskItem);

    // Emit event
    this.emitEvent('queue.task.enqueued', taskItem.id, {
      taskId: taskItem.id,
      priority: taskItem.priority,
      handler: taskItem.handler,
    });

    // Kick the processing loop
    this.schedulePoll();

    return taskItem;
  }

  /**
   * Get queue statistics.
   */
  stats(): QueueStats {
    return this.store.getStats();
  }

  /**
   * Query dead-lettered items.
   */
  deadLetters(filter?: DeadLetterFilter): DeadLetterItem[] {
    return this.deadLetterManager.queryDeadLetters(this.store, filter);
  }

  /**
   * Replay a dead-lettered item back into the queue.
   */
  replay(deadLetterId: NexusId): TaskItem {
    return this.deadLetterManager.replayFromDeadLetter(deadLetterId, this.store);
  }

  // ─── Processing Loop ─────────────────────────────────────────

  private schedulePoll(): void {
    if (!this.running || this.stopping) return;

    // Avoid stacking poll timers
    if (this.pollTimer !== null) return;

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.processNext();
    }, 10);
  }

  private processNext(): void {
    if (!this.running || this.stopping) return;

    // Fill available slots
    while (this.inFlight.size < this.concurrency) {
      const task = this.store.dequeue();
      if (!task) break;

      // Mark as running
      this.store.updateStatus(task.id, 'running', task.attempt);
      this.inFlight.add(task.id);

      // Execute asynchronously
      this.executeTask(task);
    }

    // Schedule next poll if there might be more work
    if (this.running && !this.stopping) {
      this.pollTimer = setTimeout(() => {
        this.pollTimer = null;
        this.processNext();
      }, 100);
    }
  }

  private async executeTask(task: TaskItem): Promise<void> {
    const handler = this.handlers.get(task.handler);

    if (!handler) {
      // No handler registered — treat as failure
      const error = new Error(`No handler registered for: ${task.handler}`);
      this.handleTaskFailure(task, error);
      return;
    }

    // Set up abort controller for timeout
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);

    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, this.taskTimeout);

    try {
      await handler(task.payload, controller.signal);

      // Success
      clearTimeout(timeoutHandle);
      this.abortControllers.delete(task.id);
      this.inFlight.delete(task.id);

      this.store.updateStatus(task.id, 'completed', task.attempt);
      this.emitEvent('queue.task.completed', task.id, {
        taskId: task.id,
        handler: task.handler,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.abortControllers.delete(task.id);
      this.inFlight.delete(task.id);

      const error = err instanceof Error ? err : new Error(String(err));
      this.handleTaskFailure(task, error);
    }

    // Kick the processing loop to fill the now-free slot
    this.schedulePoll();
  }

  private handleTaskFailure(task: TaskItem, error: Error): void {
    const nextAttempt = task.attempt + 1;

    if (nextAttempt >= task.maxRetries) {
      // Exhausted all retries — move to dead-letter
      this.store.updateStatus(task.id, 'dead-lettered', nextAttempt);

      const attempts: DeadLetterAttempt[] = [];
      for (let i = 1; i <= nextAttempt; i++) {
        attempts.push({
          attempt: i,
          executedAt: now(),
          errorMessage: i === nextAttempt ? error.message : 'previous attempt failed',
        });
      }

      const deadLetterItem = this.deadLetterManager.addToDeadLetter(task, error, attempts);
      this.store.addToDeadLetter(deadLetterItem);

      this.emitEvent('queue.task.dead-lettered', task.id, {
        taskId: task.id,
        handler: task.handler,
        errorMessage: error.message,
        errorType: error.name || 'Error',
        attempts: nextAttempt,
      });
    } else {
      // Retry with exponential backoff
      const delay = Math.min(this.baseDelay * Math.pow(2, nextAttempt - 1), this.maxDelay);
      const scheduledAt = new Date(Date.now() + delay).toISOString();

      this.store.updateStatus(task.id, 'pending', nextAttempt, scheduledAt);
    }
  }

  // ─── Graceful Shutdown ───────────────────────────────────────

  private waitForInFlight(): Promise<void> {
    return new Promise<void>((resolve) => {
      const start = Date.now();

      const check = () => {
        if (this.inFlight.size === 0) {
          resolve();
          return;
        }

        if (Date.now() - start >= this.shutdownTimeout) {
          resolve();
          return;
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  // ─── Event Emission ──────────────────────────────────────────

  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'task',
      actorId: 'task-queue',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'task-queue',
        environment: 'runtime',
      },
    };

    this.eventBus.publish(event);
  }
}
