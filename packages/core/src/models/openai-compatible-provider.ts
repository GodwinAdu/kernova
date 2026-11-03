/**
 * OpenAI-Compatible Model Provider
 *
 * Many AI providers implement the OpenAI chat completions API format:
 * DeepSeek, Groq, Together AI, Mistral, Perplexity, OpenRouter, Fireworks AI,
 * Hugging Face, NVIDIA NIM, Qwen (DashScope), Moonshot (Kimi), Z.ai (GLM),
 * and local servers (LM Studio, vLLM, llama.cpp).
 *
 * This single provider covers all of them: change the baseUrl and apiKey.
 * OpenAIProvider and AzureOpenAIProvider extend it.
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
  ContentPart,
  ModelInfo,
  ModelMessage,
  ModelProviderId,
  ReasoningEffort,
  ReasoningOptions,
  TokenUsage,
  StreamChunk,
  ToolCall,
  ToolSpec,
} from '@kernova/types';
import type { ModelProvider } from './provider.js';
import {
  apiError,
  DEFAULT_MAX_TOKENS,
  effortForBudget,
  extensionOf,
  fetchWithRetry,
  inBatches,
  jsonFormatOf,
  jsonInstruction,
  nearestEffort,
  parseJsonContent,
  parseToolArguments,
  readSSE,
  REASONING_MAX_TOKENS,
  requireDataUri,
  unixToIso,
  wantsReasoning,
  withoutSchemaKeyword,
} from './http.js';

/**
 * How an API takes reasoning settings:
 * - `reasoning_effort`: OpenAI style `reasoning_effort: 'low' | 'medium' | 'high' | ...` (default)
 * - `openrouter`: `reasoning: { effort }` or `reasoning: { max_tokens }`
 * - `qwen`: `enable_thinking` and `thinking_budget` (Qwen3 on DashScope)
 * - `zai`: `thinking: { type }` plus `reasoning_effort` (GLM; GLM-5.3 can't turn thinking off)
 * - `none`: the API has no reasoning settings; they're ignored
 */
export type ReasoningFormat = 'reasoning_effort' | 'openrouter' | 'qwen' | 'zai' | 'none';

/** GLM-5.3 always thinks and takes only these levels (glm-5.3-flash too) */
const GLM_53_EFFORTS = ['low', 'high', 'max'] as const;

export interface OpenAICompatibleConfig {
  /** Provider identifier (used in routing) */
  id: string;

  /** Human-readable name */
  name: string;

  /** API base URL (the endpoint that serves /chat/completions) */
  baseUrl: string;

  /** API key */
  apiKey?: string;

  /** Whether an API key is required (default: true). Local servers usually don't need one. */
  requiresApiKey?: boolean;

  /** Default model identifier */
  defaultModel: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for rate limits, transient server errors, and network failures (default: 2) */
  maxRetries?: number;

  /** Custom headers (some providers need extra headers) */
  headers?: Record<string, string>;

  /** Whether this provider supports embeddings */
  supportsEmbeddings?: boolean;

  /** Embedding model (if different from chat model) */
  embeddingModel?: string;

  /** How the API takes reasoning settings (default: `openrouter` for openrouter.ai, otherwise `reasoning_effort`) */
  reasoningFormat?: ReasoningFormat;

  /**
   * Send the model's reasoning back with assistant turns that called tools, as `reasoning_content`.
   * DeepSeek and Moonshot thinking models need this during tool use; other APIs may reject the field.
   */
  replayReasoning?: boolean;

  /** Ask for token usage in streamed responses (`stream_options.include_usage`); not every server accepts it */
  streamUsage?: boolean;

  /**
   * The effort levels the API accepts (e.g. `['low', 'high', 'max']` for Kimi K3). Other levels are
   * sent as the nearest accepted one. Default: any level is sent as is
   */
  reasoningEfforts?: ReasoningEffort[];

  /** Never send a temperature, for APIs with fixed sampling (Kimi K3 rejects any temperature but its own) */
  omitTemperature?: boolean;

  /** Request field for the output token limit (default: `max_tokens`) */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';

  /** Output token limit when a request doesn't set one (default: 4096, or 16384 when the request asks for reasoning) */
  defaultMaxTokens?: number;
}

