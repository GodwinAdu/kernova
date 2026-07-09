/**
 * Nexus Model Router
 * 
 * The intelligence layer that decides which model provider handles a request.
 * Supports:
 * - Default provider selection
 * - Fallback chains (if primary fails, try secondary)
 * - Purpose-based routing (use different models for different tasks)
 * - Token tracking across all requests
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ModelProviderId,
  ModelRoutingConfig,
  ModelPurpose,
  TokenUsage,
  StreamChunk,
  NexusId,
} from '@nexus/types';
import type { ModelProvider } from './provider.js';
import { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface ModelRouterConfig {
  routing: ModelRoutingConfig;
  providers: ModelProvider[];
  eventBus?: EventBus;
}

export class ModelRouter {
  private providers: Map<ModelProviderId, ModelProvider> = new Map();
  private routing: ModelRoutingConfig;
  private eventBus?: EventBus;

  /** Cumulative token usage across all requests */
  private totalUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };

  /** Total requests processed */
  private requestCount = 0;

  constructor(config: ModelRouterConfig) {
    this.routing = config.routing;
    this.eventBus = config.eventBus;

    for (const provider of config.providers) {
      this.providers.set(provider.id, provider);
    }
  }

  /**
   * Route a completion request to the appropriate provider.
   * Handles fallback if the primary provider fails.
   */
  async complete(
    request: CompletionRequest,
    purpose?: ModelPurpose,
  ): Promise<CompletionResponse> {
    // Determine which provider/model to use
    const target = this.resolveTarget(purpose);
    const primaryProvider = this.providers.get(target.provider);

    if (!primaryProvider) {
      throw new Error(
        `Model provider "${target.provider}" not registered. ` +
        `Available: ${Array.from(this.providers.keys()).join(', ')}`
      );
    }

    // Set the model on the request
    const fullRequest: CompletionRequest = {
      ...request,
      model: request.model || target.model,
    };

    // Try primary provider
    try {
      const response = await primaryProvider.complete(fullRequest);
      this.trackUsage(response, purpose);
      return response;
    } catch (primaryError) {
      // Try fallback if configured
      if (this.routing.fallback) {
        const fallbackProvider = this.providers.get(this.routing.fallback.provider);

        if (fallbackProvider && fallbackProvider.isAvailable()) {
          const fallbackRequest: CompletionRequest = {
            ...fullRequest,
            model: this.routing.fallback.model,
          };

          this.emitEvent('model.fallback', {
            primaryProvider: target.provider,
            fallbackProvider: this.routing.fallback.provider,
            reason: (primaryError as Error).message,
          });

          try {
            const response = await fallbackProvider.complete(fallbackRequest);
            this.trackUsage(response, purpose);
            return response;
          } catch (fallbackError) {
            throw new Error(
              `Both primary (${target.provider}) and fallback (${this.routing.fallback.provider}) failed. ` +
              `Primary: ${(primaryError as Error).message}. ` +
              `Fallback: ${(fallbackError as Error).message}`
            );
          }
        }
      }

      throw primaryError;
    }
  }

  /**
   * Stream a completion response token-by-token.
   * If the provider doesn't support streaming, simulates with a single chunk.
   */
  async *stream(
    request: CompletionRequest,
    purpose?: ModelPurpose,
  ): AsyncGenerator<StreamChunk> {
    const target = this.resolveTarget(purpose);
    const provider = this.providers.get(target.provider);

    if (!provider) {
      throw new Error(`Model provider "${target.provider}" not registered.`);
    }

    const fullRequest: CompletionRequest = {
      ...request,
      model: request.model || target.model,
    };

    // If provider supports streaming, use it
    if (provider.stream) {
      let totalContent = '';
      for await (const chunk of provider.stream(fullRequest)) {
        totalContent += chunk.content;
        yield chunk;

        // Track usage from final chunk
        if (chunk.done && chunk.usage) {
          this.requestCount++;
          this.totalUsage.promptTokens += chunk.usage.promptTokens;
          this.totalUsage.completionTokens += chunk.usage.completionTokens;
          this.totalUsage.totalTokens += chunk.usage.totalTokens;
        }
      }
      return;
    }

    // Fallback: simulate streaming with complete()
    const response = await provider.complete(fullRequest);
    this.trackUsage(response, purpose);

    // Yield content in chunks (simulate streaming)
    const words = response.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      const isLast = i === words.length - 1;
      yield {
        content: (i > 0 ? ' ' : '') + words[i],
        done: false,
        provider: response.provider,
        model: response.model,
      };
    }

    // Final chunk with usage
    yield {
      content: '',
      done: true,
      provider: response.provider,
      model: response.model,
      finishReason: response.metadata.finishReason,
      usage: response.usage,
    };
  }

  /**
   * Generate embeddings using available provider
   */
  async embed(text: string): Promise<number[]> {
    // Find a provider that supports embeddings
    for (const provider of this.providers.values()) {
      if (provider.embed && provider.isAvailable()) {
        return provider.embed(text);
      }
    }

    throw new Error('No embedding-capable provider available.');
  }

  /**
   * Register a new provider at runtime
   */
  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, p]) => p.isAvailable())
      .map(([id]) => id);
  }

  /**
   * Get cumulative usage statistics
   */
  getUsageStats(): { usage: TokenUsage; requestCount: number } {
    return {
      usage: { ...this.totalUsage },
      requestCount: this.requestCount,
    };
  }

  /** Resolve which provider/model to use */
  private resolveTarget(purpose?: ModelPurpose): { provider: ModelProviderId; model: string } {
    // Check purpose-specific override
    if (purpose && this.routing.overrides?.[purpose]) {
      return this.routing.overrides[purpose]!;
    }

    // Use default
    return this.routing.default;
  }

  /** Track token usage */
  private trackUsage(response: CompletionResponse, purpose?: ModelPurpose): void {
    this.requestCount++;
    this.totalUsage.promptTokens += response.usage.promptTokens;
    this.totalUsage.completionTokens += response.usage.completionTokens;
    this.totalUsage.totalTokens += response.usage.totalTokens;

    if (response.usage.estimatedCostUsd) {
      this.totalUsage.estimatedCostUsd =
        (this.totalUsage.estimatedCostUsd || 0) + response.usage.estimatedCostUsd;
    }

    this.emitEvent('model.completed', {
      provider: response.provider,
      model: response.model,
      purpose,
      tokens: response.usage.totalTokens,
      latencyMs: response.metadata.latencyMs,
    });
  }

  /** Emit event through event bus */
  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    if (!this.eventBus) return;

    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'model',
      severity: 'info',
      timestamp: now(),
      subjectId: 'model-router',
      subjectType: 'model',
      actorId: 'model-router',
      correlationId: (data.intentId as string) || generateId('cor'),
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'model-router',
        environment: 'development',
      },
    });
  }
}
