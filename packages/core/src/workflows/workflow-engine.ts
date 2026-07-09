/**
 * Kernova Workflow Engine
 * 
 * Pillar: Coordination — "How do multiple systems work together?"
 * 
 * Executes multi-step plans with:
 * - Sequential and parallel steps
 * - Conditional branching
 * - Human-in-the-loop approval gates
 * - Compensation (undo on failure)
 * - Long-running process support
 * - Timeout and retry policies
 */

import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
  StepResult,
  NexusId,
  Intent,
  ComputedContext,
} from '@kernova/types';
import { EventBus } from '../events/event-bus.js';
import { AgentRegistry } from '../agents/agent-registry.js';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import { generateId, now } from '../utils.js';

export interface WorkflowEngineConfig {
  /** Maximum concurrent workflows */
  maxConcurrent?: number;

  /** Default step timeout in ms */
  defaultStepTimeoutMs?: number;
}

/** Approval callback for human-in-the-loop */
export type ApprovalHandler = (
  workflowId: NexusId,
  stepId: string,
  description: string,
) => Promise<{ approved: boolean; reason?: string }>;

export class WorkflowEngine {
  private definitions: Map<NexusId, WorkflowDefinition> = new Map();
  private instances: Map<NexusId, WorkflowInstance> = new Map();
  private pendingApprovals: Map<string, (result: { approved: boolean; reason?: string }) => void> = new Map();
  private eventBus: EventBus;
  private agents: AgentRegistry;
  private plugins: PluginRegistry;
  private config: Required<WorkflowEngineConfig>;
  private approvalHandler: ApprovalHandler | null = null;

  constructor(
    eventBus: EventBus,
    agents: AgentRegistry,
    plugins: PluginRegistry,
    config: WorkflowEngineConfig = {},
  ) {
    this.eventBus = eventBus;
    this.agents = agents;
    this.plugins = plugins;
    this.config = {
      maxConcurrent: config.maxConcurrent || 10,
      defaultStepTimeoutMs: config.defaultStepTimeoutMs || 60000,
    };
  }

  /**
   * Register a workflow definition
   */
  define(definition: WorkflowDefinition): void {
    this.definitions.set(definition.id, definition);

    this.emitEvent('workflow.defined', {
      workflowId: definition.id,
      name: definition.name,
      steps: definition.steps.length,
    });
  }

  /**
   * Start a workflow execution
   */
  async execute(
    definitionId: NexusId,
    input: Record<string, unknown> = {},
    intentId?: NexusId,
  ): Promise<WorkflowInstance> {
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      throw new Error(`Workflow definition "${definitionId}" not found.`);
    }

