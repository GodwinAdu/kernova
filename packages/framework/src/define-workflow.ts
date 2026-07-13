/**
 * defineWorkflow — Durable multi-step workflow with checkpointing.
 *
 * Usage:
 *   // workflows/process-invoice.ts
 *   import { defineWorkflow } from '@kernova/framework';
 *
 *   export default defineWorkflow({
 *     name: 'process-invoice',
 *     description: 'Extract, validate, and save invoice data',
 *     steps: [
 *       { name: 'extract', execute: async (ctx) => { ... } },
 *       { name: 'validate', requiresApproval: true, execute: async (ctx) => { ... } },
 *       { name: 'save', execute: async (ctx) => { ... } },
 *       { name: 'notify', execute: async (ctx) => { ... } },
 *     ],
 *     maxRetries: 3,
 *     stepTimeout: 60000,
 *   });
 */

export interface WorkflowStep {
  /** Step name */
  name: string;
  /** Description (shown in approval requests) */
  description?: string;
  /** Whether this step requires human approval before executing */
  requiresApproval?: boolean;
  /** Execute the step */
  execute: (context: WorkflowStepContext) => Promise<unknown>;
}

export interface WorkflowStepContext {
  /** Results from all previous steps */
  previous: Record<string, unknown>;
  /** Save intermediate state (manual checkpoint) */
  checkpoint: (state: Record<string, unknown>) => Promise<void>;
  /** Log a message */
  log: (message: string) => void;
}

export interface WorkflowDefinition {
  /** Workflow name */
  name: string;
  /** Description */
  description?: string;
  /** Steps to execute in order */
  steps: WorkflowStep[];
  /** Max retries per step on failure (default: 3) */
  maxRetries?: number;
  /** Timeout per step in ms (default: 60000) */
  stepTimeout?: number;
  /** Trigger: when to run this workflow automatically */
  trigger?: string | { event: string; filter?: Record<string, unknown> };
}

/**
 * Define a durable workflow.
 */
export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  if (!definition.name) {
    throw new Error('defineWorkflow: "name" is required');
  }
  if (!definition.steps || definition.steps.length === 0) {
    throw new Error('defineWorkflow: at least one step is required');
  }

  return {
    maxRetries: 3,
    stepTimeout: 60000,
    ...definition,
  };
}
