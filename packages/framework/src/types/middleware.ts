/**
 * Middleware types for agent request/response pipeline.
 */

export interface MiddlewareContext {
  /** The agent being called */
  agentName: string;
  /** The user input */
  input: string;
  /** Thread ID */
  threadId: string;
  /** User metadata */
  user?: { id: string; [key: string]: unknown };
  /** Request metadata */
  metadata: Record<string, unknown>;
  /** Response (available in after-middleware) */
  response?: { content: string; metadata?: Record<string, unknown> };
}

export type MiddlewareNext = () => Promise<void>;

export interface MiddlewareDefinition {
  /** Middleware name */
  name: string;
  /** When to run: before agent, after agent, or both */
  stage?: 'before' | 'after' | 'both';
  /** The middleware handler */
  handler: (context: MiddlewareContext, next: MiddlewareNext) => Promise<void>;
}
