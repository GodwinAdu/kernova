/**
 * Kernova Agent Protocol (KAP) — Cross-Organization Agent Communication
 *
 * Enables agents from different organizations to discover, authenticate,
 * and communicate with each other over a standard protocol.
 *
 * Components:
 * - RemoteAgentClient: Call external agents
 * - AgentProtocolServer: Expose your agent to external callers
 * - AgentRegistry: Discover agents by capability/tag/org
 *
 * Protocol: kap/1.0
 * Discovery: GET /.well-known/agent.json
 * Communication: POST to agent endpoint
 *
 * Usage (calling a remote agent):
 *   import { RemoteAgentClient } from '@kernova/core';
 *
 *   const client = new RemoteAgentClient({
 *     identity: { id: 'my-agent', name: 'My Agent', organization: 'MyCompany' },
 *   });
 *
 *   // Discover and connect
 *   await client.connect('https://agents.vercel.com', { type: 'api-key', token: 'sk-...' });
 *
 *   // Ask the remote agent
 *   const response = await client.ask('vercel-deploy', 'Deploy my app to production');
 *   console.log(response.output);
 *
 * Usage (exposing your agent):
 *   import { AgentProtocolServer } from '@kernova/core';
 *
 *   const server = new AgentProtocolServer({
 *     agent: { id: 'my-agent', name: 'My Agent', ... },
 *     endpoint: 'https://my-agent.example.com/v1/ask',
 *     auth: [{ type: 'api-key', in: 'header', name: 'X-API-Key' }],
 *     capabilities: [{ id: 'deploy', name: 'Deploy', description: 'Deploy apps' }],
 *     handler: async (request) => { ... },
 *   });
 */

export { RemoteAgentClient } from './remote-agent-client.js';
export type { RemoteAgentClientOptions } from './remote-agent-client.js';

export { AgentProtocolServer } from './agent-server.js';
export type { AgentServerConfig } from './agent-server.js';

export { AgentRegistry } from './agent-registry.js';
export type { AgentRegistryConfig } from './agent-registry.js';

// Re-export all types
export type {
  AgentCard,
  AgentAuthConfig,
  AgentCapability,
  AgentRequest,
  AgentResponse,
  AgentRegistryEntry,
  RemoteAgentConnection,
  RemoteAgentCredentials,
  DiscoveryOptions,
} from './types.js';
