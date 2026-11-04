/**
 * Tool definition types for custom tools.
 */

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ToolParameter {
  type: ToolParameterType;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: { type: ToolParameterType };
}

export type ToolParameters = Record<string, ToolParameter>;

export interface ToolContext {
  /** Current user info */
  user?: { id: string; [key: string]: unknown };
  /** Thread ID of the conversation (`trigger_<name>` for trigger runs) */
  threadId?: string;
  /** The trigger that started this run, when a trigger did */
  trigger?: string;
  /**
   * True when no person asked for this run (a trigger or schedule). Use it to require
   * stronger permissions for actions taken on the agent's own initiative
   */
  autonomous?: boolean;
  /** Route of the agent that called the tool */
  agent?: string;
  /** Environment variables (from project secrets) */
  env: Record<string, string | undefined>;
  /** Log helper */
  log: (message: string) => void;
}

export interface ToolDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> {
  /** Tool name (used by agents to reference it) */
  name: string;
  /** Human-readable description (shown to the LLM) */
  description: string;
  /** Parameter schema */
  parameters: ToolParameters;
  /** Execute the tool */
  execute: (params: TParams, context: ToolContext) => Promise<unknown>;
  /** Optional rate limit (calls per minute) */
  rateLimit?: number;
  /** Whether this tool requires confirmation before executing */
  requiresConfirmation?: boolean;
}
