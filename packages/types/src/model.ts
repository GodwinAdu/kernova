/**
 * Kernova Model System Types
 * 
 * Pillar: Reasoning — "How should we think?"
 * 
 * Defines the Universal Model Protocol — a provider-agnostic interface
 * that any AI model (current or future) can implement.
 * 
 * Design philosophy:
 * - Configuration over code: new providers via config, not source
 * - Pattern-based adapters: one adapter covers many providers
 * - Capability declaration: providers declare what they support
 * - Zero-dependency: uses fetch(), no provider SDKs
 */

import type { NexusId, Confidence, Timestamp } from './base.js';

/** 
 * Provider ID is any string — not a fixed union.
 * This means any future provider works without changing types.
 */
export type ModelProviderId = string;

/** What the model is being used for */
export type ModelPurpose =
  | 'reasoning'       // Complex thinking, planning
  | 'generation'      // Content creation
  | 'embedding'       // Vector embeddings for semantic search
  | 'classification'  // Categorization
  | 'extraction'      // Structured data extraction
  | 'conversation'    // Multi-turn dialogue
  | 'vision'          // Image understanding
  | 'audio'           // Speech/audio processing
  | 'code'            // Code generation/analysis
  | 'multimodal';     // Multiple modalities combined

/** Role in a message */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Content types that can be in a message */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'audio'; url: string; mimeType?: string }
  | { type: 'file'; url: string; mimeType?: string };

/**
 * A single message in a completion request.
 * Supports text, images, audio, and files for multimodal models.
 */
export interface ModelMessage {
  role: MessageRole;

  /** Simple text content (shorthand) */
  content: string;

  /** Rich content with multiple parts (for multimodal) */
  parts?: ContentPart[];

  /** Tool call ID (for tool responses) */
  toolCallId?: string;

  /** Tool calls requested by the assistant (for multi-turn tool-calling history) */
  toolCalls?: ToolCall[];
}

/**
 * Model capabilities — what a provider/model can actually do.
 * This allows the runtime to route requests to capable models.
 */
export interface ModelCapabilities {
  /** Supports text completion */
  chat: boolean;

  /** Supports embeddings */
  embeddings: boolean;

  /** Supports image input (vision) */
  vision: boolean;

  /** Supports audio input */
  audio: boolean;

  /** Supports function/tool calling */
  toolCalling: boolean;

  /** Supports structured output (JSON mode) */
  structuredOutput: boolean;

  /** Supports streaming responses */
  streaming: boolean;

  /** Maximum context window (tokens) */
  maxContextTokens: number;

  /** Maximum output tokens */
  maxOutputTokens: number;
}

/**
 * Request to a model provider
 */
export interface CompletionRequest {
  /** Messages to send */
  messages: ModelMessage[];

  /** Which model to use (provider-specific identifier) */
  model: string;

  /** Temperature (0-2, lower = more deterministic) */
  temperature?: number;

  /** Maximum tokens in the response */
  maxTokens?: number;

  /** Stop sequences */
  stopSequences?: string[];

  /** Force JSON output (if supported) */
  jsonMode?: boolean;

  /** Tools available for the model to call */
  tools?: ToolSpec[];

  /** Request metadata for tracking */
  metadata?: {
    intentId?: NexusId;
    agentId?: NexusId;
    purpose?: ModelPurpose;
  };
}

/**
 * Tool specification for function calling.
 * Sent to the model so it knows which tools are available.
 */
export interface ToolSpec {
  /** Tool name (must be unique in a request) */
  name: string;

  /** What this tool does (helps the model decide when to use it) */
  description: string;

  /** Input parameters (JSON Schema format) */
  parameters: Record<string, unknown>;
}

/**
 * A tool call requested by the model
 */
export interface ToolCall {
  /** Tool call ID (for matching responses) */
  id: string;

  /** Which tool to call */
  name: string;

  /** Arguments (parsed JSON from the model) */
  arguments: Record<string, unknown>;
}

/**
 * Response from a model provider
 */
export interface CompletionResponse {
  /** The generated content (empty if tool_call) */
  content: string;

  /** Which model actually responded */
  model: string;

  /** Which provider handled it */
  provider: ModelProviderId;

  /** Token usage */
  usage: TokenUsage;

  /** Tool calls requested by the model (if any) */
  toolCalls?: ToolCall[];

  /** Response metadata */
  metadata: {
    /** Latency in ms */
    latencyMs: number;

    /** Provider-specific response ID */
    responseId?: string;

    /** Finish reason */
    finishReason: 'stop' | 'length' | 'error' | 'tool_call';
  };
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  /** Tokens in the prompt */
  promptTokens: number;

  /** Tokens in the response */
  completionTokens: number;

  /** Total tokens */
  totalTokens: number;

  /** Estimated cost in USD (if available) */
  estimatedCostUsd?: number;
}

/**
 * Provider configuration — can be defined entirely in config files.
 * This is how new providers get added WITHOUT code changes.
 */
export interface ProviderConfig {
  /** Unique identifier for this provider instance */
  id: string;

  /** Human-readable name */
  name: string;

  /** API format this provider uses */
  adapter: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';

  /** API base URL */
  baseUrl: string;

  /** Environment variable name for the API key */
  apiKeyEnv?: string;

  /** Static API key (prefer apiKeyEnv for security) */
  apiKey?: string;

  /** Default model identifier */
  defaultModel: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Custom headers to include in requests */
  headers?: Record<string, string>;

  /** Declared capabilities */
  capabilities?: Partial<ModelCapabilities>;

  /** Whether this provider is enabled */
  enabled?: boolean;
}

/**
 * Model routing configuration
 * Determines which provider/model to use for different purposes
 */
export interface ModelRoutingConfig {
  /** Default provider and model */
  default: {
    provider: ModelProviderId;
    model: string;
  };

  /** Fallback if default fails */
  fallback?: {
    provider: ModelProviderId;
    model: string;
  };

  /** Purpose-specific overrides */
  overrides?: Partial<Record<ModelPurpose, {
    provider: ModelProviderId;
    model: string;
  }>>;
}
