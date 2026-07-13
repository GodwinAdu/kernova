/**
 * Kernova Agent Protocol (KAP) — Types
 *
 * The open protocol for cross-organization agent communication.
 * Any agent (Kernova or not) can implement this protocol to be discoverable
 * and communicable by other agents.
 *
 * Spec: .well-known/agent.json
 * Version: 1.0.0
 */

/** The agent card — published at .well-known/agent.json */
export interface AgentCard {
  /** Protocol version */
  protocol: 'kap/1.0';
  /** Agent identity */
  agent: {
    /** Unique agent ID (e.g., "vercel-deploy", "stripe-billing") */
    id: string;
    /** Display name */
    name: string;
    /** Description of what this agent does */
    description: string;
    /** Organization that owns this agent */
    organization: string;
    /** Agent version */
    version: string;
    /** Icon URL (optional) */
    icon?: string;
    /** Tags for discovery */
    tags?: string[];
  };
  /** Endpoint URL for agent communication */
  endpoint: string;
  /** Authentication methods supported */
  auth: AgentAuthConfig[];
  /** Capabilities this agent exposes */
  capabilities: AgentCapability[];
  /** Rate limits */
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  /** Supported protocols */
  protocols?: ('http' | 'websocket' | 'grpc')[];
  /** Documentation URL */
  docs?: string;
  /** Contact info */
  contact?: string;
}

/** Authentication configuration */
export interface AgentAuthConfig {
  type: 'api-key' | 'oauth2' | 'bearer' | 'mutual-tls' | 'none';
  /** Where to put the credential */
  in?: 'header' | 'query' | 'body';
  /** Header/param name */
  name?: string;
  /** OAuth config (if type is oauth2) */
  oauth?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
  };
}

/** A capability the agent offers */
export interface AgentCapability {
  /** Capability ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Input schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;
  /** Output schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** Whether this capability requires confirmation */
  requiresConfirmation?: boolean;
  /** Tags */
  tags?: string[];
}

/** Message sent to a remote agent */
export interface AgentRequest {
  /** Unique request ID */
  id: string;
  /** Protocol version */
  protocol: 'kap/1.0';
  /** The requesting agent's identity */
  from: {
    id: string;
    name: string;
    organization: string;
    endpoint?: string;
  };
  /** The capability being invoked (or 'ask' for general) */
  capability: string;
  /** The message/goal */
  input: string;
  /** Structured parameters (if capability has input schema) */
  params?: Record<string, unknown>;
  /** Context from the conversation */
  context?: {
    threadId?: string;
    previousMessages?: Array<{ role: string; content: string }>;
    metadata?: Record<string, unknown>;
  };
  /** Callback URL for async responses */
  callbackUrl?: string;
  /** Timeout in ms */
  timeout?: number;
  /** Timestamp */
  timestamp: string;
}

/** Response from a remote agent */
export interface AgentResponse {
  /** Request ID this responds to */
  requestId: string;
  /** Protocol version */
  protocol: 'kap/1.0';
  /** Status */
  status: 'success' | 'error' | 'pending' | 'requires-confirmation' | 'delegated';
  /** The response content */
  output?: string;
  /** Structured result data */
  data?: Record<string, unknown>;
  /** Error info (if status is error) */
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  /** If delegated to another agent */
  delegatedTo?: {
    agentId: string;
    endpoint: string;
    requestId: string;
  };
  /** If requires confirmation */
  confirmation?: {
    id: string;
    description: string;
    approveUrl: string;
    denyUrl: string;
    expiresAt: string;
  };
  /** Metadata */
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
    model?: string;
    capabilities_used?: string[];
  };
  /** Timestamp */
  timestamp: string;
}

/** Registry entry for agent discovery */
export interface AgentRegistryEntry {
  /** Agent card */
  card: AgentCard;
  /** When this entry was registered */
  registeredAt: string;
  /** When this entry was last verified (health check) */
  lastVerified?: string;
  /** Is this agent currently online? */
  online: boolean;
  /** Trust score (0-1) based on uptime, response quality */
  trustScore: number;
  /** Number of successful interactions */
  interactions: number;
}

/** Connection to a remote agent */
export interface RemoteAgentConnection {
  /** Agent card (discovered or provided) */
  card: AgentCard;
  /** Authentication credentials */
  credentials: RemoteAgentCredentials;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'error' | 'authenticating';
  /** Last successful communication */
  lastContact?: string;
  /** Error if status is 'error' */
  error?: string;
}

/** Credentials for connecting to a remote agent */
export interface RemoteAgentCredentials {
  type: 'api-key' | 'oauth2' | 'bearer' | 'none';
  /** API key or bearer token */
  token?: string;
  /** OAuth tokens */
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };
}

/** Options for discovering remote agents */
export interface DiscoveryOptions {
  /** Search by tags */
  tags?: string[];
  /** Search by capability */
  capability?: string;
  /** Search by organization */
  organization?: string;
  /** Search by name (fuzzy) */
  query?: string;
  /** Minimum trust score */
  minTrustScore?: number;
  /** Only online agents */
  onlineOnly?: boolean;
  /** Max results */
  limit?: number;
}
