/**
 * exposeAgent — Make your agent callable by other organizations.
 *
 * Generates a .well-known/agent.json and adds the KAP protocol
 * endpoint to your server. Other agents can then discover and
 * communicate with your agent.
 *
 * Usage:
 *   // kernova.config.ts
 *   import { defineConfig } from '@kernova/framework';
 *
 *   export default defineConfig({
 *     name: 'my-agent',
 *     expose: {
 *       enabled: true,
 *       organization: 'MyCompany',
 *       description: 'Handles customer support inquiries',
 *       capabilities: [
 *         { id: 'ask', name: 'Ask Question', description: 'Ask a support question' },
 *         { id: 'create-ticket', name: 'Create Ticket', description: 'Create a support ticket' },
 *       ],
 *       auth: [{ type: 'api-key', in: 'header', name: 'X-API-Key' }],
 *       allowedKeys: [process.env.EXTERNAL_API_KEY!],
 *       rateLimit: { requestsPerMinute: 30, requestsPerDay: 1000 },
 *     },
 *   });
 *
 * This will:
 * 1. Serve GET /.well-known/agent.json with your agent card
 * 2. Accept POST /v1/kap (Kernova Agent Protocol requests)
 * 3. Verify authentication on incoming requests
 * 4. Route to your agents based on capability
 * 5. Register with Kernova Cloud registry (if deployed)
 */

export interface ExposeAgentCapability {
  /** Capability ID (e.g., 'ask', 'deploy', 'search') */
  id: string;
  /** Display name */
  name: string;
  /** What this capability does */
  description: string;
  /** Input schema (JSON Schema format) */
  inputSchema?: Record<string, unknown>;
  /** Output schema */
  outputSchema?: Record<string, unknown>;
  /** Tags for discovery */
  tags?: string[];
  /** Does this require confirmation? */
  requiresConfirmation?: boolean;
}

export interface ExposeAgentAuth {
  type: 'api-key' | 'bearer' | 'oauth2' | 'none';
  /** Where to look for the credential */
  in?: 'header' | 'query';
  /** Header/param name (default: 'X-API-Key' or 'Authorization') */
  name?: string;
}

export interface ExposeAgentConfig {
  /** Enable exposure (default: false) */
  enabled: boolean;
  /** Your organization name */
  organization: string;
  /** Description shown to other agents */
  description?: string;
  /** Version of your agent API */
  version?: string;
  /** Icon URL */
  icon?: string;
  /** Tags for registry discovery */
  tags?: string[];
  /** Capabilities to expose */
  capabilities: ExposeAgentCapability[];
  /** Supported auth methods */
  auth: ExposeAgentAuth[];
  /** API keys allowed to call your agent */
  allowedKeys?: string[];
  /** Allowed organizations (empty = all) */
  allowedOrgs?: string[];
  /** Rate limits */
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  /** Whether to register with Kernova Cloud registry */
  registerInRegistry?: boolean;
  /** Documentation URL */
  docs?: string;
}
