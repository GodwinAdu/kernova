/**
 * defineTask — Background task for the priority queue.
 *
 * Tasks are persisted, retried on failure, and processed async.
 *
 * Usage:
 *   // tasks/send-email.ts
 *   import { defineTask } from '@kernova/framework';
 *
 *   export default defineTask({
 *     name: 'send-email',
 *     description: 'Send transactional emails',
 *     maxRetries: 3,
 *     execute: async (payload, ctx) => {
 *       await emailService.send({
 *         to: payload.to,
 *         subject: payload.subject,
 *         body: payload.body,
 *       });
 *       return { sent: true };
 *     },
 *   });
 *
 *   // Enqueue from an agent tool:
 *   await enqueue('send-email', { to: 'user@example.com', subject: 'Hello' });
 */

export interface TaskDefinition {
  /** Task handler name (used to route tasks) */
  name: string;
  /** Description */
  description?: string;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Priority: critical, high, medium, low */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** Execute the task */
  execute: (payload: any, context: TaskContext) => Promise<unknown>;
}

export interface TaskContext {
  /** Task ID */
  taskId: string;
  /** Current attempt number (starts at 1) */
  attempt: number;
  /** Log a message */
  log: (message: string) => void;
}

/**
 * Define a background task handler.
 */
export function defineTask(definition: TaskDefinition): TaskDefinition {
  if (!definition.name) {
    throw new Error('defineTask: "name" is required');
  }
  if (!definition.execute) {
    throw new Error('defineTask: "execute" function is required');
  }

  return {
    maxRetries: 3,
    priority: 'medium',
    ...definition,
  };
}
