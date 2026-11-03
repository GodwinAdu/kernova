/**
 * AWS: SigV4 signing, the event stream format, the credential chain, and the Bedrock
 * provider against a local fake of the Bedrock API.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamChunk } from '@kernova/types';
import { signRequest } from './aws-sigv4.js';
import { crc32, decodeEventStreamMessage, encodeEventStreamMessage, readEventStream } from './aws-eventstream.js';
import { AwsCredentialChain, parseIni, resolveAwsRegion } from './aws-credentials.js';
import { BedrockProvider, bedrockReasoning, toBedrockMessages } from './bedrock-provider.js';
import { fakeServer, type FakeServer } from '../__tests__/fake-server.js';

const AWS_ENV = [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION',
  'AWS_BEARER_TOKEN_BEDROCK', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE', 'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI',
];
const savedEnv: Record<string, string | undefined> = {};
let dir: string;
const servers: FakeServer[] = [];

beforeEach(() => {
  for (const key of AWS_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'kernova-aws-'));
  // Never read the developer's real ~/.aws files
  process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, 'credentials');
  process.env.AWS_CONFIG_FILE = join(dir, 'config');
});

afterEach(async () => {
  for (const key of AWS_ENV) {
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

const EXAMPLE_CREDENTIALS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

describe('SigV4', () => {
  it("matches AWS's documented example signature", () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      region: 'us-east-1',
      service: 'iam',
      credentials: EXAMPLE_CREDENTIALS,
      date: new Date('2015-08-30T12:36:00Z'),
    });

    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, '
      + 'SignedHeaders=content-type;host;x-amz-date, '
      + 'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
    expect(headers.host).toBeUndefined();
  });

  it('double-encodes Bedrock model IDs and signs session tokens (checked against an independent implementation)', () => {
    const body = '{"messages":[{"role":"user","content":[{"text":"hi"}]}]}';
    const headers = signRequest({
      method: 'POST',
      url: `https://bedrock-runtime.us-west-2.amazonaws.com/model/${encodeURIComponent('anthropic.claude-sonnet-4-20250514-v1:0')}/converse`,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body,
      region: 'us-west-2',
      service: 'bedrock',
      credentials: { ...EXAMPLE_CREDENTIALS, sessionToken: 'SESSIONTOKEN123' },
      date: new Date('2026-01-15T08:09:10Z'),
    });

    expect(headers['x-amz-security-token']).toBe('SESSIONTOKEN123');
    expect(headers.authorization).toContain('SignedHeaders=accept;content-type;host;x-amz-date;x-amz-security-token');
    expect(headers.authorization).toContain('Signature=3e14063f75400ba0a55eb7334537bef3f5eb76f996cba91d866c53e2b8a16700');
  });
});

describe('event stream', () => {
  it('computes CRC-32 like zlib', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips messages and reassembles them across arbitrary chunk boundaries', async () => {
    const frames = [
      encodeEventStreamMessage({ ':message-type': 'event', ':event-type': 'a' }, '{"n":1}'),
      encodeEventStreamMessage({ ':message-type': 'event', ':event-type': 'b' }, '{"n":2}'),
    ];
    const all = new Uint8Array(frames[0].length + frames[1].length);
    all.set(frames[0]);
    all.set(frames[1], frames[0].length);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < all.length; i += 7) controller.enqueue(all.slice(i, i + 7));
        controller.close();
      },
    });

    const messages = [];
    for await (const m of readEventStream(body)) messages.push(m);
    expect(messages.map(m => m.headers[':event-type'])).toEqual(['a', 'b']);
    expect(messages.map(m => new TextDecoder().decode(m.payload))).toEqual(['{"n":1}', '{"n":2}']);
  });

  it('rejects corrupted messages', () => {
    const frame = encodeEventStreamMessage({ ':event-type': 'a' }, 'payload');
    frame[frame.length - 6] ^= 0xff;
    expect(() => decodeEventStreamMessage(frame)).toThrow(/checksum/);
  });
});

describe('AWS credentials', () => {
  it('parses INI files', () => {
    expect(parseIni('# c\n[default]\naws_access_key_id = A\n\n[profile dev]\nregion=eu-west-1\n')).toEqual({
      default: { aws_access_key_id: 'A' },
      'profile dev': { region: 'eu-west-1' },
    });
  });

  it('uses environment keys first', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKENV';
    process.env.AWS_SECRET_ACCESS_KEY = 'SKENV';
    process.env.AWS_SESSION_TOKEN = 'TKENV';
    const chain = new AwsCredentialChain();
    expect(chain.source).toBe('environment');
    await expect(chain.get()).resolves.toEqual({ accessKeyId: 'AKENV', secretAccessKey: 'SKENV', sessionToken: 'TKENV' });
  });

  it('reads a profile from the shared files, with its region from the config file', async () => {
    writeFileSync(process.env.AWS_SHARED_CREDENTIALS_FILE!, '[dev]\naws_access_key_id = AKDEV\naws_secret_access_key = SKDEV\n');
    writeFileSync(process.env.AWS_CONFIG_FILE!, '[profile dev]\nregion = eu-central-1\n');
    process.env.AWS_PROFILE = 'dev';

    const chain = new AwsCredentialChain();
    expect(chain.source).toBe('profile dev');
    await expect(chain.get()).resolves.toMatchObject({ accessKeyId: 'AKDEV', secretAccessKey: 'SKDEV' });
    expect(resolveAwsRegion(undefined)).toBe('eu-central-1');
    process.env.AWS_REGION = 'ap-south-1';
    expect(resolveAwsRegion(undefined)).toBe('ap-south-1');
  });

  it('runs credential_process and caches its credentials until they expire', async () => {
    const script = join(dir, 'creds.js');
    const counter = join(dir, 'count.txt');
    writeFileSync(script, `
      const fs = require('fs');
      const n = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
      fs.writeFileSync(${JSON.stringify(counter)}, String(n + 1));
      console.log(JSON.stringify({ Version: 1, AccessKeyId: 'AKP', SecretAccessKey: 'SKP', SessionToken: 'TKP', Expiration: '2099-01-01T00:00:00Z' }));
    `);
    writeFileSync(process.env.AWS_CONFIG_FILE!, `[default]\ncredential_process = "${process.execPath}" "${script}"\n`);

    const chain = new AwsCredentialChain();
    const first = await chain.get();
    const second = await chain.get();
    expect(first).toMatchObject({ accessKeyId: 'AKP', secretAccessKey: 'SKP', sessionToken: 'TKP' });
    expect(second).toBe(first);
    expect((await import('node:fs')).readFileSync(counter, 'utf8')).toBe('1');
  });

  it('explains SSO profiles instead of failing silently', () => {
    writeFileSync(process.env.AWS_CONFIG_FILE!, '[profile sso]\nsso_session = corp\nsso_account_id = 1\n');
    const chain = new AwsCredentialChain({ profile: 'sso' });
    expect(chain.hasCredentials()).toBe(false);
    expect(chain.describeProblem()).toMatch(/credential_process = aws configure export-credentials --profile sso/);
  });

  it('gets container credentials (ECS)', async () => {
    const server = await serve(req => ({
      body: req.headers.authorization === 'secret-token'
        ? { AccessKeyId: 'AKC', SecretAccessKey: 'SKC', Token: 'TKC', Expiration: '2099-01-01T00:00:00Z' }
        : { message: 'denied' },
      status: req.headers.authorization === 'secret-token' ? 200 : 403,
    }));
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = `${server.url}/creds`;
    process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = 'secret-token';
    try {
      const credentials = await new AwsCredentialChain().get();
      expect(credentials).toMatchObject({ accessKeyId: 'AKC', secretAccessKey: 'SKC', sessionToken: 'TKC' });
    } finally {
      delete process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    }
  });
});

const converseReply = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  body: {
    output: { message: { role: 'assistant', content } },
    stopReason: 'end_turn',
    usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cacheReadInputTokens: 100, cacheWriteInputTokens: 10 },
    ...extra,
  },
});

describe('Bedrock', () => {
  it('sends Converse requests with a Bedrock API key and reads text, tool calls, and cache usage', async () => {
    const server = await serve(() => converseReply(
      [{ text: 'Checking.' }, { toolUse: { toolUseId: 'tu1', name: 'weather', input: { city: 'Accra' } } }],
      { stopReason: 'tool_use' },
    ));
    const provider = new BedrockProvider({ apiKey: 'bedrock-key', baseUrl: server.url, region: 'us-west-2' });

    const response = await provider.complete({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Weather?' },
        { role: 'user', content: 'In Accra.' },
      ],
      tools: [{ name: 'weather', description: 'Get weather', parameters: { properties: { city: { type: 'string' } } } }],
      temperature: 0.2,
      cache: true,
    });

    const req = server.requests[0];
    expect(req.url).toBe('/model/anthropic.claude-sonnet-4-20250514-v1%3A0/converse');
    expect(req.headers.authorization).toBe('Bearer bedrock-key');
    expect(req.json.system).toEqual([{ text: 'Be brief.' }, { cachePoint: { type: 'default' } }]);
    // Consecutive user messages are merged; a cache point ends the conversation so far
    expect(req.json.messages).toEqual([
      { role: 'user', content: [{ text: 'Weather?' }, { text: 'In Accra.' }, { cachePoint: { type: 'default' } }] },
    ]);
    expect(req.json.inferenceConfig).toEqual({ maxTokens: 4096, temperature: 0.2 });
    expect(req.json.toolConfig.tools[0].toolSpec.inputSchema.json.type).toBe('object');
    expect(req.json.toolConfig.tools.at(-1)).toEqual({ cachePoint: { type: 'default' } });

    expect(response.content).toBe('Checking.');
    expect(response.toolCalls).toEqual([{ id: 'tu1', name: 'weather', arguments: { city: 'Accra' } }]);
    expect(response.metadata.finishReason).toBe('tool_call');
    expect(response.usage).toEqual({
      promptTokens: 130, completionTokens: 5, totalTokens: 135, cachedTokens: 100, cacheWriteTokens: 10,
    });
  });

  it('signs requests with SigV4 when it has AWS credentials', async () => {
    const server = await serve(() => converseReply([{ text: 'ok' }]));
    const provider = new BedrockProvider({
      baseUrl: server.url, region: 'eu-west-1', accessKeyId: 'AKTEST', secretAccessKey: 'SKTEST', sessionToken: 'TKTEST',
    });
    expect(provider.isAvailable()).toBe(true);

    await provider.complete({ model: 'amazon.nova-pro-v1:0', messages: [{ role: 'user', content: 'hi' }] });

    const headers = server.requests[0].headers;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKTEST\/\d{8}\/eu-west-1\/bedrock\/aws4_request, SignedHeaders=accept;content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
    expect(headers['x-amz-security-token']).toBe('TKTEST');
  });

  it('is unavailable without credentials, and says how to fix it', async () => {
    const provider = new BedrockProvider();
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.complete({ model: '', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/AWS_BEARER_TOKEN_BEDROCK/);
  });

  it('returns Claude reasoning and sends it back first in the tool-use turn', async () => {
    const reasoning = { reasoningText: { text: 'Need the weather tool.', signature: 'sig-abc' } };
    const server = await serve(() => converseReply(
      [{ reasoningContent: reasoning }, { toolUse: { toolUseId: 'tu1', name: 'weather', input: {} } }],
      { stopReason: 'tool_use' },
    ));
    const provider = new BedrockProvider({ apiKey: 'k', baseUrl: server.url });

    const response = await provider.complete({
      model: 'us.anthropic.claude-opus-4-6-v1',
      messages: [{ role: 'user', content: 'Weather?' }],
      reasoning: { effort: 'high' },
      temperature: 0.5,
    });

    const body = server.requests[0].json;
    expect(body.additionalModelRequestFields).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    expect(body.inferenceConfig.temperature).toBeUndefined();
    expect(response.reasoning).toBe('Need the weather tool.');
    expect(response.providerData).toEqual({ bedrock: { reasoning: [{ reasoningContent: reasoning }] } });

    const replay = toBedrockMessages([
      { role: 'user', content: 'Weather?' },
      { role: 'assistant', content: '', toolCalls: response.toolCalls, providerData: response.providerData },
      { role: 'tool', content: '30C', toolCallId: 'tu1' },
    ]);
    expect(replay[1].content[0]).toEqual({ reasoningContent: reasoning });
    expect(replay[2]).toEqual({ role: 'user', content: [{ toolResult: { toolUseId: 'tu1', content: [{ text: '30C' }] } }] });
  });

  it('maps reasoning settings per model family', () => {
    expect(bedrockReasoning('anthropic.claude-sonnet-4-20250514-v1:0', { effort: 'medium' }))
      .toEqual({ fields: { thinking: { type: 'enabled', budget_tokens: 8192 } }, thinking: true, budgetTokens: 8192 });
    expect(bedrockReasoning('us.amazon.nova-2-lite-v1:0', { effort: 'xhigh' }).fields)
      .toEqual({ reasoningConfig: { type: 'enabled', maxReasoningEffort: 'high' } });
    expect(bedrockReasoning('openai.gpt-oss-120b-1:0', { effort: 'low' }).fields).toEqual({ reasoning_effort: 'low' });
    expect(bedrockReasoning('meta.llama3-70b-instruct-v1:0', { effort: 'high' }).fields).toEqual({});
  });

  it('gets JSON matching a schema through a forced tool', async () => {
    const server = await serve(() => converseReply(
      [{ toolUse: { toolUseId: 'tu1', name: 'json_response', input: { city: 'Accra', temp: 31 } } }],
      { stopReason: 'tool_use' },
    ));
    const provider = new BedrockProvider({ apiKey: 'k', baseUrl: server.url });
    const schema = { type: 'object', properties: { city: { type: 'string' }, temp: { type: 'number' } }, required: ['city'] };

    const response = await provider.complete({
      model: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', content: 'Weather in Accra as JSON' }],
      responseFormat: { type: 'json_schema', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema } },
    });

    const toolConfig = server.requests[0].json.toolConfig;
    expect(toolConfig.toolChoice).toEqual({ tool: { name: 'json_response' } });
    expect(toolConfig.tools[0].toolSpec.inputSchema.json).toEqual(schema);
    expect(response.parsed).toEqual({ city: 'Accra', temp: 31 });
    expect(JSON.parse(response.content)).toEqual({ city: 'Accra', temp: 31 });
    expect(response.toolCalls).toBeUndefined();
    expect(response.metadata.finishReason).toBe('stop');
  });

  it('asks other models for JSON with an instruction', async () => {
    const server = await serve(() => converseReply([{ text: '```json\n{"ok":true}\n```' }]));
    const provider = new BedrockProvider({ apiKey: 'k', baseUrl: server.url });
    const response = await provider.complete({
      model: 'meta.llama3-70b-instruct-v1:0',
      messages: [{ role: 'user', content: 'status?' }],
      jsonMode: true,
    });
    expect(server.requests[0].json.system[0].text).toMatch(/valid JSON object/);
    expect(server.requests[0].json.toolConfig).toBeUndefined();
    expect(response.parsed).toEqual({ ok: true });
  });

  it('sends images and documents as bytes or S3 locations, and refuses http URLs and audio', () => {
    const messages = toBedrockMessages([{
      role: 'user',
      content: '',
      parts: [
        { type: 'text', text: 'Compare' },
        { type: 'image', url: 'data:image/jpeg;base64,AAAA' },
        { type: 'file', url: 'data:application/pdf;base64,JVBERi0=', filename: 'Q3 report (final).v2.pdf' },
        { type: 'file', url: 's3://bucket/notes.md', filename: 'Q3 report (final).v2.md' },
      ],
    }]);
    expect(messages[0].content).toEqual([
      { text: 'Compare' },
      { image: { format: 'jpeg', source: { bytes: 'AAAA' } } },
      { document: { format: 'pdf', name: 'Q3 report (final)-v2', source: { bytes: 'JVBERi0=' } } },
      { document: { format: 'md', name: 'Q3 report (final)-v2 (2)', source: { s3Location: { uri: 's3://bucket/notes.md' } } } },
    ]);

    expect(() => toBedrockMessages([{ role: 'user', content: '', parts: [{ type: 'image', url: 'https://x.test/a.png' }] }]))
      .toThrow(/data: URI .* s3:\/\//);
    expect(() => toBedrockMessages([{ role: 'user', content: '', parts: [{ type: 'audio', url: 'data:audio/wav;base64,AA' }] }]))
      .toThrow(/audio/);
  });

  it('streams text, reasoning, tool calls, and usage from the event stream', async () => {
    const frame = (eventType: string, payload: unknown) =>
      encodeEventStreamMessage({ ':message-type': 'event', ':event-type': eventType, ':content-type': 'application/json' }, JSON.stringify(payload));
    const server = await serve(() => ({
      headers: { 'content-type': 'application/vnd.amazon.eventstream' },
      body: [
        frame('messageStart', { role: 'assistant' }),
        frame('contentBlockDelta', { contentBlockIndex: 0, delta: { reasoningContent: { text: 'Think' } } }),
        frame('contentBlockDelta', { contentBlockIndex: 0, delta: { reasoningContent: { signature: 'sig' } } }),
        frame('contentBlockDelta', { contentBlockIndex: 1, delta: { text: 'Let me check' } }),
        frame('contentBlockStart', { contentBlockIndex: 2, start: { toolUse: { toolUseId: 'tu9', name: 'weather' } } }),
        frame('contentBlockDelta', { contentBlockIndex: 2, delta: { toolUse: { input: '{"city":' } } }),
        frame('contentBlockDelta', { contentBlockIndex: 2, delta: { toolUse: { input: '"Lagos"}' } } }),
        frame('messageStop', { stopReason: 'tool_use' }),
        frame('metadata', { usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, metrics: { latencyMs: 5 } }),
      ],
    }));
    const provider = new BedrockProvider({ apiKey: 'k', baseUrl: server.url });

    const chunks = await collect(provider.stream({ model: 'anthropic.claude-sonnet-4-5-20250929-v1:0', messages: [{ role: 'user', content: 'hi' }] }));
    const final = chunks.at(-1)!;

    expect(server.requests[0].url).toBe('/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse-stream');
    expect(server.requests[0].headers.accept).toBe('application/vnd.amazon.eventstream');
    expect(chunks.filter(c => c.reasoning).map(c => c.reasoning)).toEqual(['Think']);
    expect(chunks.filter(c => c.content).map(c => c.content).join('')).toBe('Let me check');
    expect(final).toMatchObject({
      done: true,
      finishReason: 'tool_call',
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      toolCalls: [{ id: 'tu9', name: 'weather', arguments: { city: 'Lagos' } }],
      providerData: { bedrock: { reasoning: [{ reasoningContent: { reasoningText: { text: 'Think', signature: 'sig' } } }] } },
    });
  });

  it('raises stream exceptions with their type and message', async () => {
    const server = await serve(() => ({
      headers: { 'content-type': 'application/vnd.amazon.eventstream' },
      body: [encodeEventStreamMessage(
        { ':message-type': 'exception', ':exception-type': 'throttlingException', ':content-type': 'application/json' },
        JSON.stringify({ message: 'Too many requests' }),
      )],
    }));
    const provider = new BedrockProvider({ apiKey: 'k', baseUrl: server.url });
    await expect(collect(provider.stream({ model: 'amazon.nova-pro-v1:0', messages: [{ role: 'user', content: 'hi' }] })))
      .rejects.toThrow('AWS Bedrock streaming error (throttlingException): Too many requests');
  });

  it('reports API errors with their message', async () => {
    const server = await serve(() => ({ status: 400, body: { message: 'The provided model identifier is invalid.' } }));
    const provider = new BedrockProvider({ apiKey: 'k', baseUrl: server.url, maxRetries: 0 });
    await expect(provider.complete({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('AWS Bedrock API error (400): The provided model identifier is invalid.');
  });

  it('embeds with Titan (one text per request) and Cohere (batched)', async () => {
    const server = await serve(req => req.url.includes('cohere')
      ? { body: { embeddings: { float: req.json.texts.map((_: string, i: number) => [i, i]) } } }
      : { body: { embedding: [req.json.inputText.length] } });

    const titan = new BedrockProvider({ apiKey: 'k', baseUrl: server.url });
    await expect(titan.embedMany(['a', 'bb', 'ccc'])).resolves.toEqual([[1], [2], [3]]);
    expect(server.requests.filter(r => r.url === '/model/amazon.titan-embed-text-v2%3A0/invoke')).toHaveLength(3);

    const cohere = new BedrockProvider({ apiKey: 'k', baseUrl: server.url, embeddingModel: 'cohere.embed-v4:0' });
    await expect(cohere.embedMany(['x', 'y'])).resolves.toEqual([[0, 0], [1, 1]]);
    expect(server.requests.at(-1)!.json).toEqual({ texts: ['x', 'y'], input_type: 'search_document', embedding_types: ['float'] });
  });

  it('lists foundation models and inference profiles', async () => {
    const server = await serve(req => req.url.startsWith('/foundation-models')
      ? {
        body: {
          modelSummaries: [
            { modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0', modelName: 'Claude Sonnet 4.5', providerName: 'Anthropic', inputModalities: ['TEXT', 'IMAGE'], outputModalities: ['TEXT'], responseStreamingSupported: true },
            { modelId: 'amazon.titan-embed-text-v2:0', modelName: 'Titan Text Embeddings V2', providerName: 'Amazon', inputModalities: ['TEXT'], outputModalities: ['EMBEDDING'] },
          ],
        },
      }
      : {
        body: {
          inferenceProfileSummaries: [{
            inferenceProfileId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
            inferenceProfileName: 'Global Claude Sonnet 4.5',
            models: [{ modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0' }],
          }],
        },
      });
    const provider = new BedrockProvider({ apiKey: 'k', controlPlaneUrl: server.url });

    const models = await provider.listModels();
    expect(models.map(m => m.id)).toEqual([
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
      'amazon.titan-embed-text-v2:0',
      'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    ]);
    expect(models[0]).toMatchObject({ name: 'Anthropic Claude Sonnet 4.5', capabilities: { chat: true, vision: true, streaming: true, embeddings: false } });
    expect(models[1].capabilities).toMatchObject({ chat: false, embeddings: true });
    expect(models[2].capabilities).toEqual(models[0].capabilities);
  });
});
