/**
 * Nexus Agent Coordinator
 * 
 * Pillar 6: Coordination — "How do multiple systems work together?"
 * 
 * Enables agents to delegate tasks to other agents, creating
 * sub-intents that are tracked in the intent graph.
 * 
 * Patterns:
 * - Delegate: Ask a specific named agent to handle a task
 * - Ask: Let the kernel select the best agent for a task
 * - Broadcast: Send to all agents, take first response
 */

import type {
  Intent,
  IntentResult,
  ComputedContext,
  NexusId,
} from '@kernova/types';
import type { AgentRegistry } from './agent-registry.js';
import { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface CoordinatorConfig {
  /** Maximum delegation depth (prevents infinite recursion) */
  maxDepth?: number;

  /** Timeout for delegated tasks in ms */
  delegationTimeoutMs?: number;
}

export interface DelegationResult {
  /** Whether the delegation succeeded */
  success: boolean;

  /** The response from the delegated agent */
  response: string;

  /** Which agent handled it */
  agentName: string;

  /** Duration in ms */
  durationMs: number;

  /** The sub-intent that was created */
  intentId: NexusId;
}

export class AgentCoordinator {
  private agents: AgentRegistry;
  private eventBus: EventBus;
  private maxDepth: number;
  private delegationTimeoutMs: number;

  constructor(agents: AgentRegistry, eventBus: EventBus, config: CoordinatorConfig = {}) {
    this.agents = agents;
    this.eventBus = eventBus;
    this.maxDepth = config.maxDepth || 5;
    this.delegationTimeoutMs = config.delegationTimeoutMs || 30000;
  }

  /**
   * Delegate a task to a specific named agent.
   * Creates a sub-intent tracked as a child of the parent intent.
   */
  async delegate(
    targetAgentName: string,
    goal: string,
    parentIntentId: NexusId,
    currentDepth: number,
    context: ComputedContext,
  ): Promise<DelegationResult> {
    // Check depth limit
    if (currentDepth >= this.maxDepth) {
      return {
        success: false,
        response: `Delegation depth limit (${this.maxDepth}) reached. Cannot delegate further.`,
        agentName: targetAgentName,
        durationMs: 0,
        intentId: '',
      };
    }

    const startTime = Date.now();

    // Find the target agent
    const allAgents = this.agents.list();
    const targetDef = allAgents.find(a => a.name === targetAgentName);

    if (!targetDef) {
      return {
        success: false,
        response: `Agent "${targetAgentName}" not found. Available: ${allAgents.map(a => a.name).join(', ')}`,
        agentName: targetAgentName,
        durationMs: 0,
        intentId: '',
      };
    }

    // Create sub-intent
    const subIntent: Intent = {
      id: generateId('intent'),
      type: 'intent',
      version: '1.0.0',
      owner: context.user.userId,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      metadata: { delegatedBy: parentIntentId, depth: currentDepth + 1 },
      intentType: 'action',
      goal,
      priority: 'medium',
      intentStatus: 'pending',
      confidence: 0,
      source: { actorId: parentIntentId, channel: 'agent' },
      temporal: {},
      dependencies: [parentIntentId],
      parentId: parentIntentId,
      childIds: [],
      constraints: [],
      approvals: [],
      risk: { level: 'low', factors: [], reversible: true },
    };

    this.emitEvent('agent.delegation.started', {
      parentIntentId,
      subIntentId: subIntent.id,
      targetAgent: targetAgentName,
      goal,
      depth: currentDepth + 1,
    });

    try {
      // Get or create instance for the specific target agent
      const instance = await this.agents.selectAgentByName(targetAgentName, subIntent, context);
      if (!instance) {
        throw new Error(`No available instance for agent "${targetAgentName}"`);
      }

      // Execute with timeout
      const resultPromise = this.agents.execute(instance, subIntent, context);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Delegation timed out after ${this.delegationTimeoutMs}ms`)), this.delegationTimeoutMs)
      );

      const result = await Promise.race([resultPromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;

      this.emitEvent('agent.delegation.completed', {
        parentIntentId,
        subIntentId: subIntent.id,
        targetAgent: targetAgentName,
        success: result.success,
        durationMs,
      });

      return {
        success: result.success,
        response: result.summary,
        agentName: targetAgentName,
        durationMs,
        intentId: subIntent.id,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.emitEvent('agent.delegation.failed', {
        parentIntentId,
        subIntentId: subIntent.id,
        targetAgent: targetAgentName,
        error: (error as Error).message,
      });

      return {
        success: false,
        response: `Delegation failed: ${(error as Error).message}`,
        agentName: targetAgentName,
        durationMs,
        intentId: subIntent.id,
      };
    }
  }

  /**
   * Ask any agent — kernel selects the best one.
   */
  async ask(
    goal: string,
    parentIntentId: NexusId,
    currentDepth: number,
    context: ComputedContext,
  ): Promise<DelegationResult> {
    // Find the first available agent (in production: capability matching)
    const allAgents = this.agents.list();
    if (allAgents.length === 0) {
      return {
        success: false,
        response: 'No agents registered.',
        agentName: 'none',
        durationMs: 0,
        intentId: '',
      };
    }

    // Use first agent (in production: smart selection)
    return this.delegate(allAgents[0].name, goal, parentIntentId, currentDepth, context);
  }

  /**
   * Broadcast to all agents, return first successful response.
   */
  async broadcast(
    goal: string,
    parentIntentId: NexusId,
    currentDepth: number,
    context: ComputedContext,
  ): Promise<DelegationResult> {
    const allAgents = this.agents.list();

    // Try each agent until one succeeds
    for (const agentDef of allAgents) {
      const result = await this.delegate(agentDef.name, goal, parentIntentId, currentDepth, context);
      if (result.success) return result;
    }

    return {
      success: false,
      response: 'No agent was able to handle this request.',
      agentName: 'none',
      durationMs: 0,
      intentId: '',
    };
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'agent',
      severity: 'info',
      timestamp: now(),
      subjectId: (data.subIntentId as string) || 'coordinator',
      subjectType: 'agent',
      actorId: (data.parentIntentId as string) || 'coordinator',
      correlationId: (data.parentIntentId as string) || generateId('cor'),
      data,
      metadata: { schemaVersion: '1.0.0', source: 'agent-coordinator', environment: 'development' },
    });
  }
}
