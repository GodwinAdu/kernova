/**
 * Ollama Model Provider
 * 
 * Implements the ModelProvider interface for Ollama (local models).
 * Supports any model available through Ollama: Llama, Mistral, Phi, etc.
 * 
 * Ollama runs locally — no API key needed, no data leaves your machine.
 * This makes it ideal for development, privacy-sensitive workloads, and offline use.
 * 
 * Prerequisites:
 *   Install Ollama: https://ollama.ai
 *   Pull a model: ollama pull llama3.1
 * 
 * Configuration:
 *   const ollama = new OllamaProvider({ defaultModel: 'llama3.1' });
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ModelProviderId,
  TokenUsage,
} from '@nexus/types';
import type { ModelProvider } from './provider.js';

export interface OllamaConfig {
  /** Ollama server URL (defaults to http://localhost:11434) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Request timeout in ms (local models can be slow on first load) */
  timeoutMs?: number;
}

export class OllamaProvider implements ModelProvider {
  readonly id: ModelProviderId = 'ollama';
  readonly name = 'Ollama (Local)';

  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;
  private available: boolean | null = null;

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.defaultModel = config.defaultModel || 'llama3.1';
    this.timeoutMs = config.timeoutMs || 120000; // Local models can be slow to load
  }

  isAvailable(): boolean {
    // Optimistic — we'll check on first call
    // Can't do async check in sync method, so assume true if not explicitly false
    return this.available !== false;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    // Ollama supports OpenAI-compatible chat endpoint
    const body = {
      model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
        ...(request.stopSequences?.length && { stop: request.stopSequences }),
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Model "${model}" not found. Run: ollama pull ${model}`
          );
        }
        const error = await response.text();
        throw new Error(`Ollama error (${response.status}): ${error}`);
      }

      const data = await response.json() as OllamaResponse;
      const latencyMs = Date.now() - startTime;

      this.available = true;

      const usage: TokenUsage = {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      };

      return {
        content: data.message?.content ?? '',
        model: data.model || model,
        provider: 'ollama',
        usage,
        metadata: {
          latencyMs,
          responseId: undefined,
          finishReason: data.done ? 'stop' : 'length',
        },
      };
    } catch (error) {
      if ((error as Error).message?.includes('ECONNREFUSED')) {
        this.available = false;
        throw new Error(
          'Ollama is not running. Start it with: ollama serve'
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.defaultModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding error (${response.status}): ${error}`);
    }

    const data = await response.json() as OllamaEmbeddingResponse;
    return data.embeddings[0];
  }
}

/** Ollama API response types */
interface OllamaResponse {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbeddingResponse {
  embeddings: number[][];
}
