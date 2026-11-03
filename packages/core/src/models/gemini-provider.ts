/**
 * Google Gemini Model Provider
 *
 * Implements the ModelProvider interface for Google's Gemini API, including
 * function calling, images, audio, video and PDF input, thinking, structured output,
 * streaming, batch embeddings, and model listing.
 *
 * Gemini uses a different API format from OpenAI, so it needs its own provider.
 * VertexAIProvider extends it with Vertex AI's endpoints and Google Cloud authentication.
 *
 * Configuration:
 *   Set GEMINI_API_KEY environment variable or pass apiKey in config.
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ContentPart,
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
  fetchWithRetry,
  inBatches,
  jsonFormatOf,
  joinSystemMessages,
  mimeTypeOf,
  nearestEffort,
  parseDataUri,
  parseJsonContent,
  readSSE,
  REASONING_MAX_TOKENS,
  wantsReasoning,
  withoutSchemaKeyword,
} from './http.js';

export interface GeminiConfig {
  /** API key (defaults to GEMINI_API_KEY env var) */
  apiKey?: string;

  /** Default model */
  defaultModel?: string;

  /** Embedding model (default: gemini-embedding-001) */
  embeddingModel?: string;

  /** API base URL (default: https://generativelanguage.googleapis.com/v1beta) */
  baseUrl?: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for rate limits, transient server errors, and network failures (default: 2) */
  maxRetries?: number;
}

/** Google-maintained alias for the current stable Flash model */
export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';

export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

/** Most texts in one batchEmbedContents request */
const EMBEDDING_BATCH = 100;

export class GeminiProvider implements ModelProvider {
  readonly id: ModelProviderId;
  readonly name: string;
  readonly defaultModel: string;

  protected apiKey: string;
  protected baseUrl: string;
  protected embeddingModel: string;
  protected timeoutMs: number;
  protected maxRetries: number;

  constructor(config: GeminiConfig = {}, identity: { id: ModelProviderId; name: string } = { id: 'gemini', name: 'Google Gemini' }) {
    this.id = identity.id;
    this.name = identity.name;
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    this.baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    this.defaultModel = config.defaultModel || GEMINI_DEFAULT_MODEL;
    this.embeddingModel = config.embeddingModel || GEMINI_EMBEDDING_MODEL;
    this.timeoutMs = config.timeoutMs || 30000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  protected unavailableMessage(): string {
    return 'Gemini provider not available. Set GEMINI_API_KEY environment variable.';
  }

  /** URL of a model method such as `generateContent` (accepts `models/...` and `tunedModels/...` names) */
  protected async modelUrl(model: string, method: string): Promise<string> {
    const path = model.includes('/') ? model : `models/${model}`;
    return `${this.baseUrl}/${path}:${method}`;
  }

  /** Authentication headers. The key goes in a header, not the URL, so it can't leak into logs or error messages */
  protected async authHeaders(): Promise<Record<string, string>> {
    return { 'x-goog-api-key': this.apiKey };
  }

  protected buildBody(request: CompletionRequest, model: string): Record<string, unknown> {
    const format = jsonFormatOf(request);
    const thinkingConfig = geminiThinking(model, request.reasoning);
    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? (wantsReasoning(request) ? REASONING_MAX_TOKENS : DEFAULT_MAX_TOKENS),
        ...(request.stopSequences?.length && { stopSequences: request.stopSequences }),
        ...(format && { responseMimeType: 'application/json' }),
        ...(format?.type === 'json_schema' && { responseJsonSchema: withoutSchemaKeyword(format.schema) }),
        ...(thinkingConfig && { thinkingConfig }),
      },
    };

