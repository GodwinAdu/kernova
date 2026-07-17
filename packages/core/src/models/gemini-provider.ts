/**
 * Google Gemini Model Provider
 * 
 * Implements the ModelProvider interface for Google's Gemini API.
 * Supports Gemini 2.0 Flash, Gemini 1.5 Pro, etc.
 * 
 * Gemini uses a different API format from OpenAI, so it needs its own provider.
 * 
 * Configuration:
 *   Set GEMINI_API_KEY environment variable or pass apiKey in config.
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

export interface GeminiConfig {
  /** API key (defaults to GEMINI_API_KEY env var) */
  apiKey?: string;

  /** Default model */
  defaultModel?: string;

  /** Request timeout in ms */
  timeoutMs?: number;
}

export class GeminiProvider implements ModelProvider {
  readonly id: ModelProviderId = 'custom'; // 'gemini' maps to custom in our type
  readonly name = 'Google Gemini';

  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: GeminiConfig = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    this.defaultModel = config.defaultModel || 'gemini-2.0-flash';
    this.timeoutMs = config.timeoutMs || 30000;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error(
        'Gemini provider not available. Set GEMINI_API_KEY environment variable.'
      );
    }

    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    // Convert messages to Gemini format
    const systemInstruction = request.messages.find(m => m.role === 'system');
    const contents = request.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        // Handle tool result messages
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'function' as const,
            parts: [{
              functionResponse: {
                name: m.toolCallId,
                response: { content: m.content },
              },
            }],
          };
        }
        // Handle assistant messages with tool calls
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'model' as const,
            parts: m.toolCalls.map(tc => ({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            })),
          };
        }
        return {
          role: m.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        };
      });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        ...(request.stopSequences?.length && { stopSequences: request.stopSequences }),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    // Add tools (Gemini function calling format)
    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Gemini API error (${response.status}): ${error}`
        );
      }

      const data = await response.json() as GeminiResponse;
      const latencyMs = Date.now() - startTime;

      // Extract content from response
      const parts = data.candidates?.[0]?.content?.parts || [];

      // Separate text and function calls
      const textParts = parts.filter((p: any) => p.text);
      const functionCallParts = parts.filter((p: any) => p.functionCall);

      const content = textParts.map((p: any) => p.text).join('') ?? '';

      // Parse tool calls from function call parts
      const toolCalls = functionCallParts.map((p: any) => ({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args || {},
      }));

      const usage: TokenUsage = {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      };

      return {
        content,
        model,
        provider: this.id,
        usage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        metadata: {
          latencyMs,
          responseId: undefined,
          finishReason: mapFinishReason(data.candidates?.[0]?.finishReason),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    if (!this.isAvailable()) {
      throw new Error('Gemini provider not available. Set GEMINI_API_KEY environment variable.');
    }

    const model = request.model || this.defaultModel;

    // Build the same body as complete()
    const systemInstruction = request.messages.find(m => m.role === 'system');
    const contents = request.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool' && m.toolCallId) {
          return {
            role: 'function' as const,
            parts: [{
              functionResponse: {
                name: m.toolCallId,
                response: { content: m.content },
              },
            }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'model' as const,
            parts: m.toolCalls.map(tc => ({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            })),
          };
        }
        return {
          role: m.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        };
      });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        ...(request.stopSequences?.length && { stopSequences: request.stopSequences }),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    // Use streamGenerateContent endpoint with alt=sse
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini streaming error (${response.status}): ${error}`);
    }

    if (!response.body) {
      // Fallback: call complete() and yield the result as a single chunk
      const result = await this.complete(request);
      yield { content: result.content, done: false, provider: this.id, model };
      yield { content: '', done: true, provider: this.id, model, finishReason: 'stop', usage: result.usage };
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
          const data = trimmed.slice(6).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;

            if (text) {
              yield { content: text, done: false, provider: this.id, model };
            }

            const finishReason = parsed.candidates?.[0]?.finishReason;
            if (finishReason) {
              const usage = parsed.usageMetadata ? {
                promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                totalTokens: parsed.usageMetadata.totalTokenCount || 0,
              } : undefined;
              yield { content: '', done: true, provider: this.id, model, finishReason: mapFinishReason(finishReason), usage };
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
    yield { content: '', done: true, provider: this.id, model, finishReason: 'stop' };
  }

  async embed(text: string): Promise<number[]> {
    if (!this.isAvailable()) {
      throw new Error('Gemini provider not available. Set GEMINI_API_KEY environment variable.');
    }

    const url = `${this.baseUrl}/models/text-embedding-004:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini embedding error (${response.status}): ${error}`);
    }

    const data = await response.json() as GeminiEmbeddingResponse;
    return data.embedding.values;
  }
}

function mapFinishReason(reason?: string): 'stop' | 'length' | 'error' {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'error';
    default: return 'stop';
  }
}

/** Gemini API response types */
interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text?: string;
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
      }>;
      role: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiEmbeddingResponse {
  embedding: {
    values: number[];
  };
}
