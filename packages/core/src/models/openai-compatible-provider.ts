/**
 * OpenAI-Compatible Model Provider
 * 
 * Many AI providers implement the OpenAI chat completions API format:
 * - DeepSeek
 * - Groq
 * - Together AI
 * - Mistral
 * - Perplexity
 * - OpenRouter
 * - Fireworks AI
 * - Any local server (LM Studio, vLLM, etc.)
 * 
 * This single provider covers ALL of them. Just change the baseUrl and apiKey.
 * 
 * Configuration:
 *   const deepseek = new OpenAICompatibleProvider({
 *     id: 'deepseek',
 *     name: 'DeepSeek',
 *     baseUrl: 'https://api.deepseek.com/v1',
 *     apiKey: process.env.DEEPSEEK_API_KEY,
 *     defaultModel: 'deepseek-chat',
 *   });
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ModelProviderId,
  TokenUsage,
  StreamChunk,
} from '@kernova/types';
import type { ModelProvider } from './provider.js';

export interface OpenAICompatibleConfig {
  /** Provider identifier (used in routing) */
  id: string;

  /** Human-readable name */
  name: string;

  /** API base URL (the endpoint that serves /chat/completions) */
  baseUrl: string;

  /** API key */
  apiKey?: string;

  /** Default model identifier */
  defaultModel: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Custom headers (some providers need extra headers) */
  headers?: Record<string, string>;

  /** Whether this provider supports embeddings */
  supportsEmbeddings?: boolean;

  /** Embedding model (if different from chat model) */
  embeddingModel?: string;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: ModelProviderId;
  readonly name: string;

  private baseUrl: string;
  private apiKey: string;
  private defaultModel: string;
  private timeoutMs: number;
  private customHeaders: Record<string, string>;
  private supportsEmbeddings: boolean;
  private embeddingModel: string;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id as ModelProviderId;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Strip trailing slash
    this.apiKey = config.apiKey || '';
    this.defaultModel = config.defaultModel;
    this.timeoutMs = config.timeoutMs || 30000;
    this.customHeaders = config.headers || {};
    this.supportsEmbeddings = config.supportsEmbeddings || false;
    this.embeddingModel = config.embeddingModel || 'text-embedding-3-small';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error(
        `${this.name} provider not available. API key not configured.`
      );
    }

    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    const body = {
      model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.stopSequences?.length && { stop: request.stopSequences }),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.customHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `${this.name} API error (${response.status}): ${error}`
        );
      }

      const data = await response.json() as OpenAIStyleResponse;
      const latencyMs = Date.now() - startTime;

      const usage: TokenUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };

      return {
        content: data.choices[0]?.message?.content ?? '',
        model: data.model || model,
        provider: this.id,
        usage,
        metadata: {
          latencyMs,
          responseId: data.id,
          finishReason: mapFinishReason(data.choices[0]?.finish_reason),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    if (!this.isAvailable()) {
      throw new Error(`${this.name} provider not available. API key not configured.`);
    }

    const model = request.model || this.defaultModel;

    const body = {
      model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
      ...(request.stopSequences?.length && { stop: request.stopSequences }),
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.customHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} streaming error (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true, provider: this.id, model, finishReason: 'stop' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (delta?.content) {
              yield { content: delta.content, done: false, provider: this.id, model };
            }

            if (finishReason) {
              yield { content: '', done: true, provider: this.id, model, finishReason: mapFinishReason(finishReason) };
              return;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: '', done: true, provider: this.id, model, finishReason: 'stop' };
  }

  async embed(text: string): Promise<number[]> {
    if (!this.supportsEmbeddings) {
      throw new Error(`${this.name} does not support embeddings.`);
    }

    if (!this.isAvailable()) {
      throw new Error(`${this.name} provider not available. API key not configured.`);
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.customHeaders,
      },
      body: JSON.stringify({
        model: this.embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} embedding error (${response.status}): ${error}`);
    }

    const data = await response.json() as OpenAIStyleEmbeddingResponse;
    return data.data[0].embedding;
  }
}

function mapFinishReason(reason?: string): 'stop' | 'length' | 'error' {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    default: return 'stop';
  }
}

interface OpenAIStyleResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStyleEmbeddingResponse {
  data: Array<{
    embedding: number[];
  }>;
}
