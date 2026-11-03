/**
 * AWS Bedrock Model Provider
 *
 * Uses Bedrock's Converse API, which serves every Bedrock chat model in one format:
 * Claude, Amazon Nova, Llama, Mistral, DeepSeek, Qwen, OpenAI gpt-oss, Cohere, and more.
 * Supports tool calling, images and documents, reasoning, structured output, prompt
 * caching (cache points), streaming, embeddings (Titan and Cohere), and model listing.
 *
 * Authentication, first match wins:
 *   1. A Bedrock API key: `apiKey` or AWS_BEARER_TOKEN_BEDROCK
 *   2. AWS credentials (signed with SigV4): see AwsCredentialChain for where they're looked for
 *
 * Configuration:
 *   AWS_REGION=us-east-1
 *   AWS_BEARER_TOKEN_BEDROCK=...      (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or a profile)
 *
 * Model IDs are Bedrock model IDs or inference profile IDs, such as
 * `global.anthropic.claude-sonnet-4-5-20250929-v1:0` or `us.amazon.nova-pro-v1:0`.
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ContentPart,
  ModelInfo,
  ModelMessage,
  ModelProviderId,
  ReasoningOptions,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from '@kernova/types';
import type { ModelProvider } from './provider.js';
import { anthropicThinking } from './anthropic-provider.js';
import { AwsCredentialChain, resolveAwsRegion, type AwsCredentialsConfig } from './aws-credentials.js';
import { readEventStream } from './aws-eventstream.js';
import { signRequest } from './aws-sigv4.js';
import {
  apiError,
  DEFAULT_MAX_TOKENS,
  effortForBudget,
  fetchWithRetry,
  inBatches,
  jsonFormatOf,
  jsonInstruction,
  joinSystemMessages,
  mimeTypeOf,
  nearestEffort,
  parseDataUri,
  parseJsonContent,
  parseToolArguments,
  REASONING_MAX_TOKENS,
  wantsReasoning,
  withoutSchemaKeyword,
  type JsonFormat,
} from './http.js';

export interface BedrockConfig extends AwsCredentialsConfig {
  /** AWS region (defaults to AWS_REGION, AWS_DEFAULT_REGION, the profile's region, then us-east-1) */
  region?: string;

  /** Bedrock API key (defaults to AWS_BEARER_TOKEN_BEDROCK). Takes precedence over AWS credentials */
  apiKey?: string;

  /** Default model or inference profile ID */
  defaultModel?: string;

  /** Embedding model (default: amazon.titan-embed-text-v2:0; Cohere embed models work too) */
  embeddingModel?: string;

  /** Runtime endpoint override, e.g. a VPC endpoint (default: https://bedrock-runtime.{region}.amazonaws.com) */
  baseUrl?: string;

  /** Control plane endpoint override, used to list models (default: https://bedrock.{region}.amazonaws.com) */
  controlPlaneUrl?: string;

  /** Model-specific request fields sent with every request (Converse `additionalModelRequestFields`) */
  additionalModelRequestFields?: Record<string, unknown>;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for throttling, transient server errors, and network failures (default: 2) */
  maxRetries?: number;
}

/** Claude Sonnet 4.5 through global cross-Region inference */
export const BEDROCK_DEFAULT_MODEL = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

export const BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';

/** Name of the tool used to get JSON matching a schema from models without a JSON mode */
const RESPONSE_TOOL = 'json_response';

/** Model families whose Converse tool choice can name a specific tool */
const FORCED_TOOL_MODELS = /anthropic\.|claude|amazon\.nova|mistral\.mistral-large/i;

type Block = Record<string, unknown>;
type BedrockMessage = { role: 'user' | 'assistant'; content: Block[] };

export class BedrockProvider implements ModelProvider {
  readonly id: ModelProviderId = 'bedrock';
  readonly name = 'AWS Bedrock';
  readonly defaultModel: string;

