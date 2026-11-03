/**
 * Google Vertex AI (with Google Cloud authentication) and Azure OpenAI (with API keys and
 * Microsoft Entra ID), against local fakes of their APIs and token endpoints.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamChunk } from '@kernova/types';
import { VertexAIProvider } from './vertex-provider.js';
import { GoogleAuth, signJwt } from './google-auth.js';
import { AzureOpenAIProvider } from './azure-provider.js';
import { fakeServer, sseBody, type FakeServer } from '../__tests__/fake-server.js';

const ENV = [
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_CONFIG',
  'GOOGLE_CLOUD_LOCATION', 'GOOGLE_CLOUD_REGION', 'K_SERVICE', 'FUNCTION_TARGET', 'GAE_SERVICE', 'GCE_METADATA_HOST',
  'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_AUTHORITY_HOST', 'IDENTITY_ENDPOINT', 'IDENTITY_HEADER',
];
const savedEnv: Record<string, string | undefined> = {};
let dir: string;
const servers: FakeServer[] = [];

beforeEach(() => {
  for (const key of ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'kernova-cloud-'));
  // Never read the developer's real gcloud credentials
  process.env.CLOUDSDK_CONFIG = dir;
});

afterEach(async () => {
  for (const key of ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(dir, { recursive: true, force: true });
  while (servers.length) await servers.pop()!.close();
});

async function serve(...args: Parameters<typeof fakeServer>) {
  const server = await fakeServer(...args);
  servers.push(server);
  return server;
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** A fake Google token endpoint that checks service account JWTs and refresh tokens */
async function googleTokenServer() {
  return serve(req => {
    const form = new URLSearchParams(req.body);
    if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      const [header, claims, signature] = form.get('assertion')!.split('.');
      const valid = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url');
      if (!valid) return { status: 400, body: { error: 'invalid_grant', error_description: 'bad signature' } };
      return { body: { access_token: 'ya29.service', expires_in: 3600, token_type: 'Bearer' } };
    }
    if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'refresh-1') {
      return { body: { access_token: 'ya29.user', expires_in: 3600, token_type: 'Bearer' } };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  });
}

const geminiReply = {
  candidates: [{
    content: { role: 'model', parts: [{ text: 'Thinking about it', thought: true }, { text: '{"answer":42}' }] },
    finishReason: 'STOP',
  }],
  usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5, thoughtsTokenCount: 20, cachedContentTokenCount: 32, totalTokenCount: 75 },
  modelVersion: 'gemini-3-flash-preview',
};