    const system = joinSystemMessages(request.messages);
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }

    // parametersJsonSchema takes standard JSON Schema; the older `parameters` field
    // rejects common keywords such as additionalProperties and default
    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: { type: 'object', ...withoutSchemaKeyword(t.parameters ?? {}) },
        })),
      }];
    }

    return body;
  }

  protected async send(
    url: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    return fetchWithRetry(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()), ...extraHeaders },
      ...(body && { body: JSON.stringify(body) }),
      signal,
    }, this.maxRetries);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }

    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.send(
        await this.modelUrl(model, 'generateContent'),
        this.buildBody(request, model),
        controller.signal,
      );

      if (!response.ok) {
        throw await apiError(`${this.name} API error`, response);
      }

      const data = await response.json() as GeminiResponse;
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const toolCalls = parseFunctionCalls(parts);
      const content = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      const reasoning = parts.filter(p => p.text && p.thought).map(p => p.text).join('');

      return {
        content,
        model: data.modelVersion || model,
        provider: this.id,
        usage: mapUsage(data.usageMetadata),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ...(reasoning && { reasoning }),
        ...(jsonFormatOf(request) && { parsed: parseJsonContent(content) }),
        metadata: {
          latencyMs: Date.now() - startTime,
          responseId: data.responseId,
          finishReason: toolCalls.length > 0
            ? 'tool_call'
            : data.promptFeedback?.blockReason ? 'error' : mapFinishReason(candidate?.finishReason),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }

    const model = request.model || this.defaultModel;

    // The timeout covers getting a response; the stream itself may run longer
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.send(
        `${await this.modelUrl(model, 'streamGenerateContent')}?alt=sse`,
        this.buildBody(request, model),
        controller.signal,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await apiError(`${this.name} streaming error`, response);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const toolCalls: ToolCall[] = [];
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;

    for await (const data of readSSE(response.body)) {
      let parsed: GeminiResponse;
      try {
        parsed = JSON.parse(data) as GeminiResponse;
      } catch {
        continue; // Skip malformed lines
      }

      const candidate = parsed.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const thought = parts.filter(p => p.text && p.thought).map(p => p.text).join('');
      if (thought) {
        yield { content: '', reasoning: thought, done: false, provider: this.id, model };
      }
      const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      if (text) {
        yield { content: text, done: false, provider: this.id, model };
      }
      toolCalls.push(...parseFunctionCalls(parts));
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (parsed.usageMetadata) usage = mapUsage(parsed.usageMetadata);
    }

    yield {
      content: '',
      done: true,
      provider: this.id,
      model,
      finishReason: toolCalls.length > 0 ? 'tool_call' : mapFinishReason(finishReason),
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text]);
    return vector;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }
    if (texts.length === 0) return [];

    const model = this.embeddingModel.includes('/') ? this.embeddingModel : `models/${this.embeddingModel}`;
    return inBatches(texts, EMBEDDING_BATCH, async batch => {
      const response = await this.send(
        await this.modelUrl(this.embeddingModel, 'batchEmbedContents'),
        { requests: batch.map(text => ({ model, content: { parts: [{ text }] } })) },
        AbortSignal.timeout(this.timeoutMs),
      );

      if (!response.ok) {
        throw await apiError(`${this.name} embedding error`, response);
      }

      const data = await response.json() as { embeddings: Array<{ values: number[] }> };
      return data.embeddings.map(e => e.values);
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }

    const models: ModelInfo[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ pageSize: '1000', ...(pageToken && { pageToken }) });
      const response = await this.send(`${this.baseUrl}/models?${query}`, undefined, AbortSignal.timeout(this.timeoutMs));
      if (!response.ok) throw await apiError(`${this.name} model list error`, response);

      const page = await response.json() as GeminiModelPage;
      for (const m of page.models ?? []) {
        const methods = m.supportedGenerationMethods ?? [];
        models.push({
          id: m.name.replace(/^models\//, ''),
          provider: this.id,
          ...(m.displayName && { name: m.displayName }),
          ...(m.inputTokenLimit && { contextWindow: m.inputTokenLimit }),
          ...(m.outputTokenLimit && { maxOutputTokens: m.outputTokenLimit }),
          capabilities: {
            chat: methods.includes('generateContent'),
            embeddings: methods.includes('embedContent'),
            ...(m.thinking !== undefined && { reasoning: m.thinking }),
          },
        });
      }
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);

    return models;
  }
}

/**
 * The thinkingConfig for a model:
 * - `budgetTokens` sets thinkingBudget (Gemini 2.5; Gemini 3 still accepts it)
 * - an effort level becomes thinkingLevel on Gemini 3 and later, and a thinking budget on 2.5
 * - Gemini 2.0 and earlier don't think, so they get no thinkingConfig
 */
