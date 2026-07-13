/**
 * Agent definition types for file-based agent routing.
 */

export interface AgentContext {
  /** The user's message or goal */
  input: string;
  /** Thread/conversation ID */
  threadId: string;
  /** User metadata */
  user?: { id: string; [key: string]: unknown };
  /** Memory recall helper */
  recall: (query: string, options?: { limit?: number }) => Promise<MemoryResult[]>;
  /** Memory store helper */
  remember: (content: string, tags?: string[]) => Promise<void>;
  /** Call another agent (basic delegation) */
  delegate: (agentName: string, input: string) => Promise<AgentResponse>;
  /**
   * Delegate a task to a specific team member.
   * Only available when running within a team context.
   * Respects delegation depth limits and team membership.
   */
  delegateTo: (agentName: string, goal: string, context?: Record<string, unknown>) => Promise<string>;
  /**
   * Shared workspace — read/write state visible to all team members.
   * Only available when running within a team context.
   */
  workspace: TeamWorkspace;
  /**
   * Ask a remote agent from another organization.
   * Uses the Kernova Agent Protocol (KAP) to communicate.
   * The remote agent must be defined with defineRemoteAgent().
   */
  askRemote: (agentName: string, input: string, options?: {
    capability?: string;
    params?: Record<string, unknown>;
    timeout?: number;
  }) => Promise<string>;
  /**
   * List of team members (available when in team context).
   * Useful for knowing who to delegate to.
   */
  teamMembers?: Array<{ agent: string; role: string; description?: string; specialization?: string[] }>;
  /** Emit a streaming chunk */
  emit: (chunk: string) => void;
  /** Log a message */
  log: (message: string) => void;
  /** Environment variables */
  env: Record<string, string | undefined>;
}

export interface TeamWorkspace {
  /** Get a value from the shared workspace */
  get: <T = unknown>(key: string) => T | undefined;
  /** Set a value in the shared workspace */
  set: (key: string, value: unknown) => void;
  /** Check if a key exists */
  has: (key: string) => boolean;
  /** Delete a key */
  delete: (key: string) => void;
  /** Get all workspace data */
  getAll: () => Record<string, unknown>;
  /** Merge data into an existing object key */
  merge: (key: string, data: Record<string, unknown>) => void;
  /** Append an item to an array key */
  append: (key: string, item: unknown) => void;
}

export interface AgentResponse {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryResult {
  content: string;
  score: number;
  tags: string[];
  createdAt: Date;
}

export type AgentHandler = (context: AgentContext) => Promise<AgentResponse | string>;

export interface AgentDefinition {
  /** Agent display name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Model to use (defaults to project default) */
  model?: string;
  /** System instructions for the agent */
  instructions: string;
  /** Tools this agent can access (file paths or tool names) */
  tools?: string[];
  /** Memory configuration for this agent */
  memory?: {
    type: 'conversational' | 'persistent' | 'none';
    ttl?: string;
  };
  /** Middleware to run before/after this agent */
  middleware?: string[];
  /** Custom handler (overrides LLM-based execution) */
  handler?: AgentHandler;
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature for model */
  temperature?: number;
  /** Capabilities this agent has */
  capabilities?: string[];
  /** Skills to load (skill names or paths) */
  skills?: string[];
  /** MCP servers this agent needs */
  mcp?: string[];
  /** Schedule for autonomous execution */
  schedule?: string | { cron: string; goal: string }[];
  /** Proactive triggers */
  triggers?: Array<{
    event: string;
    goal: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    cooldown?: number;
  }>;
  /** Budget limits for this agent */
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxRequestsPerMinute?: number;
  };
  /** Permissions (what this agent is allowed to do) */
  permissions?: string[];
  /** Channels this agent listens on */
  channels?: string[];
  /** Remote agents this agent can communicate with (cross-organization) */
  remoteAgents?: string[];
}