describe('Google auth', () => {
  it('signs service account JWTs with the right claims', () => {
    const jwt = signJwt(
      { type: 'service_account', client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey, private_key_id: 'kid-1' },
      ['https://www.googleapis.com/auth/cloud-platform'],
      'https://oauth2.googleapis.com/token',
      Date.UTC(2026, 0, 1),
    );
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-1' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'bot@p.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1767225600,
      exp: 1767229200,
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url')).toBe(true);
  });

  it('finds the gcloud ADC file and explains unsupported credential types', () => {
    writeFileSync(join(dir, 'application_default_credentials.json'), JSON.stringify({ type: 'external_account', audience: 'x' }));
    const auth = new GoogleAuth();
    expect(auth.source).toBe(join(dir, 'application_default_credentials.json'));
    expect(auth.hasCredentials()).toBe(false);
    expect(auth.describeProblem()).toMatch(/"external_account" aren't supported/);
  });

  it('has no credentials when nothing is set up', () => {
    const auth = new GoogleAuth();
    expect(auth.hasCredentials()).toBe(false);
    expect(auth.describeProblem()).toMatch(/gcloud auth application-default login/);
  });
});

describe('Vertex AI', () => {
  it('authenticates with a service account key, caches the token, and calls the project endpoint', async () => {
    const tokens = await googleTokenServer();
    const api = await serve(() => ({ body: geminiReply }));
    const provider = new VertexAIProvider({
      credentials: {
        type: 'service_account',
        project_id: 'proj-1',
        client_email: 'bot@proj-1.iam.gserviceaccount.com',
        private_key: privateKey,
        token_uri: `${tokens.url}/token`,
      },
      baseUrl: api.url,
    });
    expect(provider.isAvailable()).toBe(true);
    expect(provider.id).toBe('vertex');

    const request = {
      model: '',
      messages: [{ role: 'user' as const, content: 'The answer?' }],
      reasoning: { effort: 'low' as const, includeThoughts: true },
      responseFormat: { type: 'json_schema' as const, schema: { type: 'object', properties: { answer: { type: 'number' } } } },
    };
    const response = await provider.complete(request);
    await provider.complete(request);

    expect(tokens.requests).toHaveLength(1);
    expect(api.requests[0].url).toBe('/v1/projects/proj-1/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent');
    expect(api.requests[0].headers.authorization).toBe('Bearer ya29.service');
    expect(api.requests[0].headers['x-goog-api-key']).toBeUndefined();
    expect(api.requests[0].json.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { answer: { type: 'number' } } },
      thinkingConfig: { thinkingLevel: 'low', includeThoughts: true },
    });

    expect(response.content).toBe('{"answer":42}');
    expect(response.parsed).toEqual({ answer: 42 });
    expect(response.reasoning).toBe('Thinking about it');
    expect(response.usage).toEqual({ promptTokens: 50, completionTokens: 25, totalTokens: 75, cachedTokens: 32, reasoningTokens: 20 });
  });

  it('uses gcloud user credentials from GOOGLE_APPLICATION_CREDENTIALS, billing their quota project', async () => {
    const tokens = await googleTokenServer();
    const api = await serve(() => ({ body: sseBody([geminiReply]), headers: { 'content-type': 'text/event-stream' } }));
    const keyFile = join(dir, 'adc.json');
    writeFileSync(keyFile, JSON.stringify({
      type: 'authorized_user', client_id: 'cid', client_secret: 'cs', refresh_token: 'refresh-1',
      quota_project_id: 'billing-proj', token_uri: `${tokens.url}/token`,
    }));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
    process.env.GOOGLE_CLOUD_PROJECT = 'proj-2';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';

    const provider = new VertexAIProvider({ baseUrl: api.url, defaultModel: 'gemini-2.5-pro' });
    const chunks = await collect(provider.stream({ model: '', messages: [{ role: 'user', content: 'hi' }], reasoning: { effort: 'none' } }));

    expect(api.requests[0].url).toBe('/v1/projects/proj-2/locations/us-central1/publishers/google/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    expect(api.requests[0].headers.authorization).toBe('Bearer ya29.user');
    expect(api.requests[0].headers['x-goog-user-project']).toBe('billing-proj');
    // Gemini 2.5 Pro can't turn thinking off: the smallest budget is used
    expect(api.requests[0].json.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 128 });
    expect(chunks.find(c => c.reasoning)?.reasoning).toBe('Thinking about it');
    expect(chunks.at(-1)).toMatchObject({ done: true, provider: 'vertex' });
  });

  it('supports express mode with an API key', async () => {
    const api = await serve(() => ({ body: geminiReply }));
    const provider = new VertexAIProvider({ apiKey: 'vertex-key', baseUrl: api.url });
    await provider.complete({ model: 'gemini-3-pro-preview', messages: [{ role: 'user', content: 'hi' }], reasoning: { effort: 'medium' } });

    expect(api.requests[0].url).toBe('/v1/publishers/google/models/gemini-3-pro-preview:generateContent');
    expect(api.requests[0].headers['x-goog-api-key']).toBe('vertex-key');
    // Gemini 3 Pro takes low or high
    expect(api.requests[0].json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high' });
  });

  it('is unavailable without a project, and says so', async () => {
    const provider = new VertexAIProvider({ accessToken: 'token' });
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.complete({ model: '', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/GOOGLE_CLOUD_PROJECT/);
  });

  it('embeds with :predict, one text per request for gemini-embedding-001', async () => {
    const api = await serve(req => ({
      body: { predictions: req.json.instances.map((i: { content: string }) => ({ embeddings: { values: [i.content.length] } })) },
    }));
    const provider = new VertexAIProvider({ accessToken: 'token', project: 'p', baseUrl: api.url });

    await expect(provider.embedMany(['a', 'bb', 'ccc'])).resolves.toEqual([[1], [2], [3]]);
    expect(api.requests).toHaveLength(3);
    expect(api.requests[0].url).toBe('/v1/projects/p/locations/global/publishers/google/models/gemini-embedding-001:predict');
    expect(api.requests[0].headers.authorization).toBe('Bearer token');

    const older = new VertexAIProvider({ accessToken: 'token', project: 'p', baseUrl: api.url, embeddingModel: 'text-embedding-005' });
    await expect(older.embedMany(['a', 'bb'])).resolves.toEqual([[1], [2]]);
    expect(api.requests).toHaveLength(4);
  });

  it("lists Google's publisher models", async () => {
    const api = await serve(() => ({
      body: { publisherModels: [{ name: 'publishers/google/models/gemini-3-flash-preview', launchStage: 'PUBLIC_PREVIEW' }, { name: 'publishers/google/models/gemini-embedding-001' }] },
    }));
    const provider = new VertexAIProvider({ accessToken: 'token', project: 'p', baseUrl: api.url });
    const models = await provider.listModels();
    expect(api.requests[0].url).toBe('/v1beta1/publishers/google/models?pageSize=200');
    // Not under a project path, so the billed project goes in a header
    expect(api.requests[0].headers['x-goog-user-project']).toBe('p');
    expect(models).toEqual([
      { id: 'gemini-3-flash-preview', provider: 'vertex', name: 'gemini-3-flash-preview (public preview)', capabilities: { chat: true, embeddings: false } },
      { id: 'gemini-embedding-001', provider: 'vertex', capabilities: { chat: false, embeddings: true } },
    ]);
  });
});

const chatReply = { id: 'r1', model: 'gpt-4o', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } };

describe('Azure OpenAI', () => {
  it('calls the v1 API with the api-key header and the deployment as the model', async () => {
    const api = await serve(() => ({ body: chatReply }));
    const provider = new AzureOpenAIProvider({ endpoint: `${api.url}/openai/v1/`, apiKey: 'az-key' });
    expect(provider.id).toBe('azure');

    await provider.complete({ model: 'my-gpt4o', messages: [{ role: 'user', content: 'hi' }] });

    const req = api.requests[0];
    expect(req.url).toBe('/openai/v1/chat/completions');
    expect(req.headers['api-key']).toBe('az-key');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.json.model).toBe('my-gpt4o');
    // The deployment's model is unknown, so only a requested temperature is sent
    expect(req.json.temperature).toBeUndefined();
    expect(req.json.max_completion_tokens).toBe(4096);
  });

  it('uses the deployment-based API when an api-version is set', async () => {
    const api = await serve(() => ({ body: chatReply }));
    process.env.AZURE_OPENAI_ENDPOINT = api.url;
    process.env.AZURE_OPENAI_API_KEY = 'az-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'prod-gpt';
    const provider = new AzureOpenAIProvider({ apiVersion: '2024-10-21' });

    await provider.complete({ model: '', messages: [{ role: 'user', content: 'hi' }], temperature: 0.3 });
    expect(api.requests[0].url).toBe('/openai/deployments/prod-gpt/chat/completions?api-version=2024-10-21');
    expect(api.requests[0].json.temperature).toBe(0.3);
  });

  it('gets Microsoft Entra ID tokens with app credentials and reuses them', async () => {
    const api = await serve(req => req.url.includes('/oauth2/v2.0/token')
      ? { body: { access_token: 'entra-token', expires_in: 3600, token_type: 'Bearer' } }
      : { body: chatReply });
    process.env.AZURE_AUTHORITY_HOST = api.url;
    const provider = new AzureOpenAIProvider({ endpoint: api.url, tenantId: 'tenant-1', clientId: 'app-1', clientSecret: 'secret-1' });
    expect(provider.isAvailable()).toBe(true);

    await provider.complete({ model: 'gpt', messages: [{ role: 'user', content: 'a' }] });
    await provider.complete({ model: 'gpt', messages: [{ role: 'user', content: 'b' }] });

    const tokenRequests = api.requests.filter(r => r.url === '/tenant-1/oauth2/v2.0/token');
    expect(tokenRequests).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(tokenRequests[0].body))).toEqual({
      grant_type: 'client_credentials', client_id: 'app-1', client_secret: 'secret-1',
      scope: 'https://cognitiveservices.azure.com/.default',
    });
    const chats = api.requests.filter(r => r.url === '/openai/v1/chat/completions');
    expect(chats.map(r => r.headers.authorization)).toEqual(['Bearer entra-token', 'Bearer entra-token']);
  });

  it('uses the App Service managed identity endpoint', async () => {
    const api = await serve(req => req.url.startsWith('/msi')
      ? { body: { access_token: 'mi-token', expires_on: String(Math.floor(Date.now() / 1000) + 3600) } }
      : { body: chatReply });
    process.env.IDENTITY_ENDPOINT = `${api.url}/msi/token`;
    process.env.IDENTITY_HEADER = 'id-header';
    const provider = new AzureOpenAIProvider({ endpoint: api.url, managedIdentity: { clientId: 'uami-1' } });

    await provider.complete({ model: 'gpt', messages: [{ role: 'user', content: 'hi' }] });
    const tokenRequest = api.requests[0];
    expect(tokenRequest.headers['x-identity-header']).toBe('id-header');
    expect(new URL(tokenRequest.url, api.url).searchParams.get('resource')).toBe('https://cognitiveservices.azure.com');
    expect(new URL(tokenRequest.url, api.url).searchParams.get('client_id')).toBe('uami-1');
    expect(api.requests[1].headers.authorization).toBe('Bearer mi-token');
  });

  it('explains what is missing', () => {
    expect(new AzureOpenAIProvider().isAvailable()).toBe(false);
    process.env.AZURE_OPENAI_ENDPOINT = 'https://r.openai.azure.com';
    const noKey = new AzureOpenAIProvider();
    expect(noKey.isAvailable()).toBe(false);
    return expect(noKey.complete({ model: '', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/AZURE_OPENAI_API_KEY/);
  });

  it('embeds with the embedding deployment', async () => {
    const api = await serve(req => ({
      body: { data: req.json.input.map((_: string, i: number) => ({ index: i, embedding: [i] })).reverse() },
    }));
    const provider = new AzureOpenAIProvider({ endpoint: api.url, apiKey: 'k', embeddingModel: 'embed-prod' });
    await expect(provider.embedMany(['a', 'b', 'c'])).resolves.toEqual([[0], [1], [2]]);
    expect(api.requests[0].json).toEqual({ model: 'embed-prod', input: ['a', 'b', 'c'] });
  });
});
