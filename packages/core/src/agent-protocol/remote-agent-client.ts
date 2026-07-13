/**
 * Remote Agent Client — Communicates with external agents via KAP.
 *
 * Handles:
 * - Agent discovery (via .well-known/agent.json)
 * - Authentication (API key, OAuth, bearer)
 * - Request/response lifecycle
 * - Retry logic
 * - Timeout management
 * - Connection pooling
 */

import type {
  AgentCard,
  AgentRequest,
  AgentResponse,
  AgentCapability,
  RemoteAgentConnection,
  RemoteAgentCredentials,
} from './types.js';

export interface RemoteAgentClientOptions {
  /** Default timeout for requests in ms */
  defaultTimeout?: number;
  /** Max retries on failure */
  maxRetries?: number;
  /** Retry delay in ms */
  retryDelay?: number;
  /** User agent string */
  userAgent?: string;
  /** This agent's identity */
  identity: {
    id: string;
    name: string;
    organization: string;
    endpoint?: string;
  };
}

const DEFAULT_OPTIONS: Omit<Required<RemoteAgentClientOptions>, 'identity'> = {
  defaultTimeout: 30000,
  maxRetries: 2,
  retryDelay: 1000,
  userAgent: 'Kernova-Agent/1.0',
};

export class RemoteAgentClient {
  private options: Required<RemoteAgentClientOptions>;
  private connections: Map<string, RemoteAgentConnection> = new Map();
  private requestCounter = 0;

  constructor(options: RemoteAgentClientOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<RemoteAgentClientOptions>;
  }

