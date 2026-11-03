/**
 * Anthropic Model Provider
 *
 * Implements the ModelProvider interface for Anthropic's Messages API (Claude),
 * including native tool calling, images, PDF and text documents, extended thinking,
 * structured output, prompt caching, streaming, and model listing.
 *
 * Configuration:
 *   Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.
 *   ANTHROPIC_BASE_URL overrides the endpoint.
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
  ToolCall,
  StreamChunk,
} from '@kernova/types';
import type { ModelProvider } from './provider.js';
import {
  apiError,
  DEFAULT_MAX_TOKENS,
  effortForBudget,
  fetchWithRetry,
  jsonFormatOf,
  jsonInstruction,
  joinSystemMessages,
  mimeTypeOf,
  nearestEffort,
  parseDataUri,
  parseJsonContent,
  parseToolArguments,
  readSSE,
  REASONING_MAX_TOKENS,
  withoutSchemaKeyword,
} from './http.js';

export interface AnthropicConfig {
  /** API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;

  /** Base URL (defaults to ANTHROPIC_BASE_URL, then https://api.anthropic.com) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for rate limits, overload (529), transient server errors, and network failures (default: 2) */
  maxRetries?: number;
}

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';

/**
 * Thinking token budgets for an effort level, on models before Claude 4.6 (which take a budget).
 * With room for the answer, the largest stays within Claude Opus 4.1's 32,000 output tokens
 */
const EFFORT_BUDGET: Record<Exclude<ReasoningEffort, 'none'>, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 24576,
  max: 27648,
};

/** The effort levels Claude takes (output_config.effort); not every model has every level */
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** JSON Schema keywords Claude's structured output rejects; they're moved into the description */
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'maxItems', 'minProperties', 'maxProperties',
];

