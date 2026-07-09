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
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

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

      // Extract text from response
      const content = data.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        .join('') ?? '';

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
      parts: Array<{ text: string }>;
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
