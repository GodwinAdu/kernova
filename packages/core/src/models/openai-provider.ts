/**
 * OpenAI Model Provider
 *
 * Implements the ModelProvider interface for OpenAI's API, including tool calling,
 * images, audio and PDF input, structured output, reasoning effort, streaming
 * (with token usage), embeddings, and model listing.
 *
 * Configuration:
 *   Set OPENAI_API_KEY environment variable or pass apiKey in config.
 *   OPENAI_BASE_URL and OPENAI_MODEL override the endpoint and default model;
 *   OPENAI_ORG_ID and OPENAI_PROJECT_ID select an organization and project.
 */

import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { OPENAI_EFFORTS, REASONING_MAX_TOKENS } from './http.js';

export interface OpenAIConfig {
  /** API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;

  /** Base URL (defaults to https://api.openai.com/v1) */
  baseUrl?: string;

  /** Default model */
  defaultModel?: string;

  /** Embedding model (default: text-embedding-3-small) */
  embeddingModel?: string;

  /** Organization ID (defaults to OPENAI_ORG_ID env var) */
  organization?: string;

  /** Project ID (defaults to OPENAI_PROJECT_ID env var) */
  project?: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for rate limits, transient server errors, and network failures (default: 2) */
  maxRetries?: number;
}

/** Reasoning models reject temperature and stop sequences */
const REASONING_MODEL = /^(o\d|gpt-5)/i;

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config: OpenAIConfig = {}) {
    const organization = config.organization ?? process.env.OPENAI_ORG_ID;
    const project = config.project ?? process.env.OPENAI_PROJECT_ID;
    super({
      id: 'openai',
      name: 'OpenAI',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
      baseUrl: config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: config.defaultModel || process.env.OPENAI_MODEL || 'gpt-4o',
      timeoutMs: config.timeoutMs || 60000,
      maxRetries: config.maxRetries,
      supportsEmbeddings: true,
      embeddingModel: config.embeddingModel || 'text-embedding-3-small',
      reasoningFormat: 'reasoning_effort',
      reasoningEfforts: [...OPENAI_EFFORTS],
      streamUsage: true,
      headers: {
        ...(organization && { 'OpenAI-Organization': organization }),
        ...(project && { 'OpenAI-Project': project }),
      },
    });
    // max_tokens is deprecated and rejected by reasoning models
    this.maxTokensField = 'max_completion_tokens';
    this.embeddingBatchSize = 2048;
  }

  protected override unavailableMessage(): string {
    return 'OpenAI provider not available. Set OPENAI_API_KEY environment variable.';
  }

  /** Reasoning models think within the output limit, so they get more room by default */
  protected override maxTokensFor(model: string, request: Parameters<OpenAICompatibleProvider['maxTokensFor']>[1]): number {
    if (request.maxTokens !== undefined || !REASONING_MODEL.test(model)) return super.maxTokensFor(model, request);
    return REASONING_MAX_TOKENS;
  }

  protected override temperatureFor(model: string, requested: number | undefined): number | undefined {
    return REASONING_MODEL.test(model) ? undefined : requested ?? 0.7;
  }

  protected override buildBody(
    ...args: Parameters<OpenAICompatibleProvider['buildBody']>
  ): Record<string, unknown> {
    const body = super.buildBody(...args);
    if (REASONING_MODEL.test(String(body.model))) delete body.stop;
    return body;
  }
}
