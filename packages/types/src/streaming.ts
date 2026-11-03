/**
 * Kernova Streaming Types
 * 
 * Defines the streaming response interface for real-time LLM output.
 */

import type { ModelProviderId, TokenUsage, ToolCall } from './model.js';

/**
 * A single chunk in a streaming response.
 */
export interface StreamChunk {
  /** Text content in this chunk (may be empty for metadata-only chunks) */
  content: string;

  /** Whether this is the final chunk */
  done: boolean;

  /** Tool calls (only in final chunk or tool_call chunks) */
  toolCalls?: ToolCall[];

  /** Token usage (only in final chunk) */
  usage?: TokenUsage;

  /** Which provider is streaming */
  provider?: ModelProviderId;

  /** Which model is streaming */
  model?: string;

  /** Finish reason (only in final chunk) */
  finishReason?: 'stop' | 'length' | 'error' | 'tool_call';

  /** Reasoning text in this chunk, when the provider streams it */
  reasoning?: string;

  /** Data to send back with this assistant turn (only in final chunk; see CompletionResponse.providerData) */
  providerData?: Record<string, unknown>;
}

/**
 * Streaming completion request (same as CompletionRequest but signals streaming)
 */
export interface StreamRequest {
  /** Messages to send */
  messages: Array<{ role: string; content: string; toolCallId?: string }>;

  /** Which model to use */
  model: string;

  /** Temperature */
  temperature?: number;

  /** Maximum tokens */
  maxTokens?: number;

  /** Stop sequences */
  stopSequences?: string[];

  /** Available tools */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}
