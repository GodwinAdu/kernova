/**
 * Ollama Model Provider
 *
 * Implements the ModelProvider interface for Ollama (local models).
 * Supports any model available through Ollama: Llama, Qwen, Gemma, Mistral, gpt-oss, DeepSeek, etc.,
 * with tool calling, images, thinking, JSON and schema output, streaming, embeddings, and model listing.
 *
 * Ollama runs locally — no API key needed, no data leaves your machine.
 * This makes it ideal for development, privacy-sensitive workloads, and offline use.
 *
 * Prerequisites:
 *   Install Ollama: https://ollama.com
 *   Pull a model: ollama pull llama3.1
 *
 * Configuration:
 *   const ollama = new OllamaProvider({ defaultModel: 'llama3.1' });
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  ModelMessage,
  ModelProviderId,
  ReasoningOptions,
  TokenUsage,
  ToolCall,
  StreamChunk,
} from '@kernova/types';
import type { ModelProvider } from './provider.js';
import {
  apiError,
  DEFAULT_MAX_TOKENS,
  jsonFormatOf,
  nearestEffort,
  parseDataUri,
  parseJsonContent,
  REASONING_MAX_TOKENS,
  withoutSchemaKeyword,
} from './http.js';

export interface OllamaConfig {
  /** Ollama server URL (defaults to OLLAMA_HOST, then http://localhost:11434) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Embedding model, e.g. nomic-embed-text (defaults to the default model) */
  embeddingModel?: string;

  /** Request timeout in ms (local models can be slow on first load) */
  timeoutMs?: number;
}

function defaultBaseUrl(): string {
  const host = process.env.OLLAMA_HOST;
  if (!host) return 'http://localhost:11434';
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}

export class OllamaProvider implements ModelProvider {
  readonly id: ModelProviderId = 'ollama';
  readonly name = 'Ollama (Local)';

