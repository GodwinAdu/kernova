/**
 * Kernova Workflow System
 * 
 * Workflows are the multi-step execution plans for complex intents.
 * They support:
 * - Sequential and parallel execution
 * - Human-in-the-loop approval
 * - Conditional branching
 * - Compensation (undo on failure)
 * - Long-running processes
 */

import type {
  KernovaObject,
  KernovaId,
  Timestamp,
} from './base.js';

/** Workflow execution status */
export type WorkflowStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'compensating';

/** Task execution status */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/**
 * Workflow Definition
 * The blueprint for a workflow
 */
export interface WorkflowDefinition extends KernovaObject {
  type: 'workflow_definition';

  /** Workflow name */
  name: string;

  /** Description */
  description: string;

  /** The steps in this workflow */
  steps: WorkflowStep[];

  /** Trigger conditions */
  triggers?: WorkflowTrigger[];

  /** Input schema */
  inputSchema?: Record<string, unknown>;

  /** Output schema */
  outputSchema?: Record<string, unknown>;

  /** Timeout for the entire workflow */
  timeoutMs?: number;

  /** Retry policy */
  retryPolicy?: RetryPolicy;
}

/**
 * Workflow Instance
 * A running instance of a workflow
 */
export interface WorkflowInstance extends KernovaObject {
  type: 'workflow_instance';

  /** Which definition this is running */
  definitionId: KernovaId;

  /** The intent that triggered this workflow */
  intentId: KernovaId;

  /** Current status */
  workflowStatus: WorkflowStatus;

  /** Input data */
  input: Record<string, unknown>;

  /** Output data (when completed) */
  output?: Record<string, unknown>;

  /** Current step index */
  currentStep: number;

  /** Step execution results */
  stepResults: StepResult[];

  /** When execution started */
  startedAt?: Timestamp;

  /** When execution completed */
  completedAt?: Timestamp;

  /** Error information */
  error?: WorkflowError;
}

export interface WorkflowStep {
  /** Step identifier */
  id: string;

  /** Step name */
  name: string;

  /** What type of step */
  type: 'agent' | 'tool' | 'condition' | 'approval' | 'parallel' | 'wait' | 'transform';

  /** Configuration for this step */
  config: StepConfig;

  /** Conditions for executing this step */
  condition?: string;

  /** What to do if this step fails */
  onFailure: 'stop' | 'continue' | 'compensate' | 'retry';

  /** Compensation action (undo) */
  compensation?: StepConfig;

  /** Timeout for this step */
  timeoutMs?: number;
}

export interface StepConfig {
  /** For agent steps: which agent */
  agentId?: KernovaId;

  /** For tool steps: which tool */
  toolId?: string;

  /** Input mapping */
  input?: Record<string, unknown>;

  /** For parallel steps: sub-steps to run concurrently */
  parallel?: WorkflowStep[];

  /** For condition steps: branches */
  branches?: ConditionalBranch[];

  /** For approval steps: who approves */
  approvers?: KernovaId[];

  /** For wait steps: what to wait for */
  waitFor?: WaitCondition;
}

export interface ConditionalBranch {
  /** Condition expression */
  condition: string;

  /** Steps to execute if condition is true */
  steps: WorkflowStep[];
}

export interface WaitCondition {
  /** Wait for an event */
  event?: string;

  /** Wait for a duration */
  durationMs?: number;

  /** Wait for a specific time */
  until?: Timestamp;
}

export interface StepResult {
  /** Step ID */
  stepId: string;

  /** Execution status */
  status: TaskStatus;

  /** Output data */
  output?: unknown;

  /** Duration */
  durationMs: number;

  /** Error if failed */
  error?: string;
}

export interface WorkflowTrigger {
  /** Trigger type */
  type: 'event' | 'schedule' | 'intent' | 'manual';

  /** Configuration */
  config: Record<string, unknown>;
}

export interface RetryPolicy {
  /** Maximum retry attempts */
  maxAttempts: number;

  /** Backoff strategy */
  backoff: 'fixed' | 'exponential' | 'linear';

  /** Initial delay in ms */
  initialDelayMs: number;

  /** Maximum delay in ms */
  maxDelayMs: number;
}

export interface WorkflowError {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Which step failed */
  stepId?: string;

  /** Stack trace */
  stack?: string;
}