  readonly region: string;
  private readonly apiKey: string;
  private readonly credentials: AwsCredentialChain;
  private readonly runtimeUrl: string;
  private readonly controlUrl: string;
  private readonly embeddingModel: string;
  private readonly extraFields: Record<string, unknown>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: BedrockConfig = {}) {
    this.region = resolveAwsRegion(config.region, config.profile) ?? 'us-east-1';
    this.apiKey = config.apiKey ?? process.env.AWS_BEARER_TOKEN_BEDROCK ?? '';
    this.credentials = new AwsCredentialChain(config, this.region);
    this.runtimeUrl = (config.baseUrl || `https://bedrock-runtime.${this.region}.amazonaws.com`).replace(/\/+$/, '');
    this.controlUrl = (config.controlPlaneUrl || `https://bedrock.${this.region}.amazonaws.com`).replace(/\/+$/, '');
    this.defaultModel = config.defaultModel || BEDROCK_DEFAULT_MODEL;
    this.embeddingModel = config.embeddingModel || BEDROCK_EMBEDDING_MODEL;
    this.extraFields = config.additionalModelRequestFields ?? {};
    this.timeoutMs = config.timeoutMs || 60000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0 || this.credentials.hasCredentials();
  }

  private unavailableMessage(): string {
    return `AWS Bedrock provider not available. ${this.credentials.describeProblem()}`;
  }

  /** Sends a request, authenticated with the API key or signed with SigV4 */
  private async send(method: 'GET' | 'POST', url: string, body: unknown, signal: AbortSignal, accept = 'application/json'): Promise<Response> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let headers: Record<string, string> = { accept, ...(payload !== undefined && { 'content-type': 'application/json' }) };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    } else {
      headers = signRequest({
        method,
        url,
        headers,
        body: payload ?? '',
        region: this.region,
        service: 'bedrock',
        credentials: await this.credentials.get(),
      });
    }
    return fetchWithRetry(url, { method, headers, ...(payload !== undefined && { body: payload }), signal }, this.maxRetries);
  }

  private modelUrl(model: string, action: string): string {
    return `${this.runtimeUrl}/model/${encodeURIComponent(model)}/${action}`;
  }

  /** The Converse request, plus how to read the answer when JSON is forced through a tool */
  private buildBody(request: CompletionRequest, model: string): { body: Record<string, unknown>; viaTool: boolean } {
    const format = jsonFormatOf(request);
    const reasoning = bedrockReasoning(model, request.reasoning);
    // Only some model families accept a forced tool choice; the rest get an instruction
    const viaTool = format !== undefined && canForceTool(format) && FORCED_TOOL_MODELS.test(model)
      && !request.tools?.length && !reasoning.thinking;

    let system = joinSystemMessages(request.messages);
    if (format && !viaTool) system = [system, jsonInstruction(format)].filter(Boolean).join('\n\n');

    let maxTokens = request.maxTokens ?? (wantsReasoning(request) ? REASONING_MAX_TOKENS : DEFAULT_MAX_TOKENS);
    if (reasoning.budgetTokens !== undefined) {
      if (request.maxTokens === undefined) {
        maxTokens = Math.max(maxTokens, reasoning.budgetTokens + 4096);
      } else if (request.maxTokens <= reasoning.budgetTokens) {
        throw new Error(
          `maxTokens (${request.maxTokens}) must be greater than the thinking budget (${reasoning.budgetTokens})`,
        );
      }
    }

    const body: Record<string, unknown> = {
      messages: toBedrockMessages(request.messages, this.id),
      inferenceConfig: {
        maxTokens,
        // Claude's thinking doesn't allow changing the temperature
        ...(request.temperature !== undefined && !reasoning.thinking && { temperature: request.temperature }),
        ...(request.stopSequences?.length && { stopSequences: request.stopSequences }),
      },
    };

    const systemBlocks: Block[] = system ? [{ text: system }] : [];

    const tools: Block[] = (request.tools ?? []).map(t => ({
      toolSpec: { name: t.name, description: t.description, inputSchema: { json: { type: 'object', ...t.parameters } } },
    }));
    if (viaTool && format?.type === 'json_schema') {
      tools.push({
        toolSpec: {
          name: RESPONSE_TOOL,
          description: 'Give your answer as this JSON.',
          inputSchema: { json: withoutSchemaKeyword(format.schema) },
        },
      });
    }

    if (request.cache) {
      if (systemBlocks.length) systemBlocks.push({ cachePoint: { type: 'default' } });
      if (tools.length) tools.push({ cachePoint: { type: 'default' } });
      const messages = body.messages as BedrockMessage[];
      messages[messages.length - 1]?.content.push({ cachePoint: { type: 'default' } });
    }

    if (systemBlocks.length) body.system = systemBlocks;
    if (tools.length) {
      body.toolConfig = {
        tools,
        ...(viaTool && { toolChoice: { tool: { name: RESPONSE_TOOL } } }),
      };
    }

    const additional = { ...this.extraFields, ...reasoning.fields };
    if (Object.keys(additional).length > 0) body.additionalModelRequestFields = additional;

    return { body, viaTool };
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.isAvailable()) throw new Error(this.unavailableMessage());

    const model = request.model || this.defaultModel;
    const startTime = Date.now();
    const { body, viaTool } = this.buildBody(request, model);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.send('POST', this.modelUrl(model, 'converse'), body, controller.signal);
      if (!response.ok) throw await apiError('AWS Bedrock API error', response);

      const data = await response.json() as ConverseResponse;
      const blocks = data.output?.message?.content ?? [];

      let content = blocks.filter(b => typeof b.text === 'string').map(b => b.text).join('');
      const reasoning = blocks.map(b => b.reasoningContent?.reasoningText?.text ?? '').join('');
      let toolCalls: ToolCall[] = blocks
        .filter(b => b.toolUse)
        .map(b => ({ id: b.toolUse!.toolUseId, name: b.toolUse!.name, arguments: b.toolUse!.input ?? {} }));

      let parsed: unknown;
      if (viaTool) {
        const answer = toolCalls.find(tc => tc.name === RESPONSE_TOOL);
        if (answer) {
          content = JSON.stringify(answer.arguments);
          parsed = answer.arguments;
        } else {
          parsed = parseJsonContent(content);
        }
        toolCalls = [];
      } else if (jsonFormatOf(request)) {
        parsed = parseJsonContent(content);
      }

      // Reasoning blocks must go back with the tool results (Claude rejects the request otherwise)
      const reasoningBlocks = blocks.filter(b => b.reasoningContent).map(b => ({ reasoningContent: b.reasoningContent }));

      return {
        content,
        model,
        provider: this.id,
        usage: mapUsage(data.usage),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ...(reasoning && { reasoning }),
        ...(jsonFormatOf(request) && { parsed }),
        ...(toolCalls.length > 0 && reasoningBlocks.length > 0 && {
          providerData: { [this.id]: { reasoning: reasoningBlocks } },
        }),
        metadata: {
          latencyMs: Date.now() - startTime,
          finishReason: viaTool ? 'stop' : mapStopReason(data.stopReason),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    if (!this.isAvailable()) throw new Error(this.unavailableMessage());

    const model = request.model || this.defaultModel;
    const { body, viaTool } = this.buildBody(request, model);

    // The timeout covers getting a response; the stream itself may run longer
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.send('POST', this.modelUrl(model, 'converse-stream'), body, controller.signal, 'application/vnd.amazon.eventstream');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw await apiError('AWS Bedrock streaming error', response);
    if (!response.body) throw new Error('No response body for streaming');

    const tools = new Map<number, { id: string; name: string; json: string }>();
    const reasoningBlocks = new Map<number, { text: string; signature?: string; redacted?: string }>();
    let stopReason: string | undefined;
    let usage: TokenUsage | undefined;
    const decoder = new TextDecoder();

    for await (const message of readEventStream(response.body)) {
      const messageType = message.headers[':message-type'];
      let payload: StreamEventPayload = {};
      try {
        payload = message.payload.byteLength ? JSON.parse(decoder.decode(message.payload)) as StreamEventPayload : {};
      } catch {
        // Not JSON: leave it empty
      }

      if (messageType === 'exception' || messageType === 'error') {
        const kind = message.headers[':exception-type'] ?? message.headers[':error-code'] ?? 'error';
        throw new Error(`AWS Bedrock streaming error (${String(kind)}): ${payload.message ?? payload.Message ?? message.headers[':error-message'] ?? ''}`);
      }

      const index = payload.contentBlockIndex ?? 0;
      switch (message.headers[':event-type']) {
        case 'contentBlockStart': {
          const start = payload.start?.toolUse;
          if (start) tools.set(index, { id: start.toolUseId, name: start.name, json: '' });
          break;
        }
        case 'contentBlockDelta': {
          const delta = payload.delta;
          if (typeof delta?.text === 'string' && delta.text) {
            yield { content: delta.text, done: false, provider: this.id, model };
          }
          if (delta?.toolUse) {
            const tool = tools.get(index);
            if (tool) tool.json += delta.toolUse.input ?? '';
            // Forced JSON arrives as the response tool's input
            if (viaTool && tool?.name === RESPONSE_TOOL && delta.toolUse.input) {
              yield { content: delta.toolUse.input, done: false, provider: this.id, model };
            }
          }
          const thinking = delta?.reasoningContent;
          if (thinking) {
            const block = reasoningBlocks.get(index) ?? { text: '' };
            if (thinking.text) {
              block.text += thinking.text;
              yield { content: '', reasoning: thinking.text, done: false, provider: this.id, model };
            }
            if (thinking.signature) block.signature = (block.signature ?? '') + thinking.signature;
            if (thinking.redactedContent) block.redacted = thinking.redactedContent;
            reasoningBlocks.set(index, block);
          }
          break;
        }
        case 'messageStop':
          stopReason = payload.stopReason;
          break;
        case 'metadata':
          if (payload.usage) usage = mapUsage(payload.usage);
          break;
      }
    }

    const toolCalls = [...tools.values()]
      .filter(t => !(viaTool && t.name === RESPONSE_TOOL))
      .map(t => ({ id: t.id, name: t.name, arguments: parseToolArguments(t.json) }));
    const replay = [...reasoningBlocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => ({
      reasoningContent: b.redacted !== undefined
        ? { redactedContent: b.redacted }
        : { reasoningText: { text: b.text, ...(b.signature && { signature: b.signature }) } },
    }));

    yield {
      content: '',
      done: true,
      provider: this.id,
      model,
      finishReason: viaTool ? 'stop' : mapStopReason(stopReason),
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      ...(toolCalls.length > 0 && replay.length > 0 && { providerData: { [this.id]: { reasoning: replay } } }),
    };
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text]);
    return vector;
  }

  /** Titan embeds one text per request; Cohere up to 96 */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isAvailable()) throw new Error(this.unavailableMessage());
    if (texts.length === 0) return [];

    const url = this.modelUrl(this.embeddingModel, 'invoke');
    const invoke = async (body: unknown): Promise<unknown> => {
      const response = await this.send('POST', url, body, AbortSignal.timeout(this.timeoutMs));
      if (!response.ok) throw await apiError('AWS Bedrock embedding error', response);
      return response.json();
    };

    if (/cohere\./i.test(this.embeddingModel)) {
      return inBatches(texts, 96, async batch => {
        const data = await invoke({ texts: batch, input_type: 'search_document', embedding_types: ['float'] }) as {
          embeddings: number[][] | { float: number[][] };
        };
        return Array.isArray(data.embeddings) ? data.embeddings : data.embeddings.float;
      }, 2);
    }

    return inBatches(texts, 1, async ([inputText]) => {
      const data = await invoke({ inputText }) as { embedding: number[] };
      return [data.embedding];
    }, 5);
  }

  /** Foundation models and inference profiles available in the region */
  async listModels(): Promise<ModelInfo[]> {
    if (!this.isAvailable()) throw new Error(this.unavailableMessage());

    const get = async (path: string) => {
      const response = await this.send('GET', `${this.controlUrl}${path}`, undefined, AbortSignal.timeout(this.timeoutMs));
      if (!response.ok) throw await apiError('AWS Bedrock model list error', response);
      return response.json();
    };

    const foundation = await get('/foundation-models') as { modelSummaries?: FoundationModel[] };
    const byId = new Map<string, ModelInfo>();
    for (const m of foundation.modelSummaries ?? []) {
      const inputs = m.inputModalities ?? [];
      const outputs = m.outputModalities ?? [];
      byId.set(m.modelId, {
        id: m.modelId,
        provider: this.id,
        name: [m.providerName, m.modelName].filter(Boolean).join(' '),
        capabilities: {
          chat: outputs.includes('TEXT'),
          embeddings: outputs.includes('EMBEDDING'),
          vision: inputs.includes('IMAGE'),
          ...(m.responseStreamingSupported !== undefined && { streaming: m.responseStreamingSupported }),
        },
      });
    }

    const models = [...byId.values()];
    let nextToken: string | undefined;
    do {
      const query = new URLSearchParams({ maxResults: '1000', ...(nextToken && { nextToken }) });
      const page = await get(`/inference-profiles?${query}`) as {
        inferenceProfileSummaries?: Array<{ inferenceProfileId: string; inferenceProfileName?: string; models?: Array<{ modelArn?: string }> }>;
        nextToken?: string;
      };
      for (const p of page.inferenceProfileSummaries ?? []) {
        const underlying = p.models?.[0]?.modelArn?.split('foundation-model/')[1];
        models.push({
          id: p.inferenceProfileId,
          provider: this.id,
          ...(p.inferenceProfileName && { name: p.inferenceProfileName }),
          ...(underlying && byId.get(underlying)?.capabilities && { capabilities: byId.get(underlying)!.capabilities }),
        });
      }
      nextToken = page.nextToken || undefined;
    } while (nextToken);

    return models;
  }
}

