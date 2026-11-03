/**
 * Google Vertex AI Model Provider
 *
 * Gemini models on Google Cloud's Vertex AI: the same request format as the Gemini API
 * (function calling, multimodal input, thinking, structured output, streaming), with
 * Vertex AI's project/location endpoints and Google Cloud authentication.
 *
 * Authentication: see GoogleAuth (service account key, gcloud ADC, or the metadata server),
 * or an `apiKey` for Vertex AI express mode.
 *
 * Configuration:
 *   GOOGLE_CLOUD_PROJECT=my-project     (or the project in your credentials file)
 *   GOOGLE_CLOUD_LOCATION=global        (default; or a region such as us-central1)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json   (or `gcloud auth application-default login`)
 */

import type { ModelInfo } from '@kernova/types';
import { GeminiProvider } from './gemini-provider.js';
import { GoogleAuth, type GoogleAuthConfig } from './google-auth.js';
import { apiError, inBatches } from './http.js';

export interface VertexAIConfig extends GoogleAuthConfig {
  /** Google Cloud project (defaults to GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, then the credentials' project) */
  project?: string;

  /** Location (defaults to GOOGLE_CLOUD_LOCATION, then `global`) */
  location?: string;

  /** API key for Vertex AI express mode (instead of Google Cloud credentials) */
  apiKey?: string;

  /** Default model */
  defaultModel?: string;

  /** Embedding model (default: gemini-embedding-001) */
  embeddingModel?: string;

  /** Endpoint override, e.g. a Private Service Connect address (default: the location's aiplatform host) */
  baseUrl?: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for rate limits, transient server errors, and network failures (default: 2) */
  maxRetries?: number;
}

/** Gemini 3 models are served from the `global` location */
export const VERTEX_DEFAULT_MODEL = 'gemini-3-flash-preview';

export class VertexAIProvider extends GeminiProvider {
  private readonly auth: GoogleAuth;
  private readonly project: string | undefined;
  private readonly location: string;
  private readonly host: string;

  constructor(config: VertexAIConfig = {}) {
    super({
      defaultModel: config.defaultModel || VERTEX_DEFAULT_MODEL,
      embeddingModel: config.embeddingModel,
      timeoutMs: config.timeoutMs || 60000,
      maxRetries: config.maxRetries,
    }, { id: 'vertex', name: 'Google Vertex AI' });

    // Vertex doesn't take Gemini API keys; only an express-mode key passed in
    this.apiKey = config.apiKey ?? '';
    this.auth = new GoogleAuth(config);
    this.project = config.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
      || process.env.CLOUDSDK_CORE_PROJECT || this.auth.projectId();
    this.location = config.location || process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_REGION || 'global';
    this.host = (config.baseUrl
      || (this.location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${this.location}-aiplatform.googleapis.com`))
      .replace(/\/+$/, '');
  }

  override isAvailable(): boolean {
    if (this.apiKey) return true;
    return this.auth.hasCredentials() && (this.project !== undefined || this.auth.source === 'metadata server');
  }

  protected override unavailableMessage(): string {
    if (!this.auth.hasCredentials()) return `Vertex AI provider not available. ${this.auth.describeProblem()}`;
    return 'Vertex AI provider not available. Set GOOGLE_CLOUD_PROJECT (or pass project).';
  }

  /** The project, from config, the environment, the credentials, or the metadata server */
  private async projectId(): Promise<string> {
    const project = this.project ?? await this.auth.metadataProjectId();
    if (!project) throw new Error(this.unavailableMessage());
    return project;
  }

  protected override async modelUrl(model: string, method: string): Promise<string> {
    // A full resource name: a tuned model's endpoint, or another project's model
    if (model.startsWith('projects/')) return `${this.host}/v1/${model}:${method}`;
    const path = model.startsWith('publishers/') ? model : `publishers/google/models/${model}`;
    // Express mode: an API key without a project
    if (this.apiKey && !this.project) return `${this.host}/v1/${path}:${method}`;
    const project = await this.projectId();
    return `${this.host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(this.location)}/${path}:${method}`;
  }

  protected override async authHeaders(): Promise<Record<string, string>> {
    if (this.apiKey) return { 'x-goog-api-key': this.apiKey };
    // User credentials bill their quota project; service accounts bill their own
    const quotaProject = this.auth.quotaProject();
    return {
      Authorization: `Bearer ${await this.auth.getAccessToken()}`,
      ...(quotaProject && { 'x-goog-user-project': quotaProject }),
    };
  }

  /** Vertex embeds with `:predict`. gemini-embedding-001 takes one text per request; older models up to 250 */
  override async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }
    if (texts.length === 0) return [];

    const single = /gemini-embedding/i.test(this.embeddingModel);
    const url = await this.modelUrl(this.embeddingModel, 'predict');
    return inBatches(texts, single ? 1 : 50, async batch => {
      const response = await this.send(
        url,
        { instances: batch.map(content => ({ content })) },
        AbortSignal.timeout(this.timeoutMs),
      );
      if (!response.ok) throw await apiError(`${this.name} embedding error`, response);
      const data = await response.json() as { predictions: Array<{ embeddings: { values: number[] } }> };
      return data.predictions.map(p => p.embeddings.values);
    }, single ? 4 : 2);
  }

  /** Google's models in the Vertex AI Model Garden */
  override async listModels(): Promise<ModelInfo[]> {
    if (!this.isAvailable()) {
      throw new Error(this.unavailableMessage());
    }

    // The Model Garden list isn't under a project path, so the project that's billed goes in a header
    const project = this.apiKey && !this.project ? undefined : await this.projectId();
    const billing: Record<string, string> = project && !this.auth.quotaProject() ? { 'x-goog-user-project': project } : {};

    const models: ModelInfo[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ pageSize: '200', ...(pageToken && { pageToken }) });
      const response = await this.send(
        `${this.host}/v1beta1/publishers/google/models?${query}`,
        undefined,
        AbortSignal.timeout(this.timeoutMs),
        billing,
      );
      if (!response.ok) throw await apiError(`${this.name} model list error`, response);

      const page = await response.json() as {
        publisherModels?: Array<{ name: string; versionId?: string; launchStage?: string }>;
        nextPageToken?: string;
      };
      for (const m of page.publisherModels ?? []) {
        const id = m.name.replace(/^publishers\/google\/models\//, '');
        models.push({
          id,
          provider: this.id,
          ...(m.launchStage && { name: `${id} (${m.launchStage.toLowerCase().replace(/_/g, ' ')})` }),
          capabilities: { chat: id.startsWith('gemini') && !id.includes('embedding'), embeddings: id.includes('embedding') },
        });
      }
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);

    return models;
  }
}
