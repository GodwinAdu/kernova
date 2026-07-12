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
  /** Call another agent */
  delegate: (agentName: string, input: string) => Promise<AgentResponse>;
  /** Emit a streaming chunk */
  emit: (chunk: string) => void;
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
  /** Schedule for autonomous execution */
  schedule?: string | { cron: string; goal: string }[];
}
