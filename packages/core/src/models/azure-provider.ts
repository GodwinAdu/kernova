/**
 * Azure OpenAI Model Provider
 *
 * Azure OpenAI and Azure AI Foundry serve the OpenAI chat completions API from your own
 * resource. Requests name a deployment (the name you gave the model when you deployed it),
 * not a model.
 *
 * Uses the v1 API (`{endpoint}/openai/v1/...`, no api-version needed). Set `apiVersion`
 * to use the older deployment-based API instead.
 *
 * Authentication, first match wins:
 *   1. API key: `apiKey` or AZURE_OPENAI_API_KEY
 *   2. `getToken()`: your own Microsoft Entra ID token source
 *   3. Entra ID app credentials: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 *   4. Managed identity (`managedIdentity: true`): App Service, Functions, Container Apps, VMs
 *
 * Configuration:
 *   AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com
 *   AZURE_OPENAI_API_KEY=...
 *   AZURE_OPENAI_DEPLOYMENT=gpt-4o              (default deployment)
 *   AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
 */

import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { apiError, cachedToken, OPENAI_EFFORTS, REASONING_MAX_TOKENS, type TokenSource } from './http.js';

export interface AzureOpenAIConfig {
  /**
   * Resource endpoint, e.g. https://my-resource.openai.azure.com (defaults to AZURE_OPENAI_ENDPOINT).
   * Azure AI Foundry endpoints (https://my-resource.services.ai.azure.com) work too.
   */
  endpoint?: string;

  /** API key (defaults to AZURE_OPENAI_API_KEY) */
  apiKey?: string;

  /** Microsoft Entra ID token source, for example from @azure/identity's getBearerTokenProvider() */
  getToken?: () => string | Promise<string>;

  /** Entra ID tenant for app credentials (defaults to AZURE_TENANT_ID) */
  tenantId?: string;

  /** Entra ID app (client) ID (defaults to AZURE_CLIENT_ID) */
  clientId?: string;

  /** Entra ID client secret (defaults to AZURE_CLIENT_SECRET) */
  clientSecret?: string;

  /**
   * Authenticate as the Azure host's managed identity. `true` uses the system-assigned identity;
   * `{ clientId }` picks a user-assigned one.
   */
  managedIdentity?: boolean | { clientId: string };

  /** Deployment used when a request doesn't name one (defaults to AZURE_OPENAI_DEPLOYMENT, then gpt-4o) */
  defaultModel?: string;

  /** Embedding deployment (defaults to AZURE_OPENAI_EMBEDDING_DEPLOYMENT, then text-embedding-3-small) */
  embeddingModel?: string;

  /** Use the older deployment-based API with this api-version (e.g. 2024-10-21) instead of the v1 API */
  apiVersion?: string;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Retries for rate limits, transient server errors, and network failures (default: 2) */
  maxRetries?: number;
}

/** Scope of Azure OpenAI / Foundry tokens */
const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';
const COGNITIVE_SERVICES_RESOURCE = 'https://cognitiveservices.azure.com';

/** Reasoning models reject temperature and stop sequences (judged by deployment name, which often matches) */
const REASONING_MODEL = /^(o\d|gpt-5)/i;

export class AzureOpenAIProvider extends OpenAICompatibleProvider {
  private readonly endpointUrl: string;
  private readonly apiVersion?: string;
  private readonly tokens?: TokenSource;

  constructor(config: AzureOpenAIConfig = {}) {
    const endpoint = (config.endpoint || process.env.AZURE_OPENAI_ENDPOINT || '')
      .replace(/\/+$/, '')
      // Accept endpoints copied with the API path on the end
      .replace(/\/openai(\/v1)?$/i, '');
    const apiKey = config.apiKey ?? process.env.AZURE_OPENAI_API_KEY ?? '';

    super({
      id: 'azure',
      name: 'Azure OpenAI',
      baseUrl: `${endpoint}/openai/v1`,
      apiKey,
      defaultModel: config.defaultModel || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      timeoutMs: config.timeoutMs || 60000,
      maxRetries: config.maxRetries,
      supportsEmbeddings: true,
      embeddingModel: config.embeddingModel || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small',
      reasoningFormat: 'reasoning_effort',
      reasoningEfforts: [...OPENAI_EFFORTS],
      streamUsage: true,
    });

    this.endpointUrl = endpoint;
    this.apiVersion = config.apiVersion;
    this.maxTokensField = 'max_completion_tokens';
    this.embeddingBatchSize = 2048;

    if (!apiKey) this.tokens = entraTokenSource(config, this.timeoutMs);
  }

