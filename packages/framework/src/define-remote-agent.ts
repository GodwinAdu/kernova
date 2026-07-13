/**
 * defineRemoteAgent — Connect to agents from other organizations.
 *
 * For agents on Kernova Cloud: NO API key needed. Just declare the connection
 * and connect via the dashboard. Kernova Cloud authenticates both sides.
 *
 * For external agents (not on Kernova Cloud): provide endpoint + auth.
 *
 * Usage (Kernova Cloud — no key needed):
 *   // agents/remotes/stripe.ts
 *   import { defineRemoteAgent } from '@kernova/framework';
 *
 *   export default defineRemoteAgent({
 *     name: 'stripe',
 *     description: 'Stripe billing agent',
 *     // No endpoint, no auth — connected via Kernova Cloud dashboard
 *   });
 *
 * Usage (External agent — needs endpoint + auth):
 *   // agents/remotes/custom.ts
 *   import { defineRemoteAgent } from '@kernova/framework';
 *
 *   export default defineRemoteAgent({
 *     name: 'partner-agent',
 *     description: 'Partner company agent',
 *     endpoint: 'https://partner.com/agent',
 *     auth: {
 *       type: 'bearer',
 *       token: process.env.PARTNER_TOKEN!,
 *     },
 *   });
 *
 * Then in your agent:
 *   export default defineAgent({
 *     name: 'my-agent',
 *     instructions: '...',
 *     handler: async (ctx) => {
 *       // Works for both Kernova Cloud and external agents
 *       const result = await ctx.askRemote('stripe', 'Get subscription status');
 *       return { content: result };
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
  /**
   * Direct endpoint URL (only for agents NOT on Kernova Cloud).
   * If omitted, the framework routes through Kernova Cloud's proxy automatically.
   */
  endpoint?: string;
  /**
   * Authentication credentials (only for agents NOT on Kernova Cloud).
   * For Kernova Cloud agents: leave this empty — the platform handles auth.
   */
  auth?: RemoteAgentAuth;
  /** Remote agent ID in the registry (if different from name) */
  remoteId?: string;
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
 * Define a connection to a remote agent.
 *
 * For Kernova Cloud agents: just provide a name. Connect via the dashboard.
 * For external agents: provide endpoint + auth.
 */
export function defineRemoteAgent(definition: RemoteAgentDefinition): RemoteAgentDefinition {
  if (!definition.name) {
    throw new Error('defineRemoteAgent: "name" is required');
  }

  // External agents need endpoint + auth
  // Kernova Cloud agents need neither (the platform handles it)

  return {
    timeout: 30000,
    maxRetries: 2,
    requiresConfirmation: false,
    ...definition,
  };
}
