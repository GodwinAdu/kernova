/**
 * defineRemoteAgent — Connect to agents from other organizations.
 *
 * Enables cross-company agent communication via the Kernova Agent Protocol (KAP).
 * Your agent can discover, authenticate, and talk to any agent that implements KAP.
 *
 * Usage:
 *   // agents/remotes/vercel.ts
 *   import { defineRemoteAgent } from '@kernova/framework';
 *
 *   export default defineRemoteAgent({
 *     name: 'vercel',
 *     description: 'Vercel deployment agent — deploy and manage projects',
 *     endpoint: 'https://agents.vercel.com',
 *     auth: {
 *       type: 'api-key',
 *       token: process.env.VERCEL_AGENT_KEY!,
 *     },
 *   });
 *
 * Then in your agent:
 *   export default defineAgent({
 *     name: 'my-agent',
 *     remoteAgents: ['vercel', 'stripe'],
 *     handler: async (ctx) => {
 *       const result = await ctx.askRemote('vercel', 'Deploy my-app to production');
 *       return { content: result };
 *     },
 *   });
 *
 * Or with auto-discovery from the Kernova Registry:
 *   import { defineRemoteAgent } from '@kernova/framework';
 *
 *   export default defineRemoteAgent({
 *     name: 'github-copilot',
 *     discover: true, // Find from Kernova's global registry
 *     auth: {
 *       type: 'oauth2',
 *       token: process.env.GITHUB_TOKEN!,
 *     },
 *   });
 */

export interface RemoteAgentAuth {
  type: 'api-key' | 'bearer' | 'oauth2' | 'none';
  /** API key or bearer token */
  token?: string;
  /** Header name for API key (default: X-API-Key) */
  headerName?: string;
  /** OAuth config */
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    tokenUrl?: string;
  };
}

export interface RemoteAgentDefinition {
  /** Local name for this remote agent (used in ctx.askRemote) */
  name: string;
  /** Description of what this remote agent does */
  description?: string;
  /** Direct endpoint URL (skip discovery) */
  endpoint?: string;
  /** Discover from the Kernova Agent Registry */
  discover?: boolean;
  /** Remote agent ID (if different from name, for registry lookup) */
  remoteId?: string;
  /** Authentication credentials */
  auth: RemoteAgentAuth;
  /** Default timeout in ms (default: 30000) */
  timeout?: number;
  /** Max retries (default: 2) */
  maxRetries?: number;
  /** Allowed capabilities to use (whitelist — empty means all) */
  capabilities?: string[];
  /** Whether to require confirmation before calling (human-in-the-loop) */
  requiresConfirmation?: boolean;
}

/**
 * Define a connection to a remote agent from another organization.
 */
export function defineRemoteAgent(definition: RemoteAgentDefinition): RemoteAgentDefinition {
  if (!definition.name) {
    throw new Error('defineRemoteAgent: "name" is required');
  }
  if (!definition.endpoint && !definition.discover) {
    throw new Error('defineRemoteAgent: either "endpoint" or "discover: true" is required');
  }
  if (!definition.auth) {
    throw new Error('defineRemoteAgent: "auth" is required');
  }

  return {
    timeout: 30000,
    maxRetries: 2,
    requiresConfirmation: false,
    ...definition,
  };
}
