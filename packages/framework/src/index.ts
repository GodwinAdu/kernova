/**
 * @kernova/framework
 *
 * Full-stack AI agent framework.
 * Define agents and frontends in one project, deploy with one command.
 *
 * Usage:
 *   import { defineAgent, defineTool, defineMemory, defineConfig } from '@kernova/framework';
 */

// Core definition APIs
export { defineAgent } from './define-agent.js';
export { defineTool } from './define-tool.js';
export { defineMemory } from './define-memory.js';
export { defineConfig } from './config/index.js';
export { defineMiddleware } from './define-middleware.js';
export { defineSkill } from './skills/define-skill.js';
export { defineMCP } from './mcp/define-mcp.js';
export { defineWorkflow } from './define-workflow.js';
export { defineTrigger } from './define-trigger.js';
export { defineChannel } from './define-channel.js';
export { defineTask } from './define-task.js';
export { definePlan } from './define-plan.js';
export { defineTeam } from './define-team.js';
export { defineRemoteAgent } from './define-remote-agent.js';

// Types
export type {
  AgentDefinition,
  AgentContext,
  AgentHandler,
  AgentResponse,
  TeamWorkspace,
} from './types/agent.js';

export type {
  ToolDefinition,
  ToolContext,
  ToolParameter,
  ToolParameters,
} from './types/tool.js';

export type {
  MemoryDefinition,
  MemoryField,
  MemorySchema,
} from './types/memory.js';

export type {
  KernovaFrameworkConfig,
  ModelConfig,
  DeployConfig,
} from './types/config.js';

export type {
  MiddlewareDefinition,
  MiddlewareContext,
  MiddlewareNext,
} from './types/middleware.js';

export type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepContext,
} from './define-workflow.js';

export type {
  TriggerDefinition,
} from './define-trigger.js';

export type {
  ChannelDefinition,
  ChannelMessage,
  ChannelType,
} from './define-channel.js';

export type {
  TaskDefinition,
  TaskContext,
} from './define-task.js';

export type {
  PlanDefinition,
  PlanStep,
} from './define-plan.js';

export type {
  SkillDefinition,
  SkillManifest,
} from './skills/types.js';

export type {
  MCPServerConfig,
} from './mcp/types.js';

export type {
  TeamDefinition,
  TeamMemberDefinition,
  DelegationStrategy as TeamDelegationStrategy,
} from './define-team.js';

export type {
  RemoteAgentDefinition,
  RemoteAgentAuth,
} from './define-remote-agent.js';

export type {
  ExposeAgentConfig,
  ExposeAgentCapability,
  ExposeAgentAuth,
} from './expose-agent.js';