/** Whether a JSON format can be forced through a tool (tool inputs must be objects) */
function canForceTool(format: JsonFormat): boolean {
  if (format.type !== 'json_schema') return false;
  const schema = format.schema;
  return schema.type === 'object' || (schema.type === undefined && typeof schema.properties === 'object');
}

/**
 * Reasoning settings for a Bedrock model, as additionalModelRequestFields:
 * Claude takes Anthropic's thinking settings; Amazon Nova 2 takes reasoningConfig;
 * OpenAI gpt-oss takes reasoning_effort. Other models' reasoning isn't configurable.
 */
export function bedrockReasoning(
  model: string,
  reasoning: ReasoningOptions | undefined,
): { fields: Record<string, unknown>; thinking: boolean; budgetTokens?: number } {
  if (!reasoning) return { fields: {}, thinking: false };

  if (/anthropic\.|claude/i.test(model)) {
    const claude = anthropicThinking(model, reasoning);
    if (!claude.thinking) return { fields: {}, thinking: false };
    return {
      fields: { thinking: claude.thinking, ...(claude.effort && { output_config: { effort: claude.effort } }) },
      thinking: claude.on,
      budgetTokens: claude.budgetTokens,
    };
  }

  const effort = reasoning.effort ?? (reasoning.budgetTokens !== undefined ? effortForBudget(reasoning.budgetTokens) : undefined);
  if (!effort) return { fields: {}, thinking: false };
  const level = nearestEffort(effort, ['low', 'medium', 'high'] as const);

  if (/amazon\.nova/i.test(model)) {
    return {
      fields: {
        reasoningConfig: effort === 'none' ? { type: 'disabled' } : { type: 'enabled', maxReasoningEffort: level },
      },
      thinking: false,
    };
  }
  if (/openai\.gpt-oss/i.test(model) && effort !== 'none') {
    return { fields: { reasoning_effort: level }, thinking: false };
  }
  return { fields: {}, thinking: false };
}

