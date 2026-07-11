/**
 * Kernova Mock Model Provider
 *
 * A test-friendly model provider that returns canned responses.
 * Useful for:
 * - Unit testing agents without hitting real APIs
 * - Simulating specific model behaviors (failures, latency)
 * - Deterministic testing of agent logic
 */

import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  MockProviderConfig,
} from '@kernova/types';
import type { ModelProvider } from '../models/provider.js';
import { generateId, now } from '../utils.js';

export class MockModelProvider implements ModelProvider {
  readonly id = 'mock';
  readonly name = 'Mock Provider';

  private responses: Map<string, string> = new Map();
  private defaultResponse: string;
  private latencyMs: number;
  private shouldFail: boolean;
  private failureMessage: string;
  private callLog: Array<{ request: CompletionRequest; timestamp: string }> = [];

  constructor(config: MockProviderConfig = {}) {
    this.defaultResponse = config.defaultResponse ?? 'This is a mock response.';
    this.latencyMs = config.latencyMs ?? 0;
    this.shouldFail = config.shouldFail ?? false;
    this.failureMessage = config.failureMessage ?? 'Mock provider simulated failure';

    if (config.responses) {
      for (const [pattern, response] of Object.entries(config.responses)) {
        this.responses.set(pattern, response);
      }
    }
  }

  isAvailable(): boolean {
    return true;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.callLog.push({ request, timestamp: now() });

    // Simulate latency
    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }

    // Simulate failure
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    // Find matching response
    const content = this.findResponse(request);
    const promptTokens = Math.ceil(JSON.stringify(request.messages).length / 4);
    const completionTokens = Math.ceil(content.length / 4);

    return {
      content,
      provider: 'mock',
      model: request.model || 'mock-model',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      metadata: {
        finishReason: 'stop',
        latencyMs: this.latencyMs,
        responseId: generateId('mock'),
      },
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    this.callLog.push({ request, timestamp: now() });

    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const content = this.findResponse(request);
    const words = content.split(' ');

    for (let i = 0; i < words.length; i++) {
      yield {
        content: (i > 0 ? ' ' : '') + words[i],
        done: false,
        provider: 'mock',
        model: request.model || 'mock-model',
      };
    }

    yield {
      content: '',
      done: true,
      provider: 'mock',
      model: request.model || 'mock-model',
      finishReason: 'stop',
      usage: {
        promptTokens: Math.ceil(JSON.stringify(request.messages).length / 4),
        completionTokens: Math.ceil(content.length / 4),
        totalTokens: Math.ceil(JSON.stringify(request.messages).length / 4) + Math.ceil(content.length / 4),
      },
    };
  }

  async embed(text: string): Promise<number[]> {
    // Return a deterministic embedding based on text hash
    const embedding: number[] = [];
    for (let i = 0; i < 384; i++) {
      // Simple deterministic pseudo-random based on text + index
      const seed = text.charCodeAt(i % text.length) + i;
      embedding.push(Math.sin(seed) * 0.5);
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / norm);
  }

  // ─── Test Helpers ──────────────────────────────────────────

  /**
   * Add a canned response for a specific pattern.
   * The pattern is matched against the last user message content.
   */
  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }

  /**
   * Set the default response for unmatched patterns.
   */
  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  /**
   * Configure the mock to simulate failures.
   */
  setFailure(shouldFail: boolean, message?: string): void {
    this.shouldFail = shouldFail;
    if (message) this.failureMessage = message;
  }

  /**
   * Configure simulated latency.
   */
  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  /**
   * Get the history of calls made to this provider.
   */
  getCallLog(): Array<{ request: CompletionRequest; timestamp: string }> {
    return [...this.callLog];
  }

  /**
   * Get the number of calls made.
   */
  get callCount(): number {
    return this.callLog.length;
  }

  /**
   * Clear the call log.
   */
  clearLog(): void {
    this.callLog = [];
  }

  /**
   * Reset the provider to default state.
   */
  reset(): void {
    this.callLog = [];
    this.responses.clear();
    this.shouldFail = false;
    this.latencyMs = 0;
    this.defaultResponse = 'This is a mock response.';
  }

  // ─── Private ───────────────────────────────────────────────

  private findResponse(request: CompletionRequest): string {
    // Get the last user message content for pattern matching
    const lastUserMsg = [...request.messages]
      .reverse()
      .find(m => m.role === 'user');

    if (!lastUserMsg) return this.defaultResponse;

    const content = lastUserMsg.content;

    // Check each pattern (supports substring and regex)
    for (const [pattern, response] of this.responses) {
      // Try as regex first
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(content)) return response;
      } catch {
        // Not a valid regex — try as substring
        if (content.toLowerCase().includes(pattern.toLowerCase())) {
          return response;
        }
      }
    }

    return this.defaultResponse;
  }
}
