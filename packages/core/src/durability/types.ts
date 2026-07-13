/**
 * Types for Durable Execution.
 */

export interface Checkpoint {
  id: string;
  taskId: string;
  step: number;
  state: Record<string, unknown>;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'awaiting_approval';
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface DurableTaskState {
  taskId: string;
  name: string;
  currentStep: number;
  totalSteps: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'awaiting_approval';
  checkpoints: Checkpoint[];
  result?: unknown;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export interface DurableOptions {
  /** Unique task ID (for recovery) */
  taskId?: string;
  /** Checkpoint after every N steps */
  checkpointInterval?: number;
  /** Max retries on failure */
  maxRetries?: number;
  /** Timeout for each step (ms) */
  stepTimeout?: number;
  /** Called when approval is needed */
  onApprovalNeeded?: (step: DurableStep) => Promise<boolean>;
}

export interface DurableStep {
  name: string;
  description?: string;
  requiresApproval?: boolean;
  execute: (context: StepContext) => Promise<unknown>;
}

export interface StepContext {
  /** Previous step results */
  previous: Record<string, unknown>;
  /** Store intermediate state */
  checkpoint: (state: Record<string, unknown>) => Promise<void>;
  /** Log a message */
  log: (message: string) => void;
  /** Get the current task state */
  getState: () => DurableTaskState;
}