    // Enforce max concurrent workflows
    const runningCount = Array.from(this.instances.values())
      .filter(i => i.workflowStatus === 'running').length;
    if (runningCount >= this.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent workflows (${this.config.maxConcurrent}) reached. Wait for running workflows to complete.`
      );
    }

    // Create instance
    const instance: WorkflowInstance = {
      id: generateId('wf'),
      type: 'workflow_instance',
      version: '1.0.0',
      owner: 'system',
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      metadata: {},
      definitionId,
      intentId: intentId || generateId('intent'),
      workflowStatus: 'running',
      input,
      currentStep: 0,
      stepResults: [],
      startedAt: now(),
    };

    this.instances.set(instance.id, instance);

    this.emitEvent('workflow.started', {
      workflowId: instance.id,
      definitionId,
      name: definition.name,
    });

    // Execute steps
    try {
      await this.executeSteps(instance, definition.steps);

      instance.workflowStatus = 'completed';
      instance.completedAt = now();
      instance.updatedAt = now();

      this.emitEvent('workflow.completed', {
        workflowId: instance.id,
        durationMs: Date.now() - new Date(instance.startedAt!).getTime(),
        stepsExecuted: instance.stepResults.length,
      });
    } catch (error) {
      instance.workflowStatus = 'failed';
      instance.updatedAt = now();
      instance.error = {
        code: 'EXECUTION_FAILED',
        message: (error as Error).message,
      };

      this.emitEvent('workflow.failed', {
        workflowId: instance.id,
        error: (error as Error).message,
      });

      // Run compensation for completed steps (reverse order)
      await this.compensate(instance, definition.steps);
    }

    return instance;
  }

  /**
   * Set the approval handler for human-in-the-loop steps.
   * This is called when a workflow reaches an approval gate.
   */
  onApproval(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  /**
   * Approve or reject a pending workflow step externally.
   * Use this when the approval comes from a UI, API, or external system.
   */
  resolveApproval(workflowId: NexusId, stepId: string, approved: boolean, reason?: string): void {
    const key = `${workflowId}:${stepId}`;
    const resolver = this.pendingApprovals.get(key);
    if (resolver) {
      resolver({ approved, reason });
      this.pendingApprovals.delete(key);
    }
  }

  /**
   * Get all workflows waiting for approval
   */
  getPendingApprovals(): Array<{ workflowId: NexusId; stepId: string; stepName: string }> {
    return Array.from(this.instances.values())
      .filter(i => i.workflowStatus === 'waiting_approval')
      .map(i => {
        const def = this.definitions.get(i.definitionId);
        const step = def?.steps[i.currentStep];
        return { workflowId: i.id, stepId: step?.id || '', stepName: step?.name || '' };
      });
  }

  /**
   * Get a workflow instance
   */
  getInstance(id: NexusId): WorkflowInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * List all workflow definitions
   */
  listDefinitions(): WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * List running instances
   */
  listRunning(): WorkflowInstance[] {
    return Array.from(this.instances.values()).filter(i => i.workflowStatus === 'running');
  }

  /**
   * Execute a sequence of steps
   */
  private async executeSteps(instance: WorkflowInstance, steps: WorkflowStep[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      instance.currentStep = i;
      instance.updatedAt = now();

      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, instance)) {
        instance.stepResults.push({
          stepId: step.id,
          status: 'skipped',
          durationMs: 0,
        });
        continue;
      }

      // Execute step
      const result = await this.executeStep(instance, step);
      instance.stepResults.push(result);

      // Handle failure
      if (result.status === 'failed') {
        switch (step.onFailure) {
          case 'stop':
            throw new Error(`Step "${step.name}" failed: ${result.error}`);
          case 'continue':
            continue;
          case 'retry':
            // Simple retry (once)
            const retryResult = await this.executeStep(instance, step);
            instance.stepResults[instance.stepResults.length - 1] = retryResult;
            if (retryResult.status === 'failed') {
              throw new Error(`Step "${step.name}" failed after retry: ${retryResult.error}`);
            }
            break;
          case 'compensate':
            throw new Error(`Step "${step.name}" failed, triggering compensation: ${result.error}`);
        }
      }
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(instance: WorkflowInstance, step: WorkflowStep): Promise<StepResult> {
    const startTime = Date.now();
    const timeoutMs = step.timeoutMs || this.config.defaultStepTimeoutMs;

    this.emitEvent('workflow.step.started', {
      workflowId: instance.id,
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
    });

    try {
      let output: unknown;

      // Wrap execution with timeout
      const executionPromise = (async () => {
        switch (step.type) {
          case 'agent':
            return await this.executeAgentStep(instance, step);
          case 'tool':
            return await this.executeToolStep(instance, step);
          case 'approval':
            return await this.executeApprovalStep(instance, step);
          case 'parallel':
            return await this.executeParallelStep(instance, step);
          case 'condition':
            return await this.executeConditionStep(instance, step);
          case 'wait':
            return await this.executeWaitStep(step);
          case 'transform':
            return this.executeTransformStep(instance, step);
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }
      })();

      // Apply timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      output = await Promise.race([executionPromise, timeoutPromise]);

      const durationMs = Date.now() - startTime;

      this.emitEvent('workflow.step.completed', {
        workflowId: instance.id,
        stepId: step.id,
        durationMs,
      });

      return { stepId: step.id, status: 'completed', output, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.emitEvent('workflow.step.failed', {
        workflowId: instance.id,
        stepId: step.id,
        error: (error as Error).message,
      });

      return { stepId: step.id, status: 'failed', error: (error as Error).message, durationMs };
    }
  }

  private async executeAgentStep(instance: WorkflowInstance, step: WorkflowStep): Promise<unknown> {
    const agentId = step.config.agentId;
    if (!agentId) throw new Error('Agent step requires agentId in config');

    // Find the agent in the registry
    const agents = this.agents.list();
    const agent = agents.find(a => a.id === agentId || a.name === agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found. Available: ${agents.map(a => a.name).join(', ')}`);
    }

    // Select an instance and execute via the registry
    const intent: Intent = {
      id: generateId('intent'),
      type: 'intent' as const,
      version: '1.0.0',
      owner: instance.owner,
      status: 'active' as const,
      createdAt: now(),
      updatedAt: now(),
      metadata: {},
      intentType: 'action' as const,
      goal: (step.config.input as Record<string, unknown>)?.goal as string || step.name,
      priority: 'medium' as const,
      intentStatus: 'pending' as const,
      confidence: 0,
      source: { actorId: instance.id, channel: 'workflow' as const },
      temporal: {},
      dependencies: [],
      childIds: [],
      constraints: [],
      approvals: [],
      risk: { level: 'low' as const, factors: [], reversible: true },
    };

    const context: ComputedContext = {
      intentId: intent.id,
      memories: [],
      user: { userId: instance.owner, role: 'system', preferences: {} },
      permissions: ['*'],
      policies: [],
      knowledge: [],
      estimatedTokens: 0,
      computedAt: now(),
    };

    const agentInstance = await this.agents.selectAgent(intent, context);
    if (!agentInstance) {
      throw new Error(`No available instance for agent "${agentId}"`);
    }

    const result = await this.agents.execute(agentInstance, intent, context);
    return result;
  }

  private async executeToolStep(instance: WorkflowInstance, step: WorkflowStep): Promise<unknown> {
    const toolId = step.config.toolId;
    if (!toolId) throw new Error('Tool step requires toolId in config');

    const params = step.config.input || {};
    return this.plugins.executeTool(toolId, params as Record<string, unknown>);
  }

  private async executeApprovalStep(instance: WorkflowInstance, step: WorkflowStep): Promise<unknown> {
    instance.workflowStatus = 'waiting_approval';
    instance.updatedAt = now();

    this.emitEvent('workflow.approval.requested', {
      workflowId: instance.id,
      stepId: step.id,
      stepName: step.name,
    });

    let result: { approved: boolean; reason?: string };

    if (this.approvalHandler) {
      // Use programmatic handler
      result = await this.approvalHandler(instance.id, step.id, step.name);
    } else {
      // Wait for external resolution via resolveApproval()
      result = await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
        const key = `${instance.id}:${step.id}`;
        this.pendingApprovals.set(key, resolve);
      });
    }

    instance.workflowStatus = 'running';
    instance.updatedAt = now();

    if (!result.approved) {
      throw new Error(`Approval denied: ${result.reason || 'No reason given'}`);
    }

    return { approved: true, reason: result.reason };
  }

  private async executeParallelStep(instance: WorkflowInstance, step: WorkflowStep): Promise<unknown> {
    const parallelSteps = step.config.parallel || [];
    if (parallelSteps.length === 0) return [];

    const results = await Promise.all(
      parallelSteps.map(s => this.executeStep(instance, s))
    );

    // Check if any failed
    const failures = results.filter(r => r.status === 'failed');
    if (failures.length > 0) {
      throw new Error(`${failures.length} parallel steps failed: ${failures.map(f => f.error).join('; ')}`);
    }

    return results.map(r => r.output);
  }

  private async executeConditionStep(instance: WorkflowInstance, step: WorkflowStep): Promise<unknown> {
    const branches = step.config.branches || [];

    for (const branch of branches) {
      if (this.evaluateCondition(branch.condition, instance)) {
        await this.executeSteps(instance, branch.steps);
        return { branch: branch.condition, executed: true };
      }
    }

    return { branch: 'none', executed: false };
  }

  private async executeWaitStep(step: WorkflowStep): Promise<unknown> {
    const durationMs = step.config.waitFor?.durationMs || 0;
    if (durationMs > 0) {
      await new Promise(resolve => setTimeout(resolve, durationMs));
    }
    return { waited: durationMs };
  }

  private executeTransformStep(instance: WorkflowInstance, step: WorkflowStep): unknown {
    // Simple data transformation — just passes input through
    return step.config.input || {};
  }

  /**
   * Run compensation steps for failed workflow (reverse order)
   */
  private async compensate(instance: WorkflowInstance, steps: WorkflowStep[]): Promise<void> {
    const completedSteps = instance.stepResults
      .filter(r => r.status === 'completed')
      .reverse();

    for (const result of completedSteps) {
      const step = steps.find(s => s.id === result.stepId);
      if (step?.compensation) {
        try {
          await this.executeStep(instance, {
            id: `${step.id}_compensate`,
            name: `Undo: ${step.name}`,
            type: step.compensation.toolId ? 'tool' : 'agent',
            config: step.compensation,
            onFailure: 'continue',
          });
        } catch {
          // Best-effort compensation
        }
      }
    }

    instance.workflowStatus = 'compensating';
    instance.updatedAt = now();
  }

  /**
   * Evaluate a condition expression (simple truthy check for now)
   */
  private evaluateCondition(condition: string, instance: WorkflowInstance): boolean {
    // Simple evaluation: check if last step output is truthy
    // In production, use a proper expression engine
    if (condition === 'true') return true;
    if (condition === 'false') return false;

    // Check step results
    const lastResult = instance.stepResults[instance.stepResults.length - 1];
    if (condition === 'lastStep.success') {
      return lastResult?.status === 'completed';
    }

    return true; // Default: execute
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'workflow' as any,
      severity: 'info',
      timestamp: now(),
      subjectId: (data.workflowId as string) || 'workflow-engine',
      subjectType: 'workflow',
      actorId: 'workflow-engine',
      correlationId: (data.workflowId as string) || generateId('cor'),
      data,
      metadata: { schemaVersion: '1.0.0', source: 'workflow-engine', environment: 'development' },
    });
  }
}
