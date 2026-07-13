/**
 * @kernova/framework/react
 *
 * React hooks for connecting your frontend to Kernova agents.
 * Works in both dev (local) and production (Kernova Cloud) seamlessly.
 *
 * Usage:
 *   import { useAgent, useAgentStream, useMemory, KernovaProvider } from '@kernova/framework/react';
 */

export { KernovaProvider, useKernovaContext } from './provider.js';
export { useAgent } from './use-agent.js';
export { useAgentStream } from './use-agent-stream.js';
export { useMemory } from './use-memory.js';
export { useThread } from './use-thread.js';
export { useConnectionStatus } from './use-connection-status.js';
export { useTeam } from './use-team.js';
export { KernovaErrorBoundary } from './error-boundary.js';

export type {
  UseAgentOptions,
  UseAgentReturn,
  AgentMessage,
} from './use-agent.js';

export type {
  UseAgentStreamOptions,
  UseAgentStreamReturn,
} from './use-agent-stream.js';

export type {
  UseMemoryOptions,
  UseMemoryReturn,
} from './use-memory.js';

export type {
  UseThreadReturn,
} from './use-thread.js';

export type {
  KernovaErrorBoundaryProps,
} from './error-boundary.js';

export type {
  UseConnectionStatusReturn,
} from './use-connection-status.js';

export type {
  UseTeamOptions,
  UseTeamReturn,
  TeamProgressEvent,
  TeamExecutionResult,
} from './use-team.js';