export class AnthropicProvider implements ModelProvider {
  readonly id: ModelProviderId = 'anthropic';
  readonly name = 'Anthropic';
  readonly defaultModel: string;

  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: AnthropicConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = (config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    this.defaultModel = config.defaultModel || ANTHROPIC_DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs || 60000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  private buildBody(request: CompletionRequest, model: string, stream: boolean): Record<string, unknown> {
    const thinking = anthropicThinking(model, request.reasoning);
    const format = jsonFormatOf(request);

    let maxTokens = request.maxTokens ?? (thinking.on ? REASONING_MAX_TOKENS : DEFAULT_MAX_TOKENS);
    if (thinking.budgetTokens !== undefined) {
      if (request.maxTokens === undefined) {
        maxTokens = Math.max(maxTokens, thinking.budgetTokens + 4096);
      } else if (request.maxTokens <= thinking.budgetTokens) {
        throw new Error(
          `maxTokens (${request.maxTokens}) must be greater than the thinking budget (${thinking.budgetTokens}) for Claude`,
        );
      }
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: toAnthropicMessages(request.messages, this.id),
    };

    // Anthropic takes system instructions as a separate parameter
    let system = joinSystemMessages(request.messages);
    if (format?.type === 'json') system = [system, jsonInstruction(format)].filter(Boolean).join('\n\n');
    if (system) body.system = system;

    if (thinking.thinking) body.thinking = thinking.thinking;

    const outputConfig: Record<string, unknown> = {};
    if (thinking.effort) outputConfig.effort = thinking.effort;
    if (format?.type === 'json_schema') {
      outputConfig.format = { type: 'json_schema', schema: claudeOutputSchema(withoutSchemaKeyword(format.schema)) };
    }
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;

    // Thinking doesn't allow changing the temperature
    if (request.temperature !== undefined && !thinking.on) {
      body.temperature = request.temperature;
    }

    if (request.stopSequences?.length) {
      body.stop_sequences = request.stopSequences;
    }

    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: { type: 'object', ...t.parameters },
      }));
    }

    if (request.cache) addCacheBreakpoints(body);
    if (stream) body.stream = true;
    return body;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private send(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    }, this.maxRetries);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error(
        'Anthropic provider not available. Set ANTHROPIC_API_KEY environment variable.'
      );
    }

    const model = request.model || this.defaultModel;
    const startTime = Date.now();
    const body = this.buildBody(request, model, false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.send(body, controller.signal);

      if (!response.ok) {
        throw await apiError('Anthropic API error', response);
      }

      const data = await response.json() as AnthropicResponse;
      const latencyMs = Date.now() - startTime;

      // Extract text from content blocks
      const content = data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      const reasoning = data.content
        .filter(block => block.type === 'thinking')
        .map(block => block.thinking)
        .join('');

      // Extract tool calls
      const toolCalls: ToolCall[] = data.content
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          id: block.id || '',
          name: block.name || '',
          arguments: block.input || {},
        }));

      // Signed thinking blocks must go back with the tool results, or the request is rejected
      const thinkingBlocks = data.content.filter(block => block.type === 'thinking' || block.type === 'redacted_thinking');

      return {
        content,
        model: data.model || model,
        provider: 'anthropic',
        usage: mapUsage(data.usage),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ...(reasoning && { reasoning }),
        ...(jsonFormatOf(request) && { parsed: parseJsonContent(content) }),
        ...(toolCalls.length > 0 && thinkingBlocks.length > 0 && {
          providerData: { [this.id]: { thinking: thinkingBlocks } },
        }),
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
    const body = this.buildBody(request, model, true);

    // The timeout covers getting a response; the stream itself may run longer
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.send(body, controller.signal);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await apiError('Anthropic streaming error', response);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    const thinkingBlocks = new Map<number, AnthropicBlock>();
    let usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };
    let stopReason: string | undefined;

    for await (const data of readSSE(response.body)) {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue; // Skip malformed lines
      }

      if (event.type === 'message_start') {
        // Input token counts are only reported here
        usage = mergeUsage(usage, event.message?.usage);
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        const index = event.index ?? 0;
        if (block?.type === 'tool_use') {
          toolBlocks.set(index, { id: block.id ?? '', name: block.name ?? '', json: '' });
        } else if (block?.type === 'thinking') {
          thinkingBlocks.set(index, { type: 'thinking', thinking: block.thinking ?? '', signature: block.signature ?? '' });
        } else if (block?.type === 'redacted_thinking') {
          thinkingBlocks.set(index, { type: 'redacted_thinking', data: block.data ?? '' });
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          yield { content: delta.text, done: false, provider: 'anthropic', model };
        } else if (delta?.type === 'input_json_delta') {
          const block = toolBlocks.get(event.index ?? -1);
          if (block) block.json += delta.partial_json ?? '';
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          const block = thinkingBlocks.get(event.index ?? -1);
          if (block) block.thinking = String(block.thinking ?? '') + delta.thinking;
          yield { content: '', reasoning: delta.thinking, done: false, provider: 'anthropic', model };
        } else if (delta?.type === 'signature_delta') {
          const block = thinkingBlocks.get(event.index ?? -1);
          if (block) block.signature = String(block.signature ?? '') + (delta.signature ?? '');
        }
      } else if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason ?? stopReason;
        // Output token counts here are cumulative
        usage = mergeUsage(usage, event.usage);
      } else if (event.type === 'error') {
        throw new Error(`Anthropic streaming error: ${event.error?.message ?? data}`);
      } else if (event.type === 'message_stop') {
        break;
      }
    }

    yield {
      content: '',
      done: true,
      provider: 'anthropic',
      model,
      finishReason: mapStopReason(stopReason),
      usage: mapUsage(usage),
      toolCalls: toolBlocks.size > 0
        ? [...toolBlocks.values()].map(b => ({ id: b.id, name: b.name, arguments: parseToolArguments(b.json) }))
        : undefined,
      ...(toolBlocks.size > 0 && thinkingBlocks.size > 0 && {
        providerData: {
          [this.id]: { thinking: [...thinkingBlocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block) },
        },
      }),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isAvailable()) {
      throw new Error('Anthropic provider not available. Set ANTHROPIC_API_KEY environment variable.');
    }

    const models: ModelInfo[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({ limit: '1000', ...(after && { after_id: after }) });
      const response = await fetchWithRetry(`${this.baseUrl}/v1/models?${query}`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      }, this.maxRetries);
      if (!response.ok) throw await apiError('Anthropic model list error', response);

      const page = await response.json() as AnthropicModelPage;
      for (const m of page.data ?? []) {
        if (m.lifecycle === 'retired') continue;
        const reported = m.capabilities ?? {};
        const supports = (key: string, fallback: boolean) => {
          const value = reported[key];
          if (typeof value === 'boolean') return value;
          if (value && typeof value === 'object' && typeof (value as { supported?: unknown }).supported === 'boolean') {
            return (value as { supported: boolean }).supported;
          }
          return fallback;
        };
        models.push({
          id: m.id,
          provider: this.id,
          ...(m.display_name && { name: m.display_name }),
          ...(m.max_input_tokens && { contextWindow: m.max_input_tokens }),
          ...(m.max_tokens && { maxOutputTokens: m.max_tokens }),
          capabilities: {
            chat: true,
            streaming: true,
            toolCalling: true,
            promptCaching: true,
            vision: supports('image_input', true),
            files: supports('pdf_input', true),
            structuredOutput: supports('structured_outputs', false),
            reasoning: supports('thinking', false),
          },
          ...(m.created_at && { createdAt: m.created_at }),
        });
      }
      after = page.has_more ? page.last_id : undefined;
    } while (after);

    return models;
  }
}