/** Most texts sent to /embeddings in one request (OpenAI allows 2048; many compatible servers allow less) */
const DEFAULT_EMBEDDING_BATCH = 128;

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: ModelProviderId;
  readonly name: string;
  readonly defaultModel: string;

  protected baseUrl: string;
  protected apiKey: string;
  protected timeoutMs: number;
  protected maxRetries: number;
  protected customHeaders: Record<string, string>;
  protected supportsEmbeddings: boolean;
  protected embeddingModel: string;
  protected requiresApiKey: boolean;
  protected reasoningFormat: ReasoningFormat;
  protected replayReasoning: boolean;
  protected reasoningEfforts: ReasoningEffort[] | undefined;
  protected omitTemperature: boolean;
  protected defaultMaxTokens: number;

  /** Request field for the output token limit */
  protected maxTokensField: 'max_tokens' | 'max_completion_tokens' = 'max_tokens';

  /** Ask for token usage in streamed responses (not every compatible server accepts stream_options) */
  protected requestStreamUsage: boolean;

  /** Most texts per embeddings request */
  protected embeddingBatchSize = DEFAULT_EMBEDDING_BATCH;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id as ModelProviderId;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Strip trailing slash
    this.apiKey = config.apiKey || '';
    this.requiresApiKey = config.requiresApiKey ?? true;
    this.defaultModel = config.defaultModel;
    this.timeoutMs = config.timeoutMs || 30000;
    this.maxRetries = config.maxRetries ?? 2;
    this.customHeaders = config.headers || {};
    this.supportsEmbeddings = config.supportsEmbeddings || false;
    this.embeddingModel = config.embeddingModel || 'text-embedding-3-small';
    this.reasoningFormat = config.reasoningFormat
      ?? (/openrouter\.ai/i.test(this.baseUrl) ? 'openrouter' : 'reasoning_effort');
    this.replayReasoning = config.replayReasoning ?? false;
    this.requestStreamUsage = config.streamUsage ?? false;
    this.reasoningEfforts = config.reasoningEfforts?.length ? config.reasoningEfforts : undefined;
    this.omitTemperature = config.omitTemperature ?? false;
    if (config.maxTokensField) this.maxTokensField = config.maxTokensField;
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  }

  isAvailable(): boolean {
    return !this.requiresApiKey || this.apiKey.length > 0;
  }

  protected unavailableMessage(): string {
    return `${this.name} provider not available. API key not configured.`;
  }

  /** Sampling temperature to send, or undefined to leave it to the server */
  protected temperatureFor(_model: string, requested: number | undefined): number | undefined {
    if (this.omitTemperature) return undefined;
    return requested ?? 0.7;
  }

  /** Output token limit to send when the request doesn't set one */
  protected maxTokensFor(_model: string, request: CompletionRequest): number {
    return request.maxTokens ?? (wantsReasoning(request) ? Math.max(this.defaultMaxTokens, REASONING_MAX_TOKENS) : this.defaultMaxTokens);
  }

  /** The effort level to send: as asked, or the nearest level this API accepts */
  protected effortFor(effort: ReasoningEffort): ReasoningEffort {
    return this.reasoningEfforts ? nearestEffort(effort, this.reasoningEfforts) : effort;
  }

  /** URL of an API endpoint: `chat/completions`, `embeddings`, or `models` (for the given model or deployment) */
  protected endpoint(path: 'chat/completions' | 'embeddings' | 'models', _model?: string): string {
    return `${this.baseUrl}/${path}`;
  }

  protected async requestHeaders(): Promise<Record<string, string>> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      ...this.customHeaders,
    };
  }

  /** Request fields for reasoning settings, in this API's format */
  protected reasoningFields(reasoning: ReasoningOptions | undefined, model: string): Record<string, unknown> {
    if (!reasoning) return {};
    const { budgetTokens } = reasoning;
    // A budget given to an API that only takes levels becomes the closest level
    const effort = reasoning.effort ?? (budgetTokens !== undefined ? effortForBudget(budgetTokens) : undefined);
    switch (this.reasoningFormat) {
      case 'none':
        return {};
      case 'openrouter': {
        if (budgetTokens !== undefined) return { reasoning: { max_tokens: budgetTokens } };
        if (effort) return { reasoning: { effort: this.effortFor(effort) } };
        return reasoning.includeThoughts ? { reasoning: { enabled: true } } : {};
      }
      case 'qwen':
        if (reasoning.effort === undefined && budgetTokens === undefined) return {};
        return {
          enable_thinking: reasoning.effort !== 'none',
          ...(budgetTokens !== undefined && reasoning.effort !== 'none' && { thinking_budget: budgetTokens }),
        };
      case 'zai': {
        if (!effort) return {};
        // GLM-4.x only switches thinking on or off
        if (/glm-4/i.test(model)) return { thinking: { type: effort === 'none' ? 'disabled' : 'enabled' } };
        // GLM-5.3 always thinks; asking it not to fails the request
        if (/glm-5\.3/i.test(model)) {
          return { thinking: { type: 'enabled' }, reasoning_effort: nearestEffort(effort, GLM_53_EFFORTS) };
        }
        return effort === 'none'
          ? { thinking: { type: 'disabled' } }
          : { thinking: { type: 'enabled' }, reasoning_effort: this.effortFor(effort) };
      }
      default:
        return effort ? { reasoning_effort: this.effortFor(effort) } : {};
    }
  }

  protected buildBody(request: CompletionRequest, model: string, stream: boolean): Record<string, unknown> {
    const format = jsonFormatOf(request);
    let messages = toOpenAIMessages(request.messages, { providerId: this.id, providerName: this.name, replayReasoning: this.replayReasoning });

    // JSON mode needs the word "JSON" somewhere in the prompt (OpenAI rejects the request otherwise)
    if (format?.type === 'json' && !request.messages.some(m => /json/i.test(m.content ?? ''))) {
      messages = [{ role: 'system', content: jsonInstruction(format) }, ...messages];
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      [this.maxTokensField]: this.maxTokensFor(model, request),
      ...this.reasoningFields(request.reasoning, model),
    };

    const temperature = this.temperatureFor(model, request.temperature);
    if (temperature !== undefined) body.temperature = temperature;
    if (request.stopSequences?.length) body.stop = request.stopSequences;
    if (request.tools?.length) body.tools = toOpenAITools(request.tools);

    if (format?.type === 'json') {
      body.response_format = { type: 'json_object' };
    } else if (format?.type === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: format.name ?? 'response',
          schema: withoutSchemaKeyword(format.schema),
          ...(format.strict !== undefined && { strict: format.strict }),
        },
      };
    }

    if (stream) {
      body.stream = true;
      if (this.requestStreamUsage) body.stream_options = { include_usage: true };
    }
    return body;
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
      const response = await fetchWithRetry(this.endpoint('chat/completions', model), {
        method: 'POST',
        headers: await this.requestHeaders(),
        body: JSON.stringify(this.buildBody(request, model, false)),
        signal: controller.signal,
      }, this.maxRetries);

      if (!response.ok) {
        throw await apiError(`${this.name} API error`, response);
      }

      const data = await response.json() as OpenAIStyleResponse;
      const choice = data.choices?.[0];
      const message = choice?.message;

      const toolCalls: ToolCall[] | undefined = message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolArguments(tc.function.arguments),
      }));

      const content = message?.content ?? message?.refusal ?? '';
      const reasoning = message?.reasoning_content ?? message?.reasoning ?? undefined;
      const providerData = this.replayReasoning && reasoning && toolCalls?.length
        ? { [this.id]: { reasoning_content: reasoning } }
        : undefined;

      return {
        content,
        model: data.model || model,
        provider: this.id,
        usage: mapUsage(data.usage),
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        ...(reasoning && { reasoning }),
        ...(jsonFormatOf(request) && { parsed: parseJsonContent(content) }),
        ...(providerData && { providerData }),
        metadata: {
          latencyMs: Date.now() - startTime,
          responseId: data.id,
          finishReason: mapFinishReason(choice?.finish_reason),
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
      response = await fetchWithRetry(this.endpoint('chat/completions', model), {
        method: 'POST',
        headers: await this.requestHeaders(),
        body: JSON.stringify(this.buildBody(request, model, true)),
        signal: controller.signal,
      }, this.maxRetries);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await apiError(`${this.name} streaming error`, response);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;
    let reasoning = '';

    for await (const data of readSSE(response.body)) {
      if (data === '[DONE]') break;

      let parsed: StreamDelta;
      try {
        parsed = JSON.parse(data) as StreamDelta;
      } catch {
        continue; // Skip malformed lines
      }

      if (parsed.error) {
        throw new Error(`${this.name} streaming error: ${parsed.error.message ?? data}`);
      }

      const choice = parsed.choices?.[0];
      const thinking = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
      if (thinking) {
        reasoning += thinking;
        yield { content: '', reasoning: thinking, done: false, provider: this.id, model };
      }
      if (choice?.delta?.content) {
        yield { content: choice.delta.content, done: false, provider: this.id, model };
      }
      for (const delta of choice?.delta?.tool_calls ?? []) {
        const index = delta.index ?? toolCalls.size;
        const entry = toolCalls.get(index) ?? { id: '', name: '', args: '' };
        if (delta.id) entry.id = delta.id;
        if (delta.function?.name) entry.name ||= delta.function.name;
        if (delta.function?.arguments) entry.args += delta.function.arguments;
        toolCalls.set(index, entry);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      // Usage arrives in its own chunk after the finish reason
      if (parsed.usage) usage = mapUsage(parsed.usage);
    }

    yield {
      content: '',
      done: true,
      provider: this.id,
      model,
      finishReason: mapFinishReason(finishReason),
      usage,
      toolCalls: toolCalls.size > 0
        ? [...toolCalls.values()].map(tc => ({ id: tc.id, name: tc.name, arguments: parseToolArguments(tc.args) }))
        : undefined,
      ...(this.replayReasoning && reasoning && toolCalls.size > 0 && {
        providerData: { [this.id]: { reasoning_content: reasoning } },
      }),
    };
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text]);
    return vector;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.supportsEmbeddings) {
      throw new Error(`${this.name} does not support embeddings.`);
    }

    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }

    if (texts.length === 0) return [];

    return inBatches(texts, this.embeddingBatchSize, async batch => {
      const response = await fetchWithRetry(this.endpoint('embeddings', this.embeddingModel), {
        method: 'POST',
        headers: await this.requestHeaders(),
        body: JSON.stringify({ model: this.embeddingModel, input: batch }),
        signal: AbortSignal.timeout(this.timeoutMs),
      }, this.maxRetries);

      if (!response.ok) {
        throw await apiError(`${this.name} embedding error`, response);
      }

      const data = await response.json() as OpenAIStyleEmbeddingResponse;
      // Results carry their input index; don't rely on the order they arrive in
      return [...data.data]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(d => d.embedding);
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }

    const response = await fetchWithRetry(this.endpoint('models'), {
      method: 'GET',
      headers: await this.requestHeaders(),
      signal: AbortSignal.timeout(this.timeoutMs),
    }, this.maxRetries);

    if (!response.ok) {
      throw await apiError(`${this.name} model list error`, response);
    }

    const body = await response.json() as unknown;
    const list = Array.isArray(body)
      ? body
      : ((body as { data?: unknown[]; models?: unknown[] }).data ?? (body as { models?: unknown[] }).models ?? []);
    return list
      .filter((m): m is CompatibleModel => typeof (m as CompatibleModel)?.id === 'string')
      .map(m => toModelInfo(m, this.id));
  }
}

