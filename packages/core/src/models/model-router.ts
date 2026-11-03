/**
 * Kernova Model Router
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
  ModelInfo,
  ModelProviderId,
  ModelRoutingConfig,
  ModelPurpose,
  TokenUsage,
  StreamChunk,
  KernovaId,
} from '@kernova/types';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelProvider } from './provider.js';
import { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

/** The usage totals of the ModelRouter.measureUsage() scopes a model call is running in (outermost first) */
const usageScope = new AsyncLocalStorage<TokenUsage[]>();

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
    purpose ??= request.metadata?.purpose as ModelPurpose | undefined;

    // Determine which provider/model to use
    const target = this.resolveTarget(purpose, request.provider);
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
    purpose ??= request.metadata?.purpose as ModelPurpose | undefined;
    const target = this.resolveTarget(purpose, request.provider);
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
      for await (const chunk of provider.stream(fullRequest)) {
        // Track usage from the final chunk before handing it on
        if (chunk.done) {
          this.recordUsage(
            chunk.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            chunk.provider ?? target.provider,
            chunk.model ?? fullRequest.model,
            purpose,
          );
        }
        yield chunk;
      }
      return;
    }

    // Fallback: simulate streaming with complete()
    const response = await provider.complete(fullRequest);
    this.trackUsage(response, purpose);

    if (response.reasoning) {
      yield { content: '', reasoning: response.reasoning, done: false, provider: response.provider, model: response.model };
    }

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
      toolCalls: response.toolCalls,
      ...(response.providerData && { providerData: response.providerData }),
    };
  }

  /**
   * Generate embeddings using available provider
   */
  async embed(text: string): Promise<number[]> {
    // Try each provider that can embed; some implement embed() but don't support it
    let lastError: Error | undefined;
    for (const provider of this.providers.values()) {
      if (!provider.embed || !provider.isAvailable()) continue;
      try {
        return await provider.embed(text);
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw lastError ?? new Error('No embedding-capable provider available.');
  }

  /**
   * Embed several texts with the first provider that can, batched where the provider supports it.
   * Returns one vector per text, in order.
   */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    let lastError: Error | undefined;
    for (const provider of this.providers.values()) {
      if (!provider.isAvailable() || (!provider.embedMany && !provider.embed)) continue;
      try {
        if (provider.embedMany) return await provider.embedMany(texts);
        const vectors: number[][] = [];
        for (const text of texts) vectors.push(await provider.embed!(text));
        return vectors;
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw lastError ?? new Error('No embedding-capable provider available.');
  }

  /**
   * The models a provider offers, as its API reports them. Without a provider, the models of
   * every available provider that can list them (providers whose listing fails are left out).
   */
  async listModels(provider?: ModelProviderId): Promise<ModelInfo[]> {
    if (provider) {
      const target = this.providers.get(provider);
      if (!target) {
        throw new Error(`Model provider "${provider}" not registered. Available: ${Array.from(this.providers.keys()).join(', ')}`);
      }
      if (!target.listModels) throw new Error(`${target.name} can't list its models.`);
      return target.listModels();
    }

    const listings = await Promise.allSettled(
      [...this.providers.values()]
        .filter(p => p.isAvailable() && p.listModels)
        .map(p => p.listModels!()),
    );
    return listings.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
  }

  /**
   * Run `fn` and report the tokens used by every model call it makes, including
   * calls in nested async work. Concurrent scopes are counted separately; a scope
   * nested inside another counts toward both.
   */
  async measureUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: TokenUsage }> {
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const result = await usageScope.run([...(usageScope.getStore() ?? []), usage], fn);
    return { result, usage };
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
  private resolveTarget(
    purpose?: ModelPurpose,
    provider?: ModelProviderId,
  ): { provider: ModelProviderId; model: string } {
    // A request that names a provider goes there (an empty model means that provider's default)
    if (provider) return { provider, model: '' };

    // Check purpose-specific override
    if (purpose && this.routing.overrides?.[purpose]) {
      return this.routing.overrides[purpose]!;
    }

    // Use default
    return this.routing.default;
  }

  /** Track token usage */
  private trackUsage(response: CompletionResponse, purpose?: ModelPurpose): void {
    this.recordUsage(response.usage, response.provider, response.model, purpose, response.metadata.latencyMs);
  }

  private recordUsage(
    usage: TokenUsage,
    provider: ModelProviderId,
    model: string,
    purpose?: ModelPurpose,
    latencyMs?: number,
  ): void {
    this.requestCount++;
    for (const totals of [this.totalUsage, ...(usageScope.getStore() ?? [])]) {
      totals.promptTokens += usage.promptTokens;
      totals.completionTokens += usage.completionTokens;
      totals.totalTokens += usage.totalTokens;
      for (const key of ['cachedTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
        if (usage[key]) totals[key] = (totals[key] ?? 0) + usage[key]!;
      }
      if (usage.estimatedCostUsd) {
        totals.estimatedCostUsd = (totals.estimatedCostUsd || 0) + usage.estimatedCostUsd;
      }
    }

    this.emitEvent('model.completed', {
      provider,
      model,
      purpose,
      tokens: usage.totalTokens,
      latencyMs,
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