/**
 * Converts messages to Converse format: roles alternate (consecutive messages from one role
 * are merged), tool results become toolResult blocks, and saved reasoning goes back first
 * in the assistant turn that called tools.
 */
export function toBedrockMessages(messages: ModelMessage[], providerId = 'bedrock'): BedrockMessage[] {
  const out: BedrockMessage[] = [];
  const names = new Set<string>();
  const push = (role: 'user' | 'assistant', content: Block[]) => {
    if (content.length === 0) return;
    const last = out[out.length - 1];
    if (last?.role === role) last.content.push(...content);
    else out.push({ role, content });
  };

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool' && m.toolCallId) {
      push('user', [{ toolResult: { toolUseId: m.toolCallId, content: [{ text: m.content || '(no output)' }] } }]);
      continue;
    }

    if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.toolCalls?.length) {
        const saved = m.providerData?.[providerId] as { reasoning?: Block[] } | undefined;
        if (Array.isArray(saved?.reasoning)) blocks.push(...saved.reasoning);
      }
      if (m.content) blocks.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ toolUse: { toolUseId: tc.id, name: tc.name, input: tc.arguments ?? {} } });
      }
      push('assistant', blocks);
      continue;
    }

    const blocks = m.parts?.length
      ? m.parts.map(p => toBedrockPart(p, names))
      : m.content ? [{ text: m.content }] : [];
    push('user', blocks);
  }

  return out;
}