export interface OpenAIMessageOptions {
  /** Provider whose providerData to read (for reasoning replay) */
  providerId?: string;
  /** Provider name for error messages */
  providerName?: string;
  /** Send `reasoning_content` back on assistant turns that called tools */
  replayReasoning?: boolean;
}

/** Converts messages to the chat completions format, including images, audio, files, and tool calls. */
export function toOpenAIMessages(
  messages: ModelMessage[],
  options: OpenAIMessageOptions = {},
): Array<Record<string, unknown>> {
  const providerName = options.providerName ?? 'This provider';
  return messages.map(m => {
    const mapped: Record<string, unknown> = {
      role: m.role,
      content: m.parts?.length ? m.parts.map(p => toOpenAIPart(p, providerName)) : m.content,
    };
    if (m.toolCallId) mapped.tool_call_id = m.toolCallId;
    if (m.toolCalls?.length) {
      mapped.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
      const saved = options.providerId ? m.providerData?.[options.providerId] as { reasoning_content?: unknown } | undefined : undefined;
      if (options.replayReasoning && typeof saved?.reasoning_content === 'string') {
        mapped.reasoning_content = saved.reasoning_content;
      }
    }
    return mapped;
  });
}

function toOpenAIPart(part: ContentPart, providerName: string): Record<string, unknown> {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return { type: 'image_url', image_url: { url: part.url } };
    case 'audio': {
      const audio = requireDataUri(part, providerName);
      return { type: 'input_audio', input_audio: { data: audio.data, format: extensionOf(audio.mimeType) ?? 'wav' } };
    }
    case 'file': {
      const file = requireDataUri(part, providerName);
      return {
        type: 'file',
        file: { filename: part.filename ?? `file.${extensionOf(file.mimeType) ?? 'pdf'}`, file_data: part.url },
      };
    }
  }
}