export function geminiThinking(model: string, reasoning: ReasoningOptions | undefined): Record<string, unknown> | undefined {
  if (!reasoning) return undefined;
  if (/gemini-(1\.|2\.0)/i.test(model)) return undefined;

  const config: Record<string, unknown> = {};
  if (reasoning.includeThoughts) config.includeThoughts = true;

  const pro = /pro/i.test(model);
  const { effort, budgetTokens } = reasoning;
  if (budgetTokens !== undefined) {
    config.thinkingBudget = budgetTokens;
  } else if (effort && /gemini-2\.5/i.test(model)) {
    // Pro can't turn thinking off (minimum 128) and allows up to 32768; Flash allows up to 24576
    const budgets = { none: 0, minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 32768, max: 32768 };
    const max = pro ? 32768 : 24576;
    config.thinkingBudget = Math.min(max, Math.max(pro ? 128 : 0, budgets[effort]));
  } else if (effort) {
    // Gemini 3 Pro takes low or high; Flash also takes minimal and medium. Thinking can't be turned off
    const level = pro
      ? nearestEffort(effort === 'none' ? 'low' : effort, ['low', 'high'] as const)
      : nearestEffort(effort === 'none' ? 'minimal' : effort, ['minimal', 'low', 'medium', 'high'] as const);
    config.thinkingLevel = level;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Converts messages to Gemini `contents`:
 * - assistant tool calls become `functionCall` parts (with their thought signatures)
 * - tool results become `functionResponse` parts named after the function they answer,
 *   all results for one turn in a single content
 * - images, audio, and files become inline data (data: URIs) or file references (URLs)
 */
export function toGeminiContents(messages: ModelMessage[]): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> {
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = [];
  const calls = new Map<string, ToolCall>();

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool' && m.toolCallId) {
      const call = calls.get(m.toolCallId);
      const part: GeminiPart = {
        functionResponse: {
          name: call?.name ?? m.toolCallId,
          response: { content: m.content },
          ...(call?.metadata?.geminiId ? { id: m.toolCallId } : {}),
        },
      };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every(p => p.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        calls.set(tc.id, tc);
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
            ...(tc.metadata?.geminiId ? { id: tc.id } : {}),
          },
          ...(typeof tc.metadata?.thoughtSignature === 'string' && { thoughtSignature: tc.metadata.thoughtSignature }),
        });
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }

    const parts = m.parts?.length ? m.parts.map(toGeminiPart) : m.content ? [{ text: m.content }] : [];
    if (parts.length > 0) contents.push({ role: 'user', parts });
  }

  return contents;
}

function toGeminiPart(part: ContentPart): GeminiPart {
  if (part.type === 'text') return { text: part.text };
  const inline = parseDataUri(part.url);
  if (inline) return { inlineData: { mimeType: inline.mimeType, data: inline.data } };
  return { fileData: { mimeType: mimeTypeOf(part), fileUri: part.url } };
}

function parseFunctionCalls(parts: GeminiPart[]): ToolCall[] {
  return parts
    .filter(p => p.functionCall)
    .map(p => ({
      id: p.functionCall!.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: p.functionCall!.name,
      arguments: p.functionCall!.args || {},
      metadata: {
        // Thought signatures must be sent back with the call, or later turns lose the model's reasoning
        ...(p.thoughtSignature && { thoughtSignature: p.thoughtSignature }),
        ...(p.functionCall!.id && { geminiId: true }),
      },
    }));
}

function mapUsage(usage: GeminiResponse['usageMetadata']): TokenUsage {
  const reasoningTokens = usage?.thoughtsTokenCount ?? 0;
  const cachedTokens = usage?.cachedContentTokenCount ?? 0;
  return {
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: (usage?.candidatesTokenCount ?? 0) + reasoningTokens,
    totalTokens: usage?.totalTokenCount ?? 0,
    ...(cachedTokens > 0 && { cachedTokens }),
    ...(reasoningTokens > 0 && { reasoningTokens }),
  };
}

function mapFinishReason(reason?: string): 'stop' | 'length' | 'error' {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'MALFORMED_FUNCTION_CALL': return 'error';
    default: return 'stop';
  }
}

/** Gemini API types (minimal) */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role: string;
    };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  responseId?: string;
}

interface GeminiModelPage {
  models?: Array<{
    name: string;
    displayName?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
    thinking?: boolean;
  }>;
  nextPageToken?: string;
}
