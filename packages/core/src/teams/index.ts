/**
 * Multi-Agent Team System
 *
 * Enables teams of specialized agents to collaborate on complex tasks.
 *
 * Core components:
 * - TeamRegistry: stores team definitions
 * - TeamExecutor: orchestrates multi-agent task execution
 * - MessageBus: inter-agent communication
 * - SharedWorkspace: shared state between agents
 *
 * Strategies:
 * - sequential: A → B → C in fixed order
 * - hierarchical: Lead decomposes, assigns to members, reviews results
 * - collaborative: Agents freely delegate to each other
 * - round-robin: Tasks distributed evenly
 * - broadcast: All agents work, best result wins
 * - pipeline: Output of one feeds into next
 *
 * Usage:
 *   import { TeamRegistry, TeamExecutor, MessageBus, SharedWorkspace } from '@kernova/core';
 *
 *   const registry = new TeamRegistry();
 *   registry.register({
 *     id: 'dev-team',
 *     name: 'Development Team',
 *     strategy: 'hierarchical',
 *     members: [
 *       { agent: 'senior-dev', role: 'lead', description: 'Reviews and coordinates' },
 *       { agent: 'frontend-dev', role: 'member', specialization: ['react', 'css'] },
 *       { agent: 'backend-dev', role: 'member', specialization: ['api', 'database'] },
 *     ],
 *   });
 *
 *   const executor = new TeamExecutor(registry.get('dev-team')!, agentExecutor);
 *   const trace = await executor.execute({ goal: 'Build a user profile page' });
 */

export { TeamRegistry } from './team-registry.js';
export { TeamExecutor } from './team-executor.js';
export type { AgentExecutor, AgentExecutionContext, AgentExecutionResult, TeamExecutorOptions } from './team-executor.js';
export { MessageBus } from './message-bus.js';
export type { MessageHandler, MessageFilter, MessageBusOptions } from './message-bus.js';
export { SharedWorkspace } from './shared-workspace.js';
export type { SharedWorkspaceOptions, WorkspaceChangeEvent, WorkspaceChangeHandler } from './shared-workspace.js';

// Re-export all types
export type {
  AgentId,
  TeamId,
  TaskId,
  MessageId,
  DelegationStrategy,
  TeamMember,
  TeamConfig,
  AgentMessage,
  TeamTask,
  WorkspaceEntry,
  TeamExecutionTrace,
  TeamExecuteOptions,
  TeamProgressEvent,
} from './types.js';
