/**
 * Agent Protocol Server — Exposes your agent via KAP.
 *
 * Makes your Kernova agent discoverable and callable by other agents
 * across organizations. Handles:
 * - Serving .well-known/agent.json
 * - Receiving and validating incoming KAP requests
 * - Auth verification
 * - Rate limiting
 * - Request routing to local agents
 */

import type {
  AgentCard,
  AgentRequest,
  AgentResponse,
  AgentCapability,
  AgentAuthConfig,
} from './types.js';

export interface AgentServerConfig {
  /** Your agent's identity */
  agent: {
    id: string;
    name: string;
    description: string;
    organization: string;
    version: string;
    icon?: string;
    tags?: string[];
  };
  /** The public endpoint URL where this agent is reachable */
  endpoint: string;
  /** Auth methods this agent supports */
  auth: AgentAuthConfig[];
  /** Capabilities to expose */
  capabilities: AgentCapability[];
  /** Rate limits */
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  /** Handler for incoming requests */
  handler: (request: AgentRequest) => Promise<AgentResponse>;
  /** API keys that are allowed to call this agent */
  allowedKeys?: string[];
  /** Allowed organizations (if empty, all are allowed) */
  allowedOrgs?: string[];
  /** Documentation URL */
  docs?: string;
}

export class AgentProtocolServer {
  private config: AgentServerConfig;
  private card: AgentCard;
  private requestCounts: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(config: AgentServerConfig) {
    this.config = config;
    this.card = this.buildCard();
  }

  /** Get the agent card (for .well-known/agent.json) */
  getCard(): AgentCard {
    return this.card;
  }

  /** Handle an incoming HTTP request (to be wired into your server) */
  async handleRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    // Serve agent card
    if (method === 'GET' && (path === '/.well-known/agent.json' || path === '/agent.json')) {
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
        body: JSON.stringify(this.card, null, 2),
      };
    }

    // Health check
    if (method === 'GET' && path === '/health') {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'healthy',
          agent: this.config.agent.id,
          protocol: 'kap/1.0',
          uptime: process.uptime(),
        }),
      };
    }

    // Handle incoming agent requests
    if (method === 'POST' && (path === '/' || path === '/v1/ask' || path === this.getEndpointPath())) {
      return this.handleAgentRequest(headers, body || '');
    }

    // CORS preflight
    if (method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Agent-Protocol, X-Agent-Id',
        },
        body: '',
      };
    }

    // Capabilities list
    if (method === 'GET' && path === '/capabilities') {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: this.config.capabilities }),
      };
    }

    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found', hint: 'Try GET /.well-known/agent.json' }),
    };
  }

  // ─── Private ───────────────────────────────────────────────────

  private async handleAgentRequest(
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    // Verify auth
    const authResult = this.verifyAuth(headers);
    if (!authResult.valid) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: 'kap/1.0',
          status: 'error',
          error: { code: 'UNAUTHORIZED', message: authResult.reason || 'Authentication failed' },
          timestamp: new Date().toISOString(),
        } satisfies Partial<AgentResponse>),
      };
    }

    // Parse request
    let request: AgentRequest;
    try {
      request = JSON.parse(body);
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: 'kap/1.0',
          status: 'error',
          error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' },
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // Validate protocol
    if (request.protocol !== 'kap/1.0') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: 'kap/1.0',
          requestId: request.id,
          status: 'error',
          error: { code: 'UNSUPPORTED_PROTOCOL', message: `Expected kap/1.0, got ${request.protocol}` },
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // Rate limiting
    const rateLimited = this.checkRateLimit(request.from.id);
    if (rateLimited) {
      return {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        body: JSON.stringify({
          protocol: 'kap/1.0',
          requestId: request.id,
          status: 'error',
          error: { code: 'RATE_LIMITED', message: 'Too many requests', retryable: true },
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // Check org allowlist
    if (this.config.allowedOrgs && this.config.allowedOrgs.length > 0) {
      if (!this.config.allowedOrgs.includes(request.from.organization)) {
        return {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocol: 'kap/1.0',
            requestId: request.id,
            status: 'error',
            error: { code: 'FORBIDDEN', message: `Organization "${request.from.organization}" is not allowed` },
            timestamp: new Date().toISOString(),
          }),
        };
      }
    }

    // Validate capability exists (if not 'ask')
    if (request.capability !== 'ask') {
      const cap = this.config.capabilities.find(c => c.id === request.capability);
      if (!cap) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocol: 'kap/1.0',
            requestId: request.id,
            status: 'error',
            error: {
              code: 'CAPABILITY_NOT_FOUND',
              message: `Capability "${request.capability}" not found. Available: ${this.config.capabilities.map(c => c.id).join(', ')}`,
            },
            timestamp: new Date().toISOString(),
          }),
        };
      }
    }

    // Execute the request
    try {
      const response = await this.config.handler(request);

      return {
        status: response.status === 'error' ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      };
    } catch (err) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: 'kap/1.0',
          requestId: request.id,
          status: 'error',
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Internal error',
            retryable: true,
          },
          timestamp: new Date().toISOString(),
        } satisfies AgentResponse),
      };
    }
  }

  private verifyAuth(headers: Record<string, string>): { valid: boolean; reason?: string } {
    // If no auth required, allow all
    if (this.config.auth.length === 0 || this.config.auth.some(a => a.type === 'none')) {
      return { valid: true };
    }

    // Check API key
    if (this.config.allowedKeys && this.config.allowedKeys.length > 0) {
      const apiKey = headers['x-api-key'] || headers['authorization']?.replace('Bearer ', '');
      if (apiKey && this.config.allowedKeys.includes(apiKey)) {
        return { valid: true };
      }
    }

    // Check bearer token
    const authHeader = headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (this.config.allowedKeys?.includes(token)) {
        return { valid: true };
      }
      // If we have allowed keys and token doesn't match, deny
      if (this.config.allowedKeys && this.config.allowedKeys.length > 0) {
        return { valid: false, reason: 'Invalid API key' };
      }
      // If no allowedKeys configured, accept any bearer token
      return { valid: true };
    }

    return { valid: false, reason: 'No authentication provided' };
  }

  private checkRateLimit(callerId: string): boolean {
    if (!this.config.rateLimit) return false;

    const now = Date.now();
    const entry = this.requestCounts.get(callerId);

    if (!entry || now > entry.resetAt) {
      this.requestCounts.set(callerId, { count: 1, resetAt: now + 60000 });
      return false;
    }

    entry.count++;
    return entry.count > this.config.rateLimit.requestsPerMinute;
  }

  private buildCard(): AgentCard {
    return {
      protocol: 'kap/1.0',
      agent: this.config.agent,
      endpoint: this.config.endpoint,
      auth: this.config.auth,
      capabilities: this.config.capabilities,
      rateLimit: this.config.rateLimit,
      protocols: ['http'],
      docs: this.config.docs,
    };
  }

  private getEndpointPath(): string {
    try {
      return new URL(this.config.endpoint).pathname;
    } catch {
      return '/';
    }
  }
}
