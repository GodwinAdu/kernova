/**
 * Kernova Sandbox Manager
 *
 * Provides isolated execution environments for tool calls:
 * - Filesystem path restrictions (workspace-only)
 * - Tool allow/deny per sandbox context
 * - Execution timeout enforcement
 * - Working directory isolation
 *
 * Inspired by OpenClaw's sandbox system.
 */

import type { NexusId, NexusEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';
import path from 'node:path';

export interface SandboxPolicy {
  /** Allowed filesystem paths (glob patterns) */
  allowedPaths?: string[];
  /** Denied filesystem paths */
  deniedPaths?: string[];
  /** Allowed tool names */
  allowedTools?: string[];
  /** Denied tool names */
  deniedTools?: string[];
  /** Maximum execution time per tool call (ms) */
  timeoutMs?: number;
  /** Whether network access is allowed */
  allowNetwork?: boolean;
  /** Whether filesystem writes are allowed */
  allowWrite?: boolean;
}

export interface SandboxConfig {
  /** Base workspace directory */
  workspaceDir: string;
  /** Default policy for all sandbox contexts */
  defaultPolicy?: SandboxPolicy;
}

interface SandboxContext {
  id: NexusId;
  agentId: NexusId;
  workspaceDir: string;
  policy: SandboxPolicy;
  createdAt: string;
}

const DEFAULT_POLICY: SandboxPolicy = {
  allowedPaths: ['.'],
  deniedPaths: ['..', '/etc', '/usr', 'C:\\Windows', 'C:\\Program Files'],
  timeoutMs: 30_000,
  allowNetwork: true,
  allowWrite: true,
};

export class SandboxManager {
  private readonly eventBus: EventBus;
  private readonly config: SandboxConfig;
  private contexts: Map<NexusId, SandboxContext> = new Map();

  constructor(eventBus: EventBus, config: SandboxConfig) {
    this.eventBus = eventBus;
    this.config = config;
  }

  /**
   * Create a sandbox context for an agent execution.
   */
  createContext(agentId: NexusId, policy?: Partial<SandboxPolicy>): SandboxContext {
    const ctx: SandboxContext = {
      id: generateId('sandbox'),
      agentId,
      workspaceDir: this.config.workspaceDir,
      policy: { ...DEFAULT_POLICY, ...this.config.defaultPolicy, ...policy },
      createdAt: now(),
    };
    this.contexts.set(ctx.id, ctx);
    return ctx;
  }

  /**
   * Check if a file path access is allowed within a sandbox.
   */
  isPathAllowed(contextId: NexusId, filePath: string): boolean {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return false;

    const resolved = path.resolve(ctx.workspaceDir, filePath);
    const relative = path.relative(ctx.workspaceDir, resolved);

    // Deny path traversal outside workspace
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      this.emitEvent('sandbox.path.denied', contextId, { path: filePath, reason: 'traversal' });
      return false;
    }

    // Check denied paths
    if (ctx.policy.deniedPaths) {
      for (const denied of ctx.policy.deniedPaths) {
        if (resolved.startsWith(denied) || filePath.startsWith(denied)) {
          this.emitEvent('sandbox.path.denied', contextId, { path: filePath, reason: 'denied_path' });
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a tool call is allowed within a sandbox.
   */
  isToolAllowed(contextId: NexusId, toolName: string): boolean {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return false;

    // Deny list takes precedence
    if (ctx.policy.deniedTools?.includes(toolName)) {
      this.emitEvent('sandbox.tool.denied', contextId, { tool: toolName });
      return false;
    }

    // If allow list is set, must be in it
    if (ctx.policy.allowedTools && ctx.policy.allowedTools.length > 0) {
      if (!ctx.policy.allowedTools.includes(toolName)) {
        this.emitEvent('sandbox.tool.denied', contextId, { tool: toolName, reason: 'not_allowed' });
        return false;
      }
    }

    return true;
  }

  /**
   * Check if writes are allowed.
   */
  isWriteAllowed(contextId: NexusId): boolean {
    const ctx = this.contexts.get(contextId);
    return ctx?.policy.allowWrite ?? false;
  }

  /**
   * Check if network access is allowed.
   */
  isNetworkAllowed(contextId: NexusId): boolean {
    const ctx = this.contexts.get(contextId);
    return ctx?.policy.allowNetwork ?? true;
  }

  /**
   * Get the timeout for tool execution in a sandbox.
   */
  getTimeout(contextId: NexusId): number {
    const ctx = this.contexts.get(contextId);
    return ctx?.policy.timeoutMs ?? 30_000;
  }

  /**
   * Destroy a sandbox context.
   */
  destroy(contextId: NexusId): void {
    this.contexts.delete(contextId);
  }

  /**
   * List active sandbox contexts.
   */
  list(): SandboxContext[] {
    return Array.from(this.contexts.values());
  }

  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('denied') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'sandbox',
      actorId: 'sandbox-manager',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'sandbox-manager', environment: 'runtime' },
    });
  }
}
