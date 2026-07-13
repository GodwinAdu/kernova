/**
 * DurableExecutor — Executes multi-step tasks with checkpointing.
 *
 * Features:
 * - Automatic checkpointing at each step
 * - Recovery after crash (resumes from last checkpoint)
 * - Human-in-the-loop approval gates
 * - Step-level retries with backoff
 * - Timeout enforcement per step
 *
 * Usage:
 *   const executor = new DurableExecutor(store, eventBus);
 *
 *   await executor.run('process-invoice', [
 *     { name: 'extract', execute: async (ctx) => { ... } },
 *     { name: 'validate', requiresApproval: true, execute: async (ctx) => { ... } },
 *     { name: 'save', execute: async (ctx) => { ... } },
 *   ]);
 */

import { CheckpointStore } from './checkpoint-store.js';
import type { DurableStep, DurableOptions, DurableTaskState, Checkpoint, StepContext } from './types.js';

export class DurableExecutor {
  private store: CheckpointStore;
  private eventBus: any;

  constructor(store: CheckpointStore, eventBus?: any) {
    this.store = store;
    this.eventBus = eventBus;
  }

  /**
   * Execute a durable task (multi-step with checkpoints).
   * If the task was previously started, resumes from the last checkpoint.
   */
  async run(
    name: string,
    steps: DurableStep[],
    options: DurableOptions = {}
  ): Promise<unknown> {
    const taskId = options.taskId || `durable_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const maxRetries = options.maxRetries || 3;
    const stepTimeout = options.stepTimeout || 60000;

    // Check if this task already exists (recovery scenario)
    let task = this.store.getTask(taskId);
    let startStep = 0;
    let previousResults: Record<string, unknown> = {};

    if (task && (task.status === 'running' || task.status === 'paused' || task.status === 'awaiting_approval')) {
      // Resume from last checkpoint
      const lastCheckpoint = this.store.getLatestCheckpoint(taskId);
      if (lastCheckpoint) {
        startStep = lastCheckpoint.step + 1;
        previousResults = lastCheckpoint.state;
        console.log(`[Durable] Resuming task "${name}" from step ${startStep}/${steps.length}`);
      }
    } else {
      // New task
      task = {
        taskId,
        name,
        currentStep: 0,
        totalSteps: steps.length,
        status: 'running',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checkpoints: [],
      };
      this.store.saveTask(task);
    }

    this.emit('durable.started', { taskId, name, totalSteps: steps.length, resumeFrom: startStep });

    // Execute steps
    for (let i = startStep; i < steps.length; i++) {
      const step = steps[i];
      task.currentStep = i;
      task.status = 'running';
      task.updatedAt = new Date().toISOString();
      this.store.saveTask(task);

      // Human-in-the-loop approval gate
      if (step.requiresApproval) {
        task.status = 'awaiting_approval';
        this.store.saveTask(task);
        this.emit('durable.approval_needed', { taskId, step: i, stepName: step.name, description: step.description });

        if (options.onApprovalNeeded) {
          const approved = await options.onApprovalNeeded(step);
          if (!approved) {
            task.status = 'paused';
            task.updatedAt = new Date().toISOString();
            this.store.saveTask(task);
            this.emit('durable.paused', { taskId, step: i, reason: 'approval_denied' });
            return { status: 'paused', reason: 'Approval denied at step: ' + step.name, lastStep: i };
          }
        }

        task.status = 'running';
        this.store.saveTask(task);
        this.emit('durable.approval_granted', { taskId, step: i, stepName: step.name });
      }

      // Execute step with retries
      let result: unknown;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const context: StepContext = {
            previous: { ...previousResults },
            checkpoint: async (state) => {
              const cp: Checkpoint = {
                id: `cp_${taskId}_${i}_${Date.now()}`,
                taskId,
                step: i,
                state: { ...previousResults, ...state },
                status: 'running',
                createdAt: new Date().toISOString(),
              };
              this.store.saveCheckpoint(cp);
            },
            log: (message) => {
              this.emit('durable.log', { taskId, step: i, stepName: step.name, message });
            },
            getState: () => task!,
          };

          // Execute with timeout
          result = await Promise.race([
            step.execute(context),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${stepTimeout}ms`)), stepTimeout)
            ),
          ]);

          lastError = null;
          break; // Success — exit retry loop
        } catch (err) {
          lastError = err as Error;
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff
            this.emit('durable.retry', { taskId, step: i, attempt: attempt + 1, error: lastError.message, delay });
            await sleep(delay);
          }
        }
      }

      if (lastError) {
        // Step failed after all retries
        task.status = 'failed';
        task.error = `Step "${step.name}" failed: ${lastError.message}`;
        task.updatedAt = new Date().toISOString();
        this.store.saveTask(task);
        this.emit('durable.failed', { taskId, step: i, stepName: step.name, error: lastError.message });
        throw lastError;
      }

      // Save checkpoint after successful step
      previousResults[step.name] = result;
      const checkpoint: Checkpoint = {
        id: `cp_${taskId}_${i}_${Date.now()}`,
        taskId,
        step: i,
        state: { ...previousResults },
        status: 'running',
        createdAt: new Date().toISOString(),
      };
      this.store.saveCheckpoint(checkpoint);
      this.emit('durable.step_completed', { taskId, step: i, stepName: step.name, totalSteps: steps.length });
    }

    // All steps completed
    task.status = 'completed';
    task.result = previousResults;
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
    this.emit('durable.completed', { taskId, name, result: previousResults });

    return previousResults;
  }

  /**
   * Resume a paused task (after approval is granted externally).
   */
  async resume(taskId: string, steps: DurableStep[], options: DurableOptions = {}): Promise<unknown> {
    return this.run(steps[0]?.name || 'resumed', steps, { ...options, taskId });
  }

  /**
   * Get all incomplete tasks (for recovery on restart).
   */
  getIncompleteTasks(): DurableTaskState[] {
    return this.store.getIncompleteTasks();
  }

  /**
   * Get task state.
   */
  getTask(taskId: string): DurableTaskState | null {
    return this.store.getTask(taskId);
  }

  private emit(eventType: string, data: Record<string, unknown>): void {
    if (this.eventBus?.publish) {
      this.eventBus.publish({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        eventType,
        category: 'durable',
        severity: 'info',
        timestamp: new Date().toISOString(),
        subjectId: data.taskId as string,
        subjectType: 'durable_task',
        actorId: 'system',
        correlationId: data.taskId as string,
        data,
        metadata: { schemaVersion: '1.0.0', source: 'durable-executor', environment: 'production' },
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
