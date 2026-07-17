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
  ToolCall,
  StreamChunk,
} from '@kernova/types';
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
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
        ...(m.toolCalls?.length && {
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        }),
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
        ...(request.stopSequences?.length && { stop: request.stopSequences }),
      },
    };

    // Add tool definitions (OpenAI-compatible format since Ollama 0.3+)
    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

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

      // Parse tool calls if present
      const toolCalls: ToolCall[] | undefined = data.message?.tool_calls?.length
        ? data.message.tool_calls.map(tc => ({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: tc.function.name,
            arguments: tc.function.arguments || {},
          }))
        : undefined;

      return {
        content: data.message?.content ?? '',
        model: data.model || model,
        provider: 'ollama',
        usage,
        toolCalls,
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

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const model = request.model || this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
        ...(m.toolCalls?.length && {
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        }),
      })),
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
        ...(request.stopSequences?.length && { stop: request.stopSequences }),
      },
    };

    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
      }
      const error = await response.text();
      throw new Error(`Ollama streaming error (${response.status}): ${error}`);
    }

    if (!response.body) {
      // Fallback: call complete() and yield the result as a single chunk
      const result = await this.complete(request);
      yield { content: result.content, done: false, provider: 'ollama', model };
      yield { content: '', done: true, provider: 'ollama', model, finishReason: 'stop', usage: result.usage };
      return;
    }

    this.available = true;

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
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            if (parsed.message?.content) {
              yield { content: parsed.message.content, done: false, provider: 'ollama', model };
            }

            if (parsed.done) {
              const usage = parsed.eval_count ? {
                promptTokens: parsed.prompt_eval_count || 0,
                completionTokens: parsed.eval_count || 0,
                totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
              } : undefined;
              yield { content: '', done: true, provider: 'ollama', model, finishReason: 'stop', usage };
              return;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch (error) {
      if ((error as Error).message?.includes('ECONNREFUSED')) {
        this.available = false;
        throw new Error('Ollama is not running. Start it with: ollama serve');
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    // Final chunk if not already sent
    yield { content: '', done: true, provider: 'ollama', model, finishReason: 'stop' };
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
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbeddingResponse {
  embeddings: number[][];
}
