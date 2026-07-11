/**
 * Kernova Sub-Agent Manager
 *
 * Enables parent agents to spawn child agents for delegation:
 * - Isolated or forked context modes
 * - Depth limiting to prevent infinite recursion
 * - Per-parent concurrency limits
 * - Timeout enforcement
 * - Result announcement back to parent
 *
 * Inspired by OpenClaw's subagent-spawn system.
 */

import type {
  NexusId,
  NexusEvent,
  SubAgentDef,
  SubAgentSpawnInput,
  SubAgentStatus,
  SubAgentManagerConfig,
  Intent,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';

export interface SubAgentManagerOptions {
  maxDepth: number;
  maxChildrenPerAgent: number;
  defaultTimeoutMs: number;
}

const DEFAULT_OPTIONS: SubAgentManagerOptions = {
  maxDepth: 3,
  maxChildrenPerAgent: 5,
  defaultTimeoutMs: 60_000,
};

type SpawnExecutor = (def: SubAgentDef) => Promise<unknown>;

export class SubAgentManager {
  private readonly eventBus: EventBus;
  private readonly config: SubAgentManagerOptions;
  private executor?: SpawnExecutor;

  /** Active sub-agents by ID */
  private agents: Map<NexusId, SubAgentDef> = new Map();

  /** Parent → children mapping */
  private parentChildren: Map<NexusId, Set<NexusId>> = new Map();

  /** Timeout handles */
  private timeouts: Map<NexusId, ReturnType<typeof setTimeout>> = new Map();

  constructor(eventBus: EventBus, config?: Partial<SubAgentManagerConfig>) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_OPTIONS, ...config };
  }

  /**
   * Set the executor function that actually runs sub-agent tasks.
   * Called by the kernel to wire intent submission.
   */
  setExecutor(executor: SpawnExecutor): void {
    this.executor = executor;
  }

  /**
   * Spawn a sub-agent from a parent context.
   */
  async spawn(parentId: NexusId, input: SubAgentSpawnInput): Promise<SubAgentDef> {
    // Validate depth
    const parentDepth = this.getDepth(parentId);
    if (parentDepth >= this.config.maxDepth) {
      throw new ValidationError('depth', `Maximum sub-agent depth (${this.config.maxDepth}) exceeded`);
    }

    // Validate children count
    const siblings = this.parentChildren.get(parentId);
    if (siblings && siblings.size >= this.config.maxChildrenPerAgent) {
      throw new ValidationError('children', `Maximum children per agent (${this.config.maxChildrenPerAgent}) exceeded`);
    }

    const def: SubAgentDef = {
      id: generateId('sub'),
      parentId,
      name: input.agentName,
      agentName: input.agentName,
      goal: input.goal,
      mode: input.mode ?? 'run',
      contextMode: input.contextMode ?? 'isolated',
      status: 'pending',
      depth: parentDepth + 1,
      createdAt: now(),
      timeoutMs: input.timeoutMs ?? this.config.defaultTimeoutMs,
    };

    // Register
    this.agents.set(def.id, def);
    if (!this.parentChildren.has(parentId)) {
      this.parentChildren.set(parentId, new Set());
    }
    this.parentChildren.get(parentId)!.add(def.id);

    this.emitEvent('subagent.spawned', def.id, {
      parentId,
      agentName: def.agentName,
      goal: def.goal,
      depth: def.depth,
      mode: def.mode,
    });

    // Set timeout
    if (def.timeoutMs && def.timeoutMs > 0) {
      const timer = setTimeout(() => {
        this.handleTimeout(def.id);
      }, def.timeoutMs);
      this.timeouts.set(def.id, timer);
    }

    // Execute asynchronously
    this.executeSubAgent(def);

    return def;
  }

  /**
   * Cancel a running sub-agent.
   */
  cancel(subAgentId: NexusId): boolean {
    const def = this.agents.get(subAgentId);
    if (!def) return false;
    if (def.status !== 'pending' && def.status !== 'running') return false;

    def.status = 'cancelled';
    def.completedAt = now();
    this.clearTimeout(subAgentId);

    this.emitEvent('subagent.cancelled', subAgentId, {
      parentId: def.parentId,
      agentName: def.agentName,
    });

    return true;
  }

  /**
   * Get a sub-agent definition by ID.
   */
  get(subAgentId: NexusId): SubAgentDef | undefined {
    return this.agents.get(subAgentId);
  }

  /**
   * List children of a parent agent.
   */
  listChildren(parentId: NexusId): SubAgentDef[] {
    const childIds = this.parentChildren.get(parentId);
    if (!childIds) return [];
    return Array.from(childIds)
      .map(id => this.agents.get(id))
      .filter((d): d is SubAgentDef => d !== undefined);
  }

  /**
   * List all active (non-terminal) sub-agents.
   */
  listActive(): SubAgentDef[] {
    return Array.from(this.agents.values()).filter(
      d => d.status === 'pending' || d.status === 'running',
    );
  }

  /**
   * Get the depth of an agent in the spawn tree.
   */
  getDepth(agentId: NexusId): number {
    const def = this.agents.get(agentId);
    return def?.depth ?? 0;
  }

  // ─── Private ───────────────────────────────────────────────

  private async executeSubAgent(def: SubAgentDef): Promise<void> {
    def.status = 'running';

    try {
      if (!this.executor) {
        throw new Error('No executor registered. Call setExecutor() first.');
      }

      const result = await this.executor(def);
      def.status = 'completed';
      def.result = result;
      def.completedAt = now();
      this.clearTimeout(def.id);

      this.emitEvent('subagent.completed', def.id, {
        parentId: def.parentId,
        agentName: def.agentName,
        durationMs: Date.now() - new Date(def.createdAt).getTime(),
      });
    } catch (error) {
      if ((def.status as string) === 'cancelled' || (def.status as string) === 'timeout') return;

      def.status = 'failed';
      def.error = error instanceof Error ? error.message : String(error);
      def.completedAt = now();
      this.clearTimeout(def.id);

      this.emitEvent('subagent.failed', def.id, {
        parentId: def.parentId,
        agentName: def.agentName,
        error: def.error,
      });
    }
  }

  private handleTimeout(subAgentId: NexusId): void {
    const def = this.agents.get(subAgentId);
    if (!def || def.status !== 'running') return;

    def.status = 'timeout';
    def.completedAt = now();
    this.timeouts.delete(subAgentId);

    this.emitEvent('subagent.timeout', subAgentId, {
      parentId: def.parentId,
      agentName: def.agentName,
      timeoutMs: def.timeoutMs,
    });
  }

  private clearTimeout(subAgentId: NexusId): void {
    const timer = this.timeouts.get(subAgentId);
    if (timer) {
      clearTimeout(timer);
      this.timeouts.delete(subAgentId);
    }
  }

  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('failed') || eventType.includes('timeout') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'subagent',
      actorId: 'subagent-manager',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'subagent-manager',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