const IMAGE_FORMATS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp',
};

const DOCUMENT_FORMATS: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

function toBedrockPart(part: ContentPart, names: Set<string>): Block {
  if (part.type === 'text') return { text: part.text };
  if (part.type === 'audio') throw new Error("AWS Bedrock's Converse API doesn't take audio input; transcribe it first");

  const mimeType = mimeTypeOf(part).toLowerCase();
  const inline = parseDataUri(part.url);
  const source = inline
    ? { bytes: inline.data }
    : part.url.startsWith('s3://') ? { s3Location: { uri: part.url } } : undefined;
  if (!source) {
    throw new Error(`AWS Bedrock needs ${part.type} input as a data: URI (base64) or an s3:// URI, not an http URL`);
  }

  if (part.type === 'image') {
    const format = IMAGE_FORMATS[mimeType];
    if (!format) throw new Error(`AWS Bedrock accepts PNG, JPEG, GIF, and WebP images, not ${mimeType}`);
    return { image: { format, source } };
  }

  const format = DOCUMENT_FORMATS[mimeType];
  if (!format) {
    throw new Error(`AWS Bedrock accepts PDF, CSV, DOC, DOCX, XLS, XLSX, HTML, TXT, and MD documents, not ${mimeType}`);
  }
  return { document: { format, name: documentName(part.filename, names), source } };
}

