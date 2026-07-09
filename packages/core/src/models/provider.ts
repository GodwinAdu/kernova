/**
 * Model Provider Interface
 * 
 * Pillar: Reasoning — "How should we think?"
 * 
 * This is the abstract contract that all model providers implement.
 * The runtime interacts with this interface — never directly with
 * provider-specific APIs.
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ModelProviderId,
  StreamChunk,
} from '@nexus/types';

/**
 * Abstract model provider interface.
 * Every provider (OpenAI, Anthropic, Ollama) implements this.
 */
export interface ModelProvider {
  /** Provider identifier */
  readonly id: ModelProviderId;

  /** Human-readable name */
  readonly name: string;

  /** Whether this provider is currently available */
  isAvailable(): boolean;

  /**
   * Send a completion request to the model
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Stream a completion response token-by-token.
   * Returns an async generator yielding chunks.
   * Optional — if not implemented, ModelRouter will simulate with complete().
   */
  stream?(request: CompletionRequest): AsyncGenerator<StreamChunk>;

  /**
   * Generate embeddings for text (optional — not all providers support this)
   */
  embed?(text: string): Promise<number[]>;
}

/**
 * Provider registration entry
 */
export interface ProviderRegistration {
  provider: ModelProvider;
  priority: number;
}