/**
 * The thinking settings for a model:
 * - Claude 4.6 and later think adaptively, with an effort level (`budgetTokens` becomes the
 *   closest level: Claude 4.7 and later reject token budgets). `none` turns thinking off
 * - earlier models take a token budget: `budgetTokens`, or the budget that matches the effort level
 *
 * `on` says whether the model will think (which rules out a custom temperature).
 */
export function anthropicThinking(
  model: string,
  reasoning: ReasoningOptions | undefined,
): { thinking?: Record<string, unknown>; effort?: string; budgetTokens?: number; on: boolean } {
  if (!reasoning) return { on: false };
  const { effort, budgetTokens } = reasoning;

  if (supportsAdaptiveThinking(model)) {
    const level = effort ?? (budgetTokens !== undefined ? effortForBudget(budgetTokens) : undefined);
    if (!level) return { on: false };
    if (level === 'none') return { thinking: { type: 'disabled' }, on: false };
    return { thinking: { type: 'adaptive' }, effort: nearestEffort(level, CLAUDE_EFFORTS), on: true };
  }

  if (budgetTokens !== undefined) {
    if (budgetTokens <= 0) return { on: false };
    const budget = Math.max(1024, budgetTokens);
    return { thinking: { type: 'enabled', budget_tokens: budget }, budgetTokens: budget, on: true };
  }
  if (!effort || effort === 'none') return { on: false };
  const budget = EFFORT_BUDGET[effort];
  return { thinking: { type: 'enabled', budget_tokens: budget }, budgetTokens: budget, on: true };
}

/** Claude 4.6 and later think adaptively; earlier models take a token budget. Unrecognized IDs count as new. */
export function supportsAdaptiveThinking(model: string): boolean {
  const match = /claude-(?:(?:opus|sonnet|haiku|fable)-)?(\d+)(?:[-.](\d{1,2})(?!\d))?/i.exec(model);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  return major > 4 || (major === 4 && minor >= 6);
}

/**
 * A JSON Schema in the form Claude's structured output accepts (as Anthropic's SDKs do it):
 * every object is closed (`additionalProperties: false`, the only value Claude accepts), and
 * constraints Claude rejects (minimum, maxLength, ...) move into the description so the model
 * still sees them.
 */
export function claudeOutputSchema(schema: unknown): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    const moved: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' || key === '$defs' || key === 'definitions') {
        out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, visit(v)]));
      } else if (['items', 'anyOf', 'allOf', 'oneOf', 'not', 'prefixItems'].includes(key)) {
        out[key] = visit(value);
      } else if (key === 'additionalProperties') {
        // Set below: Claude only accepts false
      } else if (UNSUPPORTED_SCHEMA_KEYWORDS.includes(key) || (key === 'minItems' && typeof value === 'number' && value > 1)) {
        moved.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        out[key] = value;
      }
    }
    if (moved.length > 0) {
      out.description = [out.description, `(${moved.join(', ')})`].filter(Boolean).join(' ');
    }
    const isObject = out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object')) || 'properties' in out;
    if (isObject) out.additionalProperties = false;
    return out;
  };
  return visit(schema) as Record<string, unknown>;
}

/** Marks the stable start of the prompt as cacheable: tools, the system prompt, and the conversation so far */
function addCacheBreakpoints(body: Record<string, unknown>): void {
  const marker = { type: 'ephemeral' };

  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (tools?.length) tools[tools.length - 1].cache_control = marker;

  if (typeof body.system === 'string') {
    body.system = [{ type: 'text', text: body.system, cache_control: marker }];
  }

  const messages = body.messages as Array<{ role: string; content: string | AnthropicBlock[] }>;
  const last = messages[messages.length - 1];
  if (!last) return;
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: marker }];
    return;
  }
  const block = [...last.content].reverse().find(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');
  if (block) block.cache_control = marker;
}

