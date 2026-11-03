/**
 * Kernova Dead-Letter Queue Logic
 *
 * Manages tasks that have exhausted all retry attempts.
 * Provides mechanisms to inspect failed tasks, understand failures,
 * and replay them back into the main queue.
 */

import type {
  TaskItem,
  DeadLetterItem,
  DeadLetterAttempt,
  DeadLetterFilter,
  KernovaId,
} from '@kernova/types';
import { generateId, now } from '../utils.js';
import type { QueueStore } from './queue-store.js';

// ─── DeadLetterManager Interface ─────────────────────────────

export interface DeadLetterManager {
  /**
   * Move a failed task to the dead-letter queue.
   * Creates a dead-letter record with the task's payload, error details,
   * and all execution attempts.
   */
  addToDeadLetter(
    taskItem: TaskItem,
    error: Error,
    attempts: DeadLetterAttempt[],
  ): DeadLetterItem;

  /**
   * Replay a dead-lettered task back into the main queue.
   * Creates a new pending task item with reset attempt count and
   * marks the dead-letter record as "replayed".
   */
  replayFromDeadLetter(deadLetterId: KernovaId, store: QueueStore): TaskItem;

  /**
   * Query dead-letter items with optional filters.
   */
  queryDeadLetters(store: QueueStore, filter?: DeadLetterFilter): DeadLetterItem[];
}

// ─── Implementation ──────────────────────────────────────────

/**
 * Create a DeadLetterManager instance.
 */
export function createDeadLetterManager(): DeadLetterManager {
  return {
    addToDeadLetter(
      taskItem: TaskItem,
      error: Error,
      attempts: DeadLetterAttempt[],
    ): DeadLetterItem {
      const deadLetterItem: DeadLetterItem = {
        id: generateId('dl'),
        taskId: taskItem.id,
        payload: taskItem.payload,
        handler: taskItem.handler,
        errorMessage: error.message,
        errorType: error.name || 'Error',
        attempts,
        deadLetteredAt: now(),
        status: 'active',
      };

      return deadLetterItem;
    },

    replayFromDeadLetter(deadLetterId: KernovaId, store: QueueStore): TaskItem {
      const deadLetterItem = store.getDeadLetterById(deadLetterId);

      if (!deadLetterItem) {
        throw new Error(`Dead-letter item not found: ${deadLetterId}`);
      }

      if (deadLetterItem.status === 'replayed') {
        throw new Error(`Dead-letter item already replayed: ${deadLetterId}`);
      }

      // Create a new task item from the dead-lettered data
      const timestamp = now();
      const newTask: TaskItem = {
        id: generateId('task'),
        priority: 'medium', // Default priority for replayed items
        status: 'pending',
        payload: deadLetterItem.payload,
        handler: deadLetterItem.handler,
        attempt: 0,
        maxRetries: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      // Enqueue the new task
      store.enqueue(newTask);

      // Mark the dead-letter item as replayed
      store.markReplayed(deadLetterId);

      return newTask;
    },

    queryDeadLetters(store: QueueStore, filter?: DeadLetterFilter): DeadLetterItem[] {
      return store.getDeadLetters(filter);
    },
  };
}