  override isAvailable(): boolean {
    return this.endpointUrl.length > 0 && (this.apiKey.length > 0 || this.tokens !== undefined);
  }

  protected override unavailableMessage(): string {
    return this.endpointUrl
      ? 'Azure OpenAI provider not available. Set AZURE_OPENAI_API_KEY, or Entra ID credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET).'
      : 'Azure OpenAI provider not available. Set AZURE_OPENAI_ENDPOINT (e.g. https://my-resource.openai.azure.com).';
  }

  protected override endpoint(path: 'chat/completions' | 'embeddings' | 'models', model?: string): string {
    if (!this.apiVersion) return `${this.endpointUrl}/openai/v1/${path}`;
    const version = `api-version=${encodeURIComponent(this.apiVersion)}`;
    if (path === 'models') return `${this.endpointUrl}/openai/models?${version}`;
    const deployment = encodeURIComponent(model ?? (path === 'embeddings' ? this.embeddingModel : this.defaultModel));
    return `${this.endpointUrl}/openai/deployments/${deployment}/${path}?${version}`;
  }

  protected override async requestHeaders(): Promise<Record<string, string>> {
    const auth: Record<string, string> = this.apiKey
      ? { 'api-key': this.apiKey }
      : { Authorization: `Bearer ${await this.tokens!.get()}` };
    return { 'Content-Type': 'application/json', ...auth, ...this.customHeaders };
  }

  /** Reasoning models think within the output limit, so they get more room by default */
  protected override maxTokensFor(model: string, request: Parameters<OpenAICompatibleProvider['maxTokensFor']>[1]): number {
    if (request.maxTokens !== undefined || !REASONING_MODEL.test(model)) return super.maxTokensFor(model, request);
    return REASONING_MAX_TOKENS;
  }

  protected override temperatureFor(model: string, requested: number | undefined): number | undefined {
    // Deployments are named by you, so the model is unknown: only send a temperature that was asked for
    return REASONING_MODEL.test(model) ? undefined : requested;
  }

  protected override buildBody(
    ...args: Parameters<OpenAICompatibleProvider['buildBody']>
  ): Record<string, unknown> {
    const body = super.buildBody(...args);
    if (REASONING_MODEL.test(String(body.model))) delete body.stop;
    return body;
  }
}

/** The Entra ID token source the config describes, or undefined when it has none */
function entraTokenSource(config: AzureOpenAIConfig, timeoutMs: number): TokenSource | undefined {
  if (config.getToken) {
    const getToken = config.getToken;
    return { get: async () => getToken() };
  }

  const tenantId = config.tenantId ?? process.env.AZURE_TENANT_ID;
  const clientId = config.clientId ?? process.env.AZURE_CLIENT_ID;
  const clientSecret = config.clientSecret ?? process.env.AZURE_CLIENT_SECRET;
  if (tenantId && clientId && clientSecret) {
    return cachedToken(async () => {
      const authority = (process.env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/+$/, '');
      const response = await fetch(`${authority}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: COGNITIVE_SERVICES_SCOPE,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw await apiError('Azure Entra ID token error', response);
      const data = await response.json() as { access_token: string; expires_in: number };
      return { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    });
  }

  if (config.managedIdentity) {
    const userAssigned = typeof config.managedIdentity === 'object' ? config.managedIdentity.clientId : undefined;
    return cachedToken(() => managedIdentityToken(userAssigned, timeoutMs));
  }

  return undefined;
}

/** A token for the host's managed identity: App Service / Functions / Container Apps, or a VM's metadata service */
async function managedIdentityToken(clientId: string | undefined, timeoutMs: number): Promise<{ token: string; expiresAt: number }> {
  const identityEndpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  const params = new URLSearchParams({ resource: COGNITIVE_SERVICES_RESOURCE });
  if (clientId) params.set('client_id', clientId);

  let response: Response;
  if (identityEndpoint && identityHeader) {
    params.set('api-version', '2019-08-01');
    response = await fetch(`${identityEndpoint}?${params}`, {
      headers: { 'X-IDENTITY-HEADER': identityHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } else {
    params.set('api-version', '2018-02-01');
    response = await fetch(`http://169.254.169.254/metadata/identity/oauth2/token?${params}`, {
      headers: { Metadata: 'true' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
    });
  }
  if (!response.ok) throw await apiError('Azure managed identity token error', response);
  const data = await response.json() as { access_token: string; expires_on?: string | number; expires_in?: string | number };
  const expiresAt = data.expires_on !== undefined
    ? Number(data.expires_on) * 1000
    : Date.now() + Number(data.expires_in ?? 3600) * 1000;
  return { token: data.access_token, expiresAt };
}