type AnthropicBlock = { type: string } & Record<string, unknown>;

/**
 * Converts messages to the Messages API format:
 * - an assistant turn that called tools carries its `tool_use` blocks, after the thinking
 *   blocks it was given (from providerData)
 * - tool results become `tool_result` blocks, all results for one turn in a single user message
 * - images become `image` blocks; PDF and text files become `document` blocks
 */
export function toAnthropicMessages(
  messages: ModelMessage[],
  providerId = 'anthropic',
): Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool' && m.toolCallId) {
      const block: AnthropicBlock = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '(no output)' };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(b => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      if (!m.toolCalls?.length) {
        if (m.content) out.push({ role: 'assistant', content: m.content });
        continue;
      }
      const saved = m.providerData?.[providerId] as { thinking?: AnthropicBlock[] } | undefined;
      const blocks: AnthropicBlock[] = Array.isArray(saved?.thinking) ? saved.thinking.map(b => ({ ...b })) : [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (m.parts?.length) {
      out.push({ role: 'user', content: m.parts.map(toAnthropicPart) });
    } else if (m.content) {
      out.push({ role: 'user', content: m.content });
    }
  }

  return out;
}

function toAnthropicPart(part: ContentPart): AnthropicBlock {
  if (part.type === 'text') return { type: 'text', text: part.text };
  const inline = parseDataUri(part.url);

  if (part.type === 'image') {
    return inline
      ? { type: 'image', source: { type: 'base64', media_type: inline.mimeType, data: inline.data } }
      : { type: 'image', source: { type: 'url', url: part.url } };
  }

  if (part.type === 'file') {
    const mimeType = mimeTypeOf(part);
    const title = part.filename ? { title: part.filename } : {};
    if (mimeType === 'application/pdf') {
      return inline
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: inline.data }, ...title }
        : { type: 'document', source: { type: 'url', url: part.url }, ...title };
    }
    if (mimeType.startsWith('text/') && inline) {
      const text = Buffer.from(inline.data, 'base64').toString('utf8');
      return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, ...title };
    }
    throw new Error(`Claude accepts PDF and plain-text files (as data: URIs or PDF URLs), not ${mimeType}`);
  }

  throw new Error('Claude does not accept audio input; transcribe it first');
}

/** Takes the counts an event reports, keeping earlier ones it leaves out */
function mergeUsage(current: AnthropicUsage, update: AnthropicUsage | undefined): AnthropicUsage {
  const merged = { ...current };
  for (const [key, value] of Object.entries(update ?? {})) {
    if (typeof value === 'number') merged[key as keyof AnthropicUsage] = value;
  }
  return merged;
}

function mapUsage(usage: AnthropicUsage | undefined): TokenUsage {
  // Cached input is reported separately from input_tokens; all of it counts toward the prompt
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const promptTokens = (usage?.input_tokens ?? 0) + cacheWrite + cacheRead;
  const completionTokens = usage?.output_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(cacheRead > 0 && { cachedTokens: cacheRead }),
    ...(cacheWrite > 0 && { cacheWriteTokens: cacheWrite }),
  };
}

/** Map Anthropic stop reason to our standard */
function mapStopReason(reason?: string): 'stop' | 'length' | 'error' | 'tool_call' {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'stop_sequence': return 'stop';
    case 'max_tokens': return 'length';
    case 'model_context_window_exceeded': return 'length';
    case 'tool_use': return 'tool_call';
    case 'refusal': return 'error';
    default: return 'stop';
  }
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Anthropic API response types */
interface AnthropicResponse {
  id: string;
  model: string;
  content: Array<{
    type: string;
    text: string;
    thinking?: string;
    signature?: string;
    data?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  usage?: AnthropicUsage;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: AnthropicUsage };
  content_block?: { type: string; id?: string; name?: string; thinking?: string; signature?: string; data?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
    signature?: string;
    stop_reason?: string;
  };
  usage?: AnthropicUsage;
  error?: { message?: string };
}

interface AnthropicModelPage {
  data?: Array<{
    id: string;
    display_name?: string;
    created_at?: string;
    lifecycle?: string;
    max_input_tokens?: number;
    max_tokens?: number;
    capabilities?: Record<string, unknown> | null;
  }>;
  has_more?: boolean;
  last_id?: string;
}