/** Document names may only have letters, digits, spaces, hyphens, parentheses, and brackets, and must be unique */
function documentName(filename: string | undefined, used: Set<string>): string {
  const base = (filename ?? 'document')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9\s\-()[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'document';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
  used.add(name);
  return name;
}

function mapUsage(usage: ConverseUsage | undefined): TokenUsage {
  const cacheRead = usage?.cacheReadInputTokens ?? 0;
  const cacheWrite = usage?.cacheWriteInputTokens ?? 0;
  const promptTokens = (usage?.inputTokens ?? 0) + cacheRead + cacheWrite;
  const completionTokens = usage?.outputTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(cacheRead > 0 && { cachedTokens: cacheRead }),
    ...(cacheWrite > 0 && { cacheWriteTokens: cacheWrite }),
  };
}

function mapStopReason(reason?: string): 'stop' | 'length' | 'error' | 'tool_call' {
  switch (reason) {
    case 'tool_use': return 'tool_call';
    case 'max_tokens':
    case 'model_context_window_exceeded': return 'length';
    case 'guardrail_intervened':
    case 'content_filtered': return 'error';
    default: return 'stop';
  }
}

interface ConverseUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

interface ConverseBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input?: Record<string, unknown> };
  reasoningContent?: { reasoningText?: { text: string; signature?: string }; redactedContent?: string };
}

interface ConverseResponse {
  output?: { message?: { role: string; content?: ConverseBlock[] } };
  stopReason?: string;
  usage?: ConverseUsage;
}

interface StreamEventPayload {
  contentBlockIndex?: number;
  start?: { toolUse?: { toolUseId: string; name: string } };
  delta?: {
    text?: string;
    toolUse?: { input?: string };
    reasoningContent?: { text?: string; signature?: string; redactedContent?: string };
  };
  stopReason?: string;
  usage?: ConverseUsage;
  message?: string;
  Message?: string;
}

interface FoundationModel {
  modelId: string;
  modelName?: string;
  providerName?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  responseStreamingSupported?: boolean;
}