function toOpenAITools(tools: ToolSpec[]): Array<Record<string, unknown>> {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function mapUsage(usage: OpenAIStyleUsage | undefined): TokenUsage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  // OpenAI reports cache hits in prompt_tokens_details; DeepSeek in prompt_cache_hit_tokens
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
    ...(cachedTokens ? { cachedTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
  };
}

function mapFinishReason(reason?: string | null): 'stop' | 'length' | 'error' | 'tool_call' {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls':
    case 'function_call': return 'tool_call';
    case 'content_filter': return 'error';
    default: return 'stop';
  }
}

/** A /models entry. Only `id` is standard; the rest are fields some providers add */
interface CompatibleModel {
  id: string;
  created?: number;
  name?: string;
  display_name?: string;
  type?: string;
  context_length?: number;
  context_window?: number;
  max_context_length?: number;
  max_model_len?: number;
  max_completion_tokens?: number;
  top_provider?: { context_length?: number; max_completion_tokens?: number };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
  capabilities?: { completion_chat?: boolean; function_calling?: boolean; vision?: boolean };
}

function toModelInfo(m: CompatibleModel, provider: ModelProviderId): ModelInfo {
  const contextWindow = m.context_length ?? m.context_window ?? m.max_context_length ?? m.max_model_len
    ?? m.top_provider?.context_length;
  const maxOutputTokens = m.top_provider?.max_completion_tokens ?? m.max_completion_tokens;
  const capabilities: ModelInfo['capabilities'] = {};

  const inputs = m.architecture?.input_modalities;
  if (inputs) {
    capabilities.vision = inputs.includes('image');
    capabilities.audio = inputs.includes('audio');
    capabilities.files = inputs.includes('file');
  }
  const params = m.supported_parameters;
  if (params) {
    capabilities.toolCalling = params.includes('tools');
    capabilities.reasoning = params.includes('reasoning') || params.includes('include_reasoning');
    capabilities.structuredOutput = params.includes('structured_outputs') || params.includes('response_format');
  }
  if (m.capabilities) {
    if (m.capabilities.completion_chat !== undefined) capabilities.chat = m.capabilities.completion_chat;
    if (m.capabilities.function_calling !== undefined) capabilities.toolCalling = m.capabilities.function_calling;
    if (m.capabilities.vision !== undefined) capabilities.vision = m.capabilities.vision;
  }
  if (m.type === 'chat' || m.type === 'language') capabilities.chat = true;
  if (m.type === 'embedding') {
    capabilities.embeddings = true;
    capabilities.chat = false;
  }

  return {
    id: m.id,
    provider,
    ...((m.display_name ?? m.name) && { name: m.display_name ?? m.name }),
    ...(contextWindow && { contextWindow }),
    ...(maxOutputTokens && { maxOutputTokens }),
    ...(Object.keys(capabilities).length > 0 && { capabilities }),
    ...(unixToIso(m.created) && { createdAt: unixToIso(m.created) }),
  };
}

interface OpenAIStyleUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_cache_hit_tokens?: number;
}

interface OpenAIStyleResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      refusal?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: OpenAIStyleUsage;
}

interface StreamDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: OpenAIStyleUsage;
  error?: { message?: string };
}

interface OpenAIStyleEmbeddingResponse {
  data: Array<{
    index?: number;
    embedding: number[];
  }>;
}
