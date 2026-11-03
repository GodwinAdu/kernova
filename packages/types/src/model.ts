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

import type { KernovaId, Confidence, Timestamp } from './base.js';

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

/**
 * Content types that can be in a message. `url` is an http(s) URL or a `data:` URI
 * (base64). Providers that need the bytes themselves (most audio and file inputs) need a data URI.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'audio'; url: string; mimeType?: string }
  | { type: 'file'; url: string; mimeType?: string; filename?: string };

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

  /**
   * Data from an assistant turn that its provider needs back on the next request (for example
   * Claude's signed thinking blocks during tool use). Copy it from CompletionResponse.providerData.
   */
  providerData?: Record<string, unknown>;
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

  /** Supports reasoning / thinking controls */
  reasoning?: boolean;

  /** Supports file inputs (e.g. PDF) */
  files?: boolean;

  /** Supports prompt caching */
  promptCaching?: boolean;
}

/**
 * How much a reasoning model thinks before answering, from least to most. Each provider maps it
 * to its own setting; a level a model doesn't have becomes the nearest one it does
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Reasoning controls for models that think before answering */
export interface ReasoningOptions {
  /** Thinking depth: OpenAI reasoning_effort, Claude effort, Gemini thinkingLevel, Ollama think */
  effort?: ReasoningEffort;

  /**
   * Token budget for thinking, for models that take one: Gemini thinkingBudget, Claude before 4.6
   * (budget_tokens), OpenRouter, Qwen. Takes precedence over effort there; models that only take
   * an effort level (Claude 4.6 and later) get the level closest to the budget
   */
  budgetTokens?: number;

  /**
   * Ask for the model's reasoning (thinking text or a summary) in the response: Gemini's thought
   * summaries need this. Providers that always send their reasoning return it either way
   */
  includeThoughts?: boolean;
}

/** The shape of the answer */
export type ResponseFormat =
  | { type: 'text' }
  /** Any JSON object */
  | { type: 'json' }
  /** JSON matching a JSON Schema */
  | { type: 'json_schema'; schema: Record<string, unknown>; name?: string; strict?: boolean };

/** A model a provider offers, as reported by its model list */
export interface ModelInfo {
  /** Model ID to use in requests */
  id: string;

  /** Provider that serves it */
  provider: ModelProviderId;

  /** Display name */
  name?: string;

  /** Context window (tokens), when the provider reports it */
  contextWindow?: number;

  /** Maximum output tokens, when the provider reports it */
  maxOutputTokens?: number;

  /** What the provider reports the model can do (a missing field means unknown) */
  capabilities?: Partial<ModelCapabilities>;

  /** When the model was created or released, when reported */
  createdAt?: string;
}

/**
 * Request to a model provider
 */
export interface CompletionRequest {
  /** Messages to send */
  messages: ModelMessage[];

  /** Which model to use (provider-specific identifier). Empty means the provider's default */
  model: string;

  /** Which provider to send the request to, by ID (default: the router's routing for the purpose) */
  provider?: string;

  /** Temperature (0-2, lower = more deterministic) */
  temperature?: number;

  /** Maximum tokens in the response */
  maxTokens?: number;

  /** Stop sequences */
  stopSequences?: string[];

  /** Force JSON output (same as responseFormat: { type: 'json' }) */
  jsonMode?: boolean;

  /** Ask for JSON, optionally matching a schema. The parsed value is returned in `parsed` */
  responseFormat?: ResponseFormat;

  /** Reasoning controls for models that think before answering */
  reasoning?: ReasoningOptions;

  /**
   * Prompt caching: mark the stable start of the prompt (system prompt, tools, earlier turns)
   * as cacheable. Claude and Bedrock need this; OpenAI and Gemini cache automatically.
   */
  cache?: boolean;

  /** Tools available for the model to call */
  tools?: ToolSpec[];

  /** Request metadata for tracking */
  metadata?: {
    intentId?: KernovaId;
    agentId?: KernovaId;
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

  /** Provider-specific data that must be sent back with this call (e.g. Gemini thought signatures) */
  metadata?: Record<string, unknown>;
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

  /** The model's reasoning (thinking text or summary), when the provider returns it */
  reasoning?: string;

  /** With a JSON responseFormat: the parsed content (undefined when it isn't valid JSON) */
  parsed?: unknown;

  /** Data to send back with this assistant turn on the next request (copy to ModelMessage.providerData) */
  providerData?: Record<string, unknown>;

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

  /** Prompt tokens read from the provider's prompt cache (included in promptTokens) */
  cachedTokens?: number;

  /** Prompt tokens written to the prompt cache (included in promptTokens) */
  cacheWriteTokens?: number;

  /** Output tokens spent on reasoning (included in completionTokens) */
  reasoningTokens?: number;

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
  adapter: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'azure' | 'bedrock' | 'vertex' | 'custom';

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

  /**
   * Adapter-specific settings. azure: { endpoint, apiVersion? }; bedrock: { region, profile? };
   * vertex: { project, location?, keyFile? }. See each provider's config for the full list.
   */
  options?: Record<string, unknown>;

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