  /**
   * Discover an agent by fetching its .well-known/agent.json
   */
  async discover(baseUrl: string): Promise<AgentCard> {
    const url = baseUrl.endsWith('/')
      ? `${baseUrl}.well-known/agent.json`
      : `${baseUrl}/.well-known/agent.json`;

    const res = await fetch(url, {
      headers: { 'User-Agent': this.options.userAgent },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Agent discovery failed at ${url}: ${res.status} ${res.statusText}`);
    }

    const card: AgentCard = await res.json() as AgentCard;

    // Validate the card
    if (card.protocol !== 'kap/1.0') {
      throw new Error(`Unsupported protocol: ${card.protocol}. Expected kap/1.0`);
    }
    if (!card.agent?.id || !card.endpoint) {
      throw new Error('Invalid agent card: missing agent.id or endpoint');
    }

    return card;
  }

  /**
   * Connect to a remote agent (discover + authenticate)
   */
  async connect(
    baseUrl: string,
    credentials: RemoteAgentCredentials,
  ): Promise<RemoteAgentConnection> {
    const card = await this.discover(baseUrl);
    return this.connectWithCard(card, credentials);
  }

  /**
   * Connect to a remote agent using a pre-fetched card
   */
  connectWithCard(
    card: AgentCard,
    credentials: RemoteAgentCredentials,
  ): RemoteAgentConnection {
    const connection: RemoteAgentConnection = {
      card,
      credentials,
      status: 'connected',
      lastContact: new Date().toISOString(),
    };

    this.connections.set(card.agent.id, connection);
    return connection;
  }

  /**
   * Send a request to a remote agent
   */
  async ask(
    agentId: string,
    input: string,
    options?: {
      capability?: string;
      params?: Record<string, unknown>;
      context?: AgentRequest['context'];
      timeout?: number;
    },
  ): Promise<AgentResponse> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      throw new Error(`Not connected to agent "${agentId}". Call connect() first.`);
    }

    if (connection.status === 'error') {
      throw new Error(`Agent "${agentId}" is in error state: ${connection.error}`);
    }

    const request: AgentRequest = {
      id: this.generateRequestId(),
      protocol: 'kap/1.0',
      from: this.options.identity,
      capability: options?.capability || 'ask',
      input,
      params: options?.params,
      context: options?.context,
      timeout: options?.timeout || this.options.defaultTimeout,
      timestamp: new Date().toISOString(),
    };

    return this.sendRequest(connection, request);
  }

  /**
   * Invoke a specific capability on a remote agent
   */
  async invoke(
    agentId: string,
    capability: string,
    params: Record<string, unknown>,
    options?: { timeout?: number; context?: AgentRequest['context'] },
  ): Promise<AgentResponse> {
    return this.ask(agentId, '', {
      capability,
      params,
      timeout: options?.timeout,
      context: options?.context,
    });
  }

  /**
   * List capabilities of a connected agent
   */
  getCapabilities(agentId: string): AgentCapability[] {
    const connection = this.connections.get(agentId);
    if (!connection) return [];
    return connection.card.capabilities;
  }

  /**
   * Check if an agent supports a specific capability
   */
  hasCapability(agentId: string, capability: string): boolean {
    const capabilities = this.getCapabilities(agentId);
    return capabilities.some(c => c.id === capability);
  }

  /**
   * Get connection status for an agent
   */
  getConnection(agentId: string): RemoteAgentConnection | undefined {
    return this.connections.get(agentId);
  }

  /**
   * List all connected agents
   */
  listConnections(): RemoteAgentConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Disconnect from a remote agent
   */
  disconnect(agentId: string): void {
    this.connections.delete(agentId);
  }

  /**
   * Ping a remote agent to check if it's online
   */
  async ping(agentId: string): Promise<boolean> {
    const connection = this.connections.get(agentId);
    if (!connection) return false;

    try {
      const res = await fetch(`${connection.card.endpoint}/health`, {
        headers: this.buildHeaders(connection),
        signal: AbortSignal.timeout(5000),
      });
      const online = res.ok;
      connection.status = online ? 'connected' : 'error';
      if (online) connection.lastContact = new Date().toISOString();
      return online;
    } catch {
      connection.status = 'disconnected';
      return false;
    }
  }

  // ─── Private ───────────────────────────────────────────────────

  private async sendRequest(
    connection: RemoteAgentConnection,
    request: AgentRequest,
  ): Promise<AgentResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const res = await fetch(connection.card.endpoint, {
          method: 'POST',
          headers: {
            ...this.buildHeaders(connection),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(request.timeout || this.options.defaultTimeout),
        });

        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          const error: AgentResponse = {
            requestId: request.id,
            protocol: 'kap/1.0',
            status: 'error',
            error: {
              code: `HTTP_${res.status}`,
              message: errorBody || res.statusText,
              retryable: res.status >= 500,
            },
            timestamp: new Date().toISOString(),
          };

          // Don't retry client errors (4xx)
          if (res.status < 500) return error;

          lastError = new Error(`HTTP ${res.status}: ${errorBody || res.statusText}`);
        } else {
          const response: AgentResponse = await res.json() as AgentResponse;
          connection.lastContact = new Date().toISOString();
          connection.status = 'connected';
          return response;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (err instanceof Error && err.name === 'TimeoutError') {
          // Timeout — may be retryable
          lastError = new Error(`Request to ${connection.card.agent.name} timed out`);
        }
      }

      // Wait before retry
      if (attempt < this.options.maxRetries) {
        await new Promise(r => setTimeout(r, this.options.retryDelay * (attempt + 1)));
      }
    }

    // All retries exhausted
    connection.status = 'error';
    connection.error = lastError?.message || 'Unknown error';

    return {
      requestId: request.id,
      protocol: 'kap/1.0',
      status: 'error',
      error: {
        code: 'CONNECTION_FAILED',
        message: lastError?.message || 'Failed to communicate with remote agent',
        retryable: true,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private buildHeaders(connection: RemoteAgentConnection): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.options.userAgent,
      'X-Agent-Protocol': 'kap/1.0',
      'X-Agent-Id': this.options.identity.id,
    };

    const { credentials } = connection;

    switch (credentials.type) {
      case 'api-key':
        if (credentials.token) {
          // Check the card for where to put it
          const authConfig = connection.card.auth.find(a => a.type === 'api-key');
          const headerName = authConfig?.name || 'X-API-Key';
          headers[headerName] = credentials.token;
        }
        break;

      case 'bearer':
      case 'oauth2':
        if (credentials.token) {
          headers['Authorization'] = `Bearer ${credentials.token}`;
        } else if (credentials.oauth?.accessToken) {
          headers['Authorization'] = `Bearer ${credentials.oauth.accessToken}`;
        }
        break;

      case 'none':
        break;
    }

    return headers;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestCounter}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
