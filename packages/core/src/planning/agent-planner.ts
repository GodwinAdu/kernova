/**
 * Kernova Agent Planner
 *
 * Implements the Plan-and-Execute pattern for complex goals:
 * 1. Decompose goal into ordered steps via LLM
 * 2. Execute each step sequentially (or parallel if deps allow)
 * 3. Re-plan adaptively on failure
 *
 * Inspired by OpenClaw's runtime-plan system, but generalized for
 * developer use: any agent can plan, any goal can be decomposed.
 */

import type {
  KernovaId,
  KernovaEvent,
  ExecutionPlan,
  PlanStep,
  PlanStatus,
  PlanStepStatus,
  PlanStrategy,
  PlannerConfig,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { ModelRouter } from '../models/model-router.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';

export interface AgentPlannerConfig {
  maxSteps: number;
  strategy: PlanStrategy;
  adaptiveReplanning: boolean;
  maxReplanAttempts: number;
  modelPurpose?: string;
}

const DEFAULT_CONFIG: AgentPlannerConfig = {
  maxSteps: 10,
  strategy: 'sequential',
  adaptiveReplanning: true,
  maxReplanAttempts: 2,
};

export type StepExecutor = (step: PlanStep, plan: ExecutionPlan) => Promise<unknown>;

export class AgentPlanner {
  private readonly eventBus: EventBus;
  private readonly modelRouter: ModelRouter;
  private readonly config: AgentPlannerConfig;
  private activePlans: Map<KernovaId, ExecutionPlan> = new Map();

  constructor(eventBus: EventBus, modelRouter: ModelRouter, config?: Partial<PlannerConfig>) {
    this.eventBus = eventBus;
    this.modelRouter = modelRouter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create an execution plan for a goal.
   * Uses the LLM to decompose the goal into steps.
   */
  async plan(goal: string, context?: string): Promise<ExecutionPlan> {
    if (!goal || goal.trim().length === 0) {
      throw new ValidationError('goal', 'Goal must not be empty');
    }

    const planId = generateId('plan');
    const timestamp = now();

    const executionPlan: ExecutionPlan = {
      id: planId,
      goal,
      steps: [],
      status: 'planning',
      strategy: this.config.strategy,
      createdAt: timestamp,
      updatedAt: timestamp,
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
    };

    this.activePlans.set(planId, executionPlan);
    this.emitEvent('plan.created', planId, { goal, strategy: this.config.strategy });

    try {
      const steps = await this.decompose(goal, context);
      executionPlan.steps = steps;
      executionPlan.totalSteps = steps.length;
      executionPlan.updatedAt = now();

      this.emitEvent('plan.decomposed', planId, {
        goal,
        stepCount: steps.length,
        steps: steps.map(s => s.description),
      });

      return executionPlan;
    } catch (error) {
      executionPlan.status = 'failed';
      executionPlan.updatedAt = now();
      this.emitEvent('plan.failed', planId, {
        goal,
        error: error instanceof Error ? error.message : String(error),
        phase: 'planning',
      });
      throw error;
    }
  }

  /**
   * Execute a plan step-by-step using the provided executor function.
   * The executor receives each step and returns a result or throws.
   * Enforces maxSteps limit: if total executed steps reaches the limit,
   * execution stops and returns a partial result.
   */
  async execute(plan: ExecutionPlan, executor: StepExecutor): Promise<ExecutionPlan> {
    plan.status = 'executing';
    plan.updatedAt = now();
    this.emitEvent('plan.executing', plan.id, { goal: plan.goal });

    let replanAttempts = 0;
    let executedStepCount = 0;

    for (let i = 0; i < plan.steps.length; i++) {
      // Enforce maxSteps limit during execution
      if (executedStepCount >= this.config.maxSteps) {
        plan.status = 'completed';
        plan.updatedAt = now();
        this.emitEvent('plan.maxStepsReached', plan.id, {
          goal: plan.goal,
          maxSteps: this.config.maxSteps,
          executedSteps: executedStepCount,
          remainingSteps: plan.steps.length - i,
        });
        return plan;
      }

      const step = plan.steps[i];

      // Check dependencies
      if (!this.areDependenciesMet(step, plan)) {
        step.status = 'skipped';
        this.emitEvent('plan.step.skipped', plan.id, {
          stepId: step.id,
          reason: 'unmet dependencies',
        });
        continue;
      }

      step.status = 'executing';
      step.startedAt = now();
      executedStepCount++;
      this.emitEvent('plan.step.started', plan.id, {
        stepId: step.id,
        index: step.index,
        description: step.description,
      });

      try {
        const result = await executor(step, plan);
        step.status = 'completed';
        step.result = result;
        step.completedAt = now();
        plan.completedSteps++;
        plan.updatedAt = now();

        this.emitEvent('plan.step.completed', plan.id, {
          stepId: step.id,
          index: step.index,
        });
      } catch (error) {
        step.status = 'failed';
        step.error = error instanceof Error ? error.message : String(error);
        step.completedAt = now();
        plan.failedSteps++;
        plan.updatedAt = now();

        this.emitEvent('plan.step.failed', plan.id, {
          stepId: step.id,
          index: step.index,
          error: step.error,
        });

        // Adaptive replanning
        if (this.config.adaptiveReplanning && replanAttempts < this.config.maxReplanAttempts) {
          replanAttempts++;
          const replanned = await this.replan(plan, step);
          if (replanned) {
            // Replace remaining steps with replanned ones
            plan.steps = [
              ...plan.steps.slice(0, i + 1),
              ...replanned,
            ];
            plan.totalSteps = plan.steps.length;
            plan.updatedAt = now();

            this.emitEvent('plan.replanned', plan.id, {
              failedStep: step.description,
              newStepCount: replanned.length,
              attempt: replanAttempts,
            });
            continue;
          }
        }

        // No replanning or replanning failed: mark plan as failed
        plan.status = 'failed';
        plan.updatedAt = now();
        this.emitEvent('plan.failed', plan.id, {
          goal: plan.goal,
          error: step.error,
          phase: 'execution',
          failedStepIndex: step.index,
        });
        return plan;
      }
    }

    plan.status = 'completed';
    plan.completedAt = now();
    plan.updatedAt = now();
    this.emitEvent('plan.completed', plan.id, {
      goal: plan.goal,
      totalSteps: plan.totalSteps,
      completedSteps: plan.completedSteps,
    });

    return plan;
  }

  /**
   * Cancel an active plan.
   */
  cancel(planId: KernovaId): void {
    const plan = this.activePlans.get(planId);
    if (!plan) return;

    plan.status = 'cancelled';
    plan.updatedAt = now();

    // Mark pending steps as skipped
    for (const step of plan.steps) {
      if (step.status === 'pending' || step.status === 'ready') {
        step.status = 'skipped';
      }
    }

    this.emitEvent('plan.cancelled', planId, { goal: plan.goal });
    this.activePlans.delete(planId);
  }

  /**
   * Get an active plan by ID.
   */
  getPlan(planId: KernovaId): ExecutionPlan | undefined {
    return this.activePlans.get(planId);
  }

  /**
   * List all active plans.
   */
  listPlans(): ExecutionPlan[] {
    return Array.from(this.activePlans.values());
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Decompose a goal into steps using the LLM.
   */
  private async decompose(goal: string, context?: string): Promise<PlanStep[]> {
    const contextBlock = context ? `\n\nContext:\n${context}` : '';

    const prompt = `You are a task planner. Decompose the following goal into clear, actionable steps.

Goal: ${goal}${contextBlock}

Rules:
- Maximum ${this.config.maxSteps} steps
- Each step should be independently executable
- Steps should be ordered logically
- Each step description should be specific and actionable

Respond with a JSON array of step descriptions:
[
  "Step 1 description",
  "Step 2 description",
  ...
]

Respond ONLY with the JSON array, no other text.`;

    const response = await this.modelRouter.complete({
      messages: [{ role: 'user', content: prompt }],
      model: '',
      temperature: 0.3,
    }, this.config.modelPurpose as never);

    const steps = this.parseSteps(response.content);
    return steps;
  }

  /**
   * Re-plan remaining steps after a failure.
   */
  private async replan(plan: ExecutionPlan, failedStep: PlanStep): Promise<PlanStep[] | null> {
    const completedSteps = plan.steps
      .filter(s => s.status === 'completed')
      .map(s => `✓ ${s.description}`)
      .join('\n');

    const prompt = `A plan step failed. Please suggest alternative steps to achieve the goal.

Original goal: ${plan.goal}

Completed steps:
${completedSteps || '(none)'}

Failed step: ${failedStep.description}
Error: ${failedStep.error}

Suggest alternative steps to continue achieving the goal, working around the failure.
Respond with a JSON array of step descriptions:
["step 1", "step 2", ...]

Respond ONLY with the JSON array.`;

    try {
      const response = await this.modelRouter.complete({
        messages: [{ role: 'user', content: prompt }],
        model: '',
        temperature: 0.4,
      }, this.config.modelPurpose as never);

      return this.parseSteps(response.content);
    } catch {
      return null;
    }
  }

  /**
   * Parse LLM response into PlanStep objects.
   */
  private parseSteps(content: string): PlanStep[] {
    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse plan: no JSON array found in response');
    }

    let descriptions: string[];
    try {
      descriptions = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse plan: invalid JSON in response');
    }

    if (!Array.isArray(descriptions) || descriptions.length === 0) {
      throw new Error('Failed to parse plan: empty or invalid step array');
    }

    // Enforce max steps
    if (descriptions.length > this.config.maxSteps) {
      descriptions = descriptions.slice(0, this.config.maxSteps);
    }

    return descriptions.map((desc: string, index: number) => ({
      id: generateId('step'),
      index,
      description: String(desc),
      dependencies: index > 0 && this.config.strategy === 'sequential'
        ? [descriptions[index - 1] ? `step_${index - 1}` : '']
        : [],
      status: 'pending' as PlanStepStatus,
    }));
  }

  /**
   * Check if all dependencies of a step have been completed.
   */
  private areDependenciesMet(step: PlanStep, plan: ExecutionPlan): boolean {
    if (step.dependencies.length === 0) return true;

    // For sequential strategy, just check that all previous steps completed
    if (this.config.strategy === 'sequential') {
      const prevSteps = plan.steps.filter((s: PlanStep) => s.index < step.index);
      return prevSteps.every((s: PlanStep) => s.status === 'completed' || s.status === 'skipped');
    }

    // For parallel/adaptive, check explicit dependencies
    return step.dependencies.every((depId: string) => {
      const dep = plan.steps.find((s: PlanStep) => s.id === depId);
      return dep && (dep.status === 'completed' || dep.status === 'skipped');
    });
  }

  /**
   * Emit a planning event.
   */
  private emitEvent(eventType: string, planId: KernovaId, data: Record<string, unknown>): void {
    const event: KernovaEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('failed') ? 'warn' : 'info',
      timestamp: now(),
      subjectId: planId,
      subjectType: 'execution_plan',
      actorId: 'agent-planner',
      correlationId: planId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'agent-planner',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
