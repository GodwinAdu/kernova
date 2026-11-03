/**
 * Provider request/response shapes, checked against what each API expects.
 * fetch is mocked; nothing leaves the machine.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CompletionRequest, ModelMessage, StreamChunk } from '@kernova/types';
import { AnthropicProvider, toAnthropicMessages } from './anthropic-provider.js';
import { GeminiProvider, toGeminiContents } from './gemini-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { createProviderFromConfig, PROVIDER_CATALOG } from './adapter-registry.js';
import { fetchWithRetry } from './http.js';
import { ModelRouter } from './model-router.js';
import type { ModelProvider } from './provider.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Mock fetch that records request bodies and answers with the given responses in turn. */
function mockFetch(...responses: Array<() => Response>) {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return next();
  }) as typeof fetch;
  return calls;
}

function sse(events: unknown[], { named = false } = {}): Response {
  const text = events
    .map((e) => (named ? `event: ${(e as { type: string }).type}\n` : '') + `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const toolConversation: ModelMessage[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'system', content: 'Summary of the earlier conversation: none' },
  { role: 'user', content: 'Weather in Accra and Lagos?' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'call_1', name: 'weather', arguments: { city: 'Accra' }, metadata: { thoughtSignature: 'sig-1' } },
      { id: 'call_2', name: 'weather', arguments: { city: 'Lagos' } },
    ],
  },
  { role: 'tool', content: '31C', toolCallId: 'call_1' },
  { role: 'tool', content: '29C', toolCallId: 'call_2' },
];

describe('Anthropic', () => {
  it('sends tool_use blocks before the matching tool_result blocks', () => {
    const messages = toAnthropicMessages(toolConversation);

    expect(messages).toEqual([
      { role: 'user', content: 'Weather in Accra and Lagos?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Accra' } },
          { type: 'tool_use', id: 'call_2', name: 'weather', input: { city: 'Lagos' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '31C' },
          { type: 'tool_result', tool_use_id: 'call_2', content: '29C' },
        ],
      },
    ]);
  });

  it('keeps every system message and sends images as image blocks', async () => {
    const calls = mockFetch(() => Response.json({
      id: 'msg', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 3, output_tokens: 1 },
    }));
    await new AnthropicProvider({ apiKey: 'k' }).complete({
      model: '',
      messages: [
        ...toolConversation.slice(0, 2),
        { role: 'user', content: 'What is this?', parts: [{ type: 'text', text: 'What is this?' }, { type: 'image', url: 'data:image/png;base64,AAAA' }] },
      ],
      tools: [{ name: 'weather', description: 'Get weather', parameters: { properties: { city: { type: 'string' } } } }],
    });

    const body = calls[0].body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system).toBe('Be brief.\n\nSummary of the earlier conversation: none');
    expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(body.tools[0].input_schema.type).toBe('object');
  });

  it('streams text and tool calls, with input tokens from message_start', async () => {
    mockFetch(() => sse([
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"Accra"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ], { named: true }));

    const chunks = await collect(new AnthropicProvider({ apiKey: 'k' }).stream({ model: '', messages: [{ role: 'user', content: 'hi' }] }));
    const final = chunks.at(-1)!;

    expect(chunks[0].content).toBe('Checking');
    expect(final.done).toBe(true);
    expect(final.usage).toEqual({ promptTokens: 10, completionTokens: 7, totalTokens: 17 });
    expect(final.toolCalls).toEqual([{ id: 'toolu_1', name: 'weather', arguments: { city: 'Accra' } }]);
    expect(final.finishReason).toBe('tool_call');
  });
});

describe('Gemini', () => {
  it('names each functionResponse after its function and returns thought signatures', () => {
    const contents = toGeminiContents(toolConversation);

    expect(contents[1]).toEqual({
      role: 'model',
      parts: [
        { functionCall: { name: 'weather', args: { city: 'Accra' } }, thoughtSignature: 'sig-1' },
        { functionCall: { name: 'weather', args: { city: 'Lagos' } } },
      ],
    });
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'weather', response: { content: '31C' } } },
        { functionResponse: { name: 'weather', response: { content: '29C' } } },
      ],
    });
  });

  it('sends the key in a header, uses parametersJsonSchema, and registers as "gemini"', async () => {
    const calls = mockFetch(() => Response.json({
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'weather', args: { city: 'Accra' } }, thoughtSignature: 'sig-9' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
    }));
    const provider = new GeminiProvider({ apiKey: 'secret-key' });
    const response = await provider.complete({
      model: '',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'fetch', description: 'Fetch', parameters: { type: 'object', properties: { headers: { type: 'object', additionalProperties: { type: 'string' } } } } }],
    });

    expect(provider.id).toBe('gemini');
    expect(calls[0].url).toContain('/models/gemini-flash-latest:generateContent');
    expect(calls[0].url).not.toContain('secret-key');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
    expect(calls[0].body.tools[0].functionDeclarations[0].parametersJsonSchema.properties.headers.additionalProperties).toEqual({ type: 'string' });
    expect(response.toolCalls?.[0].metadata?.thoughtSignature).toBe('sig-9');
  });
});

describe('OpenAI', () => {
  it('omits temperature and uses max_completion_tokens for reasoning models', async () => {
    const calls = mockFetch(() => Response.json({ id: 'x', model: 'gpt-5', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
    await new OpenAIProvider({ apiKey: 'k' }).complete({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2, stopSequences: ['END'] });

    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.stop).toBeUndefined();
    // Reasoning models think within the output limit, so they get more room by default
    expect(calls[0].body.max_completion_tokens).toBe(16384);
    expect(calls[0].body.max_tokens).toBeUndefined();
  });

  it('streams tool calls and reads usage from the chunk after the finish reason', async () => {
    const calls = mockFetch(() => sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"Accra"}' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
      '[DONE]',
    ]));

    const chunks = await collect(new OpenAIProvider({ apiKey: 'k' }).stream({ model: '', messages: [{ role: 'user', content: 'hi' }] }));
    const final = chunks.at(-1)!;

    expect(calls[0].body.stream_options).toEqual({ include_usage: true });
    expect(final.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
    expect(final.toolCalls).toEqual([{ id: 'call_1', name: 'weather', arguments: { city: 'Accra' } }]);
  });

  it('keeps malformed tool arguments instead of failing the whole response', async () => {
    mockFetch(() => Response.json({
      id: 'x', model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'weather', arguments: '{oops' } }] }, finish_reason: 'tool_calls' }],
    }));
    const response = await new OpenAIProvider({ apiKey: 'k' }).complete({ model: '', messages: [{ role: 'user', content: 'hi' }] });
    expect(response.toolCalls?.[0].arguments).toEqual({ _raw: '{oops' });
  });
});

describe('OpenAI-compatible and the catalog', () => {
  it('local servers work without an API key and send no Authorization header', async () => {
    const provider = createProviderFromConfig({ ...PROVIDER_CATALOG.lmstudio, id: 'lmstudio' });
    expect(provider.isAvailable()).toBe(true);

    const calls = mockFetch(() => Response.json({ id: 'x', model: 'local', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
    await provider.complete({ model: '', messages: [{ role: 'user', content: 'hi' }] });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('hosted providers still require a key', () => {
    const provider = new OpenAICompatibleProvider({ id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'm' });
    expect(provider.isAvailable()).toBe(false);
  });

  it('points Cohere at its OpenAI-compatible endpoint', () => {
    expect(PROVIDER_CATALOG.cohere.baseUrl).toBe('https://api.cohere.ai/compatibility/v1');
  });
});

describe('fetchWithRetry', () => {
  it('retries rate limits and transient errors, honouring retry-after-ms', async () => {
    const calls = mockFetch(
      () => new Response('slow down', { status: 429, headers: { 'retry-after-ms': '1' } }),
      () => new Response('overloaded', { status: 529, headers: { 'retry-after-ms': '1' } }),
      () => new Response('ok', { status: 200 }),
    );
    const response = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 2);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('does not retry client errors', async () => {
    const calls = mockFetch(() => new Response('bad request', { status: 400 }));
    const response = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 2);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});

describe('ModelRouter', () => {
  const provider = (id: string, tokens: number, embed?: () => Promise<number[]>): ModelProvider => ({
    id,
    name: id,
    isAvailable: () => true,
    async complete(request: CompletionRequest) {
      await new Promise((r) => setTimeout(r, 5));
      return {
        content: 'ok', model: request.model, provider: id,
        usage: { promptTokens: tokens, completionTokens: 0, totalTokens: tokens },
        metadata: { latencyMs: 1, finishReason: 'stop' as const },
      };
    },
    ...(embed && { embed }),
  });

  it('measures usage per scope, even when scopes run concurrently', async () => {
    const router = new ModelRouter({
      routing: { default: { provider: 'a', model: 'm' }, overrides: { vision: { provider: 'b', model: 'm' } } },
      providers: [provider('a', 10), provider('b', 1000)],
    });

    const [small, large] = await Promise.all([
      router.measureUsage(async () => {
        await router.complete({ model: '', messages: [] });
        await router.complete({ model: '', messages: [] });
      }),
      router.measureUsage(() => router.complete({ model: '', messages: [], metadata: { purpose: 'vision' } })),
    ]);

    expect(small.usage.totalTokens).toBe(20);
    // metadata.purpose selects the override route
    expect(large.usage.totalTokens).toBe(1000);
  });

  it('falls through to the next provider when one cannot embed', async () => {
    const router = new ModelRouter({
      routing: { default: { provider: 'a', model: 'm' } },
      providers: [
        provider('a', 0, async () => { throw new Error('no embeddings'); }),
        provider('b', 0, async () => [1, 2, 3]),
      ],
    });
    await expect(router.embed('text')).resolves.toEqual([1, 2, 3]);
  });
});