  private baseUrl: string;
  readonly defaultModel: string;
  private embeddingModel: string;
  private timeoutMs: number;
  private available: boolean | null = null;

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = (config.baseUrl || defaultBaseUrl()).replace(/\/$/, '');
    this.defaultModel = config.defaultModel || 'llama3.1';
    this.embeddingModel = config.embeddingModel || this.defaultModel;
    this.timeoutMs = config.timeoutMs || 120000; // Local models can be slow to load
  }

  isAvailable(): boolean {
    // Optimistic — we'll check on first call
    // Can't do async check in sync method, so assume true if not explicitly false
    return this.available !== false;
  }

  private buildBody(request: CompletionRequest, model: string, stream: boolean): Record<string, unknown> {
    const format = jsonFormatOf(request);
    const think = ollamaThink(model, request.reasoning);
    const body: Record<string, unknown> = {
      model,
      messages: toOllamaMessages(request.messages),
      stream,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? (think ? REASONING_MAX_TOKENS : DEFAULT_MAX_TOKENS),
        ...(request.stopSequences?.length && { stop: request.stopSequences }),
      },
      ...(format && { format: format.type === 'json_schema' ? withoutSchemaKeyword(format.schema) : 'json' }),
      ...(think !== undefined && { think }),
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
    return body;
  }

  private notFound(model: string): Error {
    return new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildBody(request, model, false)),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 404) throw this.notFound(model);
        throw await apiError('Ollama error', response);
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

      const content = data.message?.content ?? '';
      const reasoning = data.message?.thinking;

      return {
        content,
        model: data.model || model,
        provider: 'ollama',
        usage,
        toolCalls,
        ...(reasoning && { reasoning }),
        ...(jsonFormatOf(request) && { parsed: parseJsonContent(content) }),
        metadata: {
          latencyMs,
          responseId: undefined,
          finishReason: toolCalls?.length ? 'tool_call' : data.done_reason === 'length' ? 'length' : 'stop',
        },
      };
    } catch (error) {
      throw this.connectionError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Marks Ollama unavailable and explains how to start it when the server isn't running */
  private connectionError(error: unknown): unknown {
    const err = error as Error & { cause?: { code?: string } };
    if (err.message?.includes('ECONNREFUSED') || err.cause?.code === 'ECONNREFUSED') {
      this.available = false;
      return new Error('Ollama is not running. Start it with: ollama serve');
    }
    return error;
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const model = request.model || this.defaultModel;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildBody(request, model, true)),
      });
    } catch (error) {
      throw this.connectionError(error);
    }

    if (!response.ok) {
      if (response.status === 404) throw this.notFound(model);
      throw await apiError('Ollama streaming error', response);
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
    const toolCalls: ToolCall[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let parsed: OllamaResponse & { error?: string };
          try {
            parsed = JSON.parse(line);
          } catch {
            continue; // Skip malformed JSON lines
          }

          if (parsed.error) throw new Error(`Ollama streaming error: ${parsed.error}`);

          if (parsed.message?.thinking) {
            yield { content: '', reasoning: parsed.message.thinking, done: false, provider: 'ollama', model };
          }
          if (parsed.message?.content) {
            yield { content: parsed.message.content, done: false, provider: 'ollama', model };
          }
          for (const tc of parsed.message?.tool_calls ?? []) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: tc.function.name,
              arguments: tc.function.arguments || {},
            });
          }

          if (parsed.done) {
            const usage = parsed.eval_count ? {
              promptTokens: parsed.prompt_eval_count || 0,
              completionTokens: parsed.eval_count || 0,
              totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
            } : undefined;
            yield {
              content: '',
              done: true,
              provider: 'ollama',
              model,
              finishReason: toolCalls.length ? 'tool_call' : parsed.done_reason === 'length' ? 'length' : 'stop',
              usage,
              toolCalls: toolCalls.length ? toolCalls : undefined,
            };
            return;
          }
        }
      }
    } catch (error) {
      throw this.connectionError(error);
    } finally {
      reader.releaseLock();
    }

    // Final chunk if not already sent
    yield {
      content: '',
      done: true,
      provider: 'ollama',
      model,
      finishReason: toolCalls.length ? 'tool_call' : 'stop',
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text]);
    return vector;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, input: texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(error => { throw this.connectionError(error); });

    if (!response.ok) {
      if (response.status === 404) throw this.notFound(this.embeddingModel);
      throw await apiError('Ollama embedding error', response);
    }

    const data = await response.json() as OllamaEmbeddingResponse;
    return data.embeddings;
  }

  /** Models pulled to this Ollama server */
  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) })
      .catch(error => { throw this.connectionError(error); });
    if (!response.ok) throw await apiError('Ollama model list error', response);
    this.available = true;

    const data = await response.json() as {
      models?: Array<{ name: string; model?: string; modified_at?: string; details?: { family?: string; parameter_size?: string } }>;
    };
    return (data.models ?? []).map(m => ({
      id: m.model ?? m.name,
      provider: this.id,
      name: [m.name, m.details?.parameter_size].filter(Boolean).join(' '),
      ...(m.modified_at && { createdAt: m.modified_at }),
    }));
  }
}

/**
 * Ollama's `think` setting: gpt-oss takes a level (low, medium, high); other thinking
 * models take true or false
 */
export function ollamaThink(model: string, reasoning: ReasoningOptions | undefined): boolean | string | undefined {
  if (!reasoning) return undefined;
  const { effort } = reasoning;
  if (effort === 'none') return false;
  if (effort && /gpt-oss/i.test(model)) return nearestEffort(effort, ['low', 'medium', 'high'] as const);
  if (effort || reasoning.budgetTokens !== undefined || reasoning.includeThoughts) return true;
  return undefined;
}

/** Ollama API response types */
interface OllamaResponse {
  model: string;
  message?: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbeddingResponse {
  embeddings: number[][];
}

/** Converts messages to Ollama's chat format: images go in `images` (base64), tool results name their tool */
function toOllamaMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const toolNames = new Map<string, string>();
  return messages.map(m => {
    const parts = m.parts ?? [];
    for (const p of parts) {
      if (p.type === 'audio' || p.type === 'file') {
        throw new Error(`Ollama accepts text and images, not ${p.type} input`);
      }
    }
    const images = parts
      .filter(p => p.type === 'image')
      .map(p => {
        const data = parseDataUri(p.url)?.data;
        if (!data) throw new Error('Ollama needs images as data: URIs (base64), not URLs');
        return data;
      });
    const text = m.content || parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
    for (const tc of m.toolCalls ?? []) toolNames.set(tc.id, tc.name);

    return {
      role: m.role,
      content: text,
      ...(images.length > 0 && { images }),
      ...(m.toolCallId && { tool_call_id: m.toolCallId, tool_name: toolNames.get(m.toolCallId) }),
      ...(m.toolCalls?.length && {
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }),
    };
  });
}
