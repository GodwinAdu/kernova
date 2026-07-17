/**
 * Anthropic Model Provider
 * 
 * Implements the ModelProvider interface for Anthropic's Claude API.
 * Supports Claude 3.5 Sonnet, Claude 3 Opus, Haiku, etc.
 * 
 * Note: Tool calling (function calling) is supported by Anthropic's API but
 * uses a different format from OpenAI. For v0.1, tool calling works via
 * the OpenAI-compatible path. Anthropic native tool calling will be added in v0.2.
 * 
 * Configuration:
 *   Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.
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

export interface AnthropicConfig {
  /** API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;

  /** Base URL (defaults to https://api.anthropic.com) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Request timeout in ms */
  timeoutMs?: number;
}

export class AnthropicProvider implements ModelProvider {
  readonly id: ModelProviderId = 'anthropic';
  readonly name = 'Anthropic';

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: AnthropicConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.defaultModel = config.defaultModel || 'claude-sonnet-4-20250514';
    this.timeoutMs = config.timeoutMs || 60000;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error(
        'Anthropic provider not available. Set ANTHROPIC_API_KEY environment variable.'
      );
    }

    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    // Anthropic uses a separate system parameter, not in messages
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages: nonSystemMessages.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.toolCallId
          ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
          : m.content,
      })),
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    // Add tool definitions (Anthropic format)
    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Anthropic API error (${response.status}): ${error}`
        );
      }

      const data = await response.json() as AnthropicResponse;
      const latencyMs = Date.now() - startTime;

      // Extract text from content blocks
      const content = data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      // Extract tool calls
      const toolCalls: ToolCall[] | undefined = data.content
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          id: block.id || '',
          name: block.name || '',
          arguments: block.input || {},
        }));

      const usage: TokenUsage = {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      };

      return {
        content,
        model: data.model || model,
        provider: 'anthropic',
        usage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        metadata: {
          latencyMs,
          responseId: data.id,
          finishReason: mapStopReason(data.stop_reason),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    if (!this.isAvailable()) {
      throw new Error('Anthropic provider not available. Set ANTHROPIC_API_KEY environment variable.');
    }

    const model = request.model || this.defaultModel;

    // Build the same body as complete() but with stream: true
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
      messages: nonSystemMessages.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.toolCallId
          ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
          : m.content,
      })),
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic streaming error (${response.status}): ${error}`);
    }

    if (!response.body) {
      // Fallback: call complete() and yield the result as a single chunk
      const result = await this.complete(request);
      yield { content: result.content, done: false, provider: 'anthropic', model };
      yield { content: '', done: true, provider: 'anthropic', model, finishReason: 'stop', usage: result.usage };
      return;
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
            yield { content: '', done: true, provider: 'anthropic', model, finishReason: 'stop' };
            return;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              yield { content: parsed.delta.text, done: false, provider: 'anthropic', model };
            }

            if (parsed.type === 'message_delta') {
              const finishReason = mapStopReason(parsed.delta?.stop_reason);
              const usage = parsed.usage ? {
                promptTokens: parsed.usage.input_tokens || 0,
                completionTokens: parsed.usage.output_tokens || 0,
                totalTokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0),
              } : undefined;
              yield { content: '', done: true, provider: 'anthropic', model, finishReason, usage };
              return;
            }

            if (parsed.type === 'message_stop') {
              yield { content: '', done: true, provider: 'anthropic', model, finishReason: 'stop' };
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
    yield { content: '', done: true, provider: 'anthropic', model, finishReason: 'stop' };
  }
}

/** Map Anthropic stop reason to our standard */
function mapStopReason(reason?: string): 'stop' | 'length' | 'error' | 'tool_call' {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'stop_sequence': return 'stop';
    case 'max_tokens': return 'length';
    case 'tool_use': return 'tool_call';
    default: return 'stop';
  }
}

/** Anthropic API response types */
interface AnthropicResponse {
  id: string;
  model: string;
  content: Array<{
    type: string;
    text: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}
