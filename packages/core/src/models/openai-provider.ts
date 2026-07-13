/**
 * OpenAI Model Provider
 * 
 * Implements the ModelProvider interface for OpenAI's API.
 * Supports GPT-4o, GPT-4o-mini, and embedding models.
 * 
 * Configuration:
 *   Set OPENAI_API_KEY environment variable or pass apiKey in config.
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

export interface OpenAIConfig {
  /** API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;

  /** Base URL (defaults to https://api.openai.com/v1) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Request timeout in ms */
  timeoutMs?: number;
}

export class OpenAIProvider implements ModelProvider {
  readonly id: ModelProviderId = 'openai';
  readonly name = 'OpenAI';

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: OpenAIConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.defaultModel = config.defaultModel || 'gpt-4o';
    this.timeoutMs = config.timeoutMs || 60000;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error(
        'OpenAI provider not available. Set OPENAI_API_KEY environment variable.'
      );
    }

    const model = request.model || this.defaultModel;
    const startTime = Date.now();

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
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        }),
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.stopSequences?.length && { stop: request.stopSequences }),
    };

    // Add tool definitions if provided
    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      console.log('[Kernova:OpenAI] Sending tools:', JSON.stringify(body.tools, null, 2).slice(0, 500));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `OpenAI API error (${response.status}): ${error}`
        );
      }

      const data = await response.json() as OpenAIChatResponse;
      const latencyMs = Date.now() - startTime;

      console.log('[Kernova:OpenAI] Response finish_reason:', data.choices[0]?.finish_reason, 'tool_calls:', data.choices[0]?.message?.tool_calls?.length || 0);

      const usage: TokenUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };

      // Parse tool calls if present
      const toolCalls: ToolCall[] | undefined = data.choices[0]?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));

      if (toolCalls?.length) {
        console.debug(`[OpenAIProvider] Parsed ${toolCalls.length} tool calls: ${toolCalls.map(tc => tc.name).join(', ')}`);
      }

      return {
        content: data.choices[0]?.message?.content ?? '',
        model: data.model || model,
        provider: 'openai',
        usage,
        toolCalls,
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
      throw new Error('OpenAI provider not available. Set OPENAI_API_KEY environment variable.');
    }

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
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        }),
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
      ...(request.stopSequences?.length && { stop: request.stopSequences }),
    };

    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI streaming error (${response.status}): ${error}`);
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
            yield { content: '', done: true, provider: 'openai', model, finishReason: 'stop' };
            return;
          }

          try {
            const parsed = JSON.parse(data) as StreamDelta;
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (delta?.content) {
              yield { content: delta.content, done: false, provider: 'openai', model };
            }

            if (finishReason) {
              yield {
                content: '',
                done: true,
                provider: 'openai',
                model,
                finishReason: mapFinishReason(finishReason),
                usage: parsed.usage ? {
                  promptTokens: parsed.usage.prompt_tokens ?? 0,
                  completionTokens: parsed.usage.completion_tokens ?? 0,
                  totalTokens: parsed.usage.total_tokens ?? 0,
                } : undefined,
              };
              return;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Final chunk if not already sent
    yield { content: '', done: true, provider: 'openai', model, finishReason: 'stop' };
  }

  async embed(text: string): Promise<number[]> {
    if (!this.isAvailable()) {
      throw new Error(
        'OpenAI provider not available. Set OPENAI_API_KEY environment variable.'
      );
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding error (${response.status}): ${error}`);
    }

    const data = await response.json() as OpenAIEmbeddingResponse;
    return data.data[0].embedding;
  }
}

/** Map OpenAI finish reason to our standard */
function mapFinishReason(reason?: string): 'stop' | 'length' | 'error' | 'tool_call' {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_call';
    default: return 'stop';
  }
}

/** OpenAI API response types (minimal, not importing their SDK) */
interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
  }>;
}

interface StreamDelta {
  choices?: Array<{
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
