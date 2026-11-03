/**
 * Model features across providers: structured output, reasoning, prompt caching, audio and
 * file input, usage details, model listing, batch embeddings, the router, and the catalog.
 * Each provider talks to a local fake of its API.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import type { CompletionRequest, ModelInfo, StreamChunk } from '@kernova/types';
import { OpenAIProvider } from './openai-provider.js';
import { OpenAICompatibleProvider, toOpenAIMessages } from './openai-compatible-provider.js';
import { AnthropicProvider, anthropicThinking, claudeOutputSchema, supportsAdaptiveThinking, toAnthropicMessages } from './anthropic-provider.js';
import { GeminiProvider, geminiThinking } from './gemini-provider.js';
import { OllamaProvider, ollamaThink } from './ollama-provider.js';
import { AzureOpenAIProvider } from './azure-provider.js';
import { BedrockProvider } from './bedrock-provider.js';
import { createProviderFromConfig, detectProvidersFromCatalog, PROVIDER_CATALOG } from './adapter-registry.js';
import { createProvider } from './presets.js';
import { ModelRouter } from './model-router.js';
import type { ModelProvider } from './provider.js';
import { fakeServer, sseBody, type FakeServer } from '../__tests__/fake-server.js';

const servers: FakeServer[] = [];
afterEach(async () => {
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

const user = (content: string): CompletionRequest['messages'] => [{ role: 'user', content }];

const chat = (message: Record<string, unknown>, usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }) => ({
  body: { id: 'r', model: 'm', choices: [{ message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage },
});

const compatible = (url: string, extra: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}) =>
  new OpenAICompatibleProvider({ id: 'compat', name: 'Compat', baseUrl: url, apiKey: 'k', defaultModel: 'm', ...extra });

describe('OpenAI-compatible APIs', () => {
  it('asks for JSON matching a schema and returns it parsed', async () => {
    const server = await serve(() => chat({ content: '{"city":"Accra"}' }));
    const response = await new OpenAIProvider({ apiKey: 'k', baseUrl: server.url }).complete({
      model: 'gpt-4o',
      messages: user('Where?'),
      responseFormat: {
        type: 'json_schema', name: 'place', strict: true,
        schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { city: { type: 'string' } } },
      },
    });

    expect(server.requests[0].json.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'place', strict: true, schema: { type: 'object', properties: { city: { type: 'string' } } } },
    });
    expect(response.parsed).toEqual({ city: 'Accra' });
  });

  it('adds the word JSON to the prompt for JSON mode when it is missing', async () => {
    const server = await serve(() => chat({ content: 'not json' }));
    const provider = compatible(server.url);

    const response = await provider.complete({ model: '', messages: user('Status?'), jsonMode: true });
    expect(server.requests[0].json.response_format).toEqual({ type: 'json_object' });
    expect(server.requests[0].json.messages[0]).toEqual({ role: 'system', content: 'Respond with only a valid JSON object, with no other text.' });
    expect(response.parsed).toBeUndefined();

    await provider.complete({ model: '', messages: user('Status as JSON?'), responseFormat: { type: 'json' } });
    expect(server.requests[1].json.messages).toHaveLength(1);
  });

  it("sends reasoning settings in each API's format", async () => {
    const server = await serve(() => chat({ content: 'ok' }));
    const bodyFor = async (provider: ModelProvider, model: string, reasoning: CompletionRequest['reasoning']) => {
      await provider.complete({ model, messages: user('hi'), reasoning, temperature: 0.4 });
      return server.requests.at(-1)!.json;
    };

    const openai = await bodyFor(new OpenAIProvider({ apiKey: 'k', baseUrl: server.url }), 'gpt-5.1', { effort: 'xhigh' });
    expect(openai.reasoning_effort).toBe('xhigh');
    expect(openai.temperature).toBeUndefined();
    // Reasoning models think within the output limit, so they get more room by default
    expect(openai.max_completion_tokens).toBe(16384);
    expect((await bodyFor(new OpenAIProvider({ apiKey: 'k', baseUrl: server.url }), 'gpt-5.1', { effort: 'max' })).reasoning_effort).toBe('xhigh');

    expect((await bodyFor(compatible(`${server.url}/openrouter.ai`), 'x', { effort: 'low' })).reasoning).toEqual({ effort: 'low' });
    expect((await bodyFor(compatible(server.url, { reasoningFormat: 'openrouter' }), 'x', { budgetTokens: 2000 })).reasoning)
      .toEqual({ max_tokens: 2000 });
    expect(await bodyFor(compatible(server.url, { reasoningFormat: 'qwen' }), 'qwen3', { effort: 'high', budgetTokens: 500 }))
      .toMatchObject({ enable_thinking: true, thinking_budget: 500 });
    expect((await bodyFor(compatible(server.url, { reasoningFormat: 'zai' }), 'glm', { effort: 'none' })).thinking)
      .toEqual({ type: 'disabled' });
    const none = await bodyFor(compatible(server.url, { reasoningFormat: 'none' }), 'x', { effort: 'high' });
    expect(none.reasoning_effort).toBeUndefined();
    expect(none.reasoning).toBeUndefined();
  });

  it('sends audio and files as base64 parts, and refuses URLs for them', () => {
    const [message] = toOpenAIMessages([{
      role: 'user', content: '',
      parts: [
        { type: 'audio', url: 'data:audio/mpeg;base64,SUQz' },
        { type: 'file', url: 'data:application/pdf;base64,JVBERi0=', filename: 'report.pdf' },
        { type: 'file', url: 'data:application/pdf;base64,JVBERi0=' },
      ],
    }]);
    expect(message.content).toEqual([
      { type: 'input_audio', input_audio: { data: 'SUQz', format: 'mp3' } },
      { type: 'file', file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } },
      { type: 'file', file: { filename: 'file.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } },
    ]);
    expect(() => toOpenAIMessages([{ role: 'user', content: '', parts: [{ type: 'audio', url: 'https://x.test/a.mp3' }] }], { providerName: 'Groq' }))
      .toThrow('Groq needs audio input as a data: URI (base64), not a URL (https://x.test/a.mp3)');
  });

  it('reports cached and reasoning tokens', async () => {
    const server = await serve((_req, i) => chat({ content: 'ok' }, i === 0
      ? { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_tokens_details: { cached_tokens: 64 }, completion_tokens_details: { reasoning_tokens: 30 } }
      : { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 80 }));
    const provider = compatible(server.url);

    expect((await provider.complete({ model: '', messages: user('a') })).usage)
      .toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 64, reasoningTokens: 30 });
    expect((await provider.complete({ model: '', messages: user('b') })).usage)
      .toEqual({ promptTokens: 100, completionTokens: 5, totalTokens: 105, cachedTokens: 80 });
  });

  it('returns reasoning_content, and sends it back during tool use only when the API needs it', async () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{}' } };
    const server = await serve(() => chat({ content: '', reasoning_content: 'I should look it up.', tool_calls: [toolCall] }));

    const kimi = compatible(server.url, { id: 'moonshot', replayReasoning: true });
    const response = await kimi.complete({ model: '', messages: user('?') });
    expect(response.reasoning).toBe('I should look it up.');
    expect(response.providerData).toEqual({ moonshot: { reasoning_content: 'I should look it up.' } });

    const history = [
      ...user('?'),
      { role: 'assistant' as const, content: '', toolCalls: response.toolCalls, providerData: response.providerData },
      { role: 'tool' as const, content: 'found', toolCallId: 'c1' },
    ];
    await kimi.complete({ model: '', messages: history });
    expect(server.requests[1].json.messages[1].reasoning_content).toBe('I should look it up.');

    const other = compatible(server.url);
    expect((await other.complete({ model: '', messages: user('?') })).providerData).toBeUndefined();
    await other.complete({ model: '', messages: history });
    expect(server.requests[3].json.messages[1].reasoning_content).toBeUndefined();
  });

  it('streams reasoning deltas', async () => {
    const server = await serve(() => ({
      headers: { 'content-type': 'text/event-stream' },
      body: sseBody([
        { choices: [{ delta: { reasoning_content: 'Hmm. ' }, finish_reason: null }] },
        { choices: [{ delta: { reasoning: 'Yes.' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }] },
        '[DONE]',
      ]),
    }));
    const chunks = await collect(compatible(server.url).stream({ model: '', messages: user('?') }));
    expect(chunks.filter(c => c.reasoning).map(c => c.reasoning)).toEqual(['Hmm. ', 'Yes.']);
    expect(chunks.map(c => c.content).join('')).toBe('Answer');
  });

  it('lists models with the details each API reports', async () => {
    const server = await serve(req => req.url.includes('together')
      ? { body: [{ id: 'meta/llama', display_name: 'Llama', type: 'chat', context_length: 131072, created: 1700000000 }] }
      : {
        body: {
          data: [{
            id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', context_length: 200000, created: 1747930371,
            top_provider: { max_completion_tokens: 64000 },
            architecture: { input_modalities: ['text', 'image', 'file'] },
            supported_parameters: ['tools', 'reasoning', 'structured_outputs'],
          }],
        },
      });

    const [router] = await compatible(server.url, { id: 'openrouter' }).listModels();
    expect(server.requests[0].url).toBe('/models');
    expect(router).toEqual({
      id: 'anthropic/claude-sonnet-4', provider: 'openrouter', name: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 64000,
      capabilities: { vision: true, audio: false, files: true, toolCalling: true, reasoning: true, structuredOutput: true },
      createdAt: new Date(1747930371000).toISOString(),
    });

    const [together] = await compatible(`${server.url}/together`).listModels();
    expect(together).toMatchObject({ id: 'meta/llama', name: 'Llama', contextWindow: 131072, capabilities: { chat: true } });
  });

  it('embeds many texts in batches, in input order', async () => {
    const server = await serve(req => ({
      body: { data: req.json.input.map((t: string, index: number) => ({ index, embedding: [Number(t)] })).reverse() },
    }));
    const provider = compatible(server.url, { supportsEmbeddings: true, embeddingModel: 'embed-1' });
    const texts = Array.from({ length: 130 }, (_, i) => String(i));

    const vectors = await provider.embedMany(texts);
    expect(vectors.map(v => v[0])).toEqual(texts.map(Number));
    expect(server.requests.map(r => r.json.input.length)).toEqual([128, 2]);
    await expect(provider.embed('7')).resolves.toEqual([7]);
  });
});

const claude = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  body: {
    id: 'msg', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content,
    usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 500, cache_creation_input_tokens: 20 },
    ...extra,
  },
});

describe('Anthropic', () => {
  it('thinks adaptively with an effort level on Claude 4.6 and later, without a temperature', async () => {
    const server = await serve(() => claude([{ type: 'text', text: 'ok' }]));
    await new AnthropicProvider({ apiKey: 'k', baseUrl: server.url }).complete({
      model: 'claude-sonnet-5-5', messages: user('hi'), reasoning: { effort: 'minimal' }, temperature: 0.2,
    });
    const body = server.requests[0].json;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(16384);
  });

  it('never sends a token budget to Claude 4.6 and later (4.7 and later reject it), and turns thinking off for none', () => {
    expect(anthropicThinking('claude-opus-5-5', { budgetTokens: 10000 }))
      .toEqual({ thinking: { type: 'adaptive' }, effort: 'medium', on: true });
    expect(anthropicThinking('claude-sonnet-4-6', { effort: 'max' }))
      .toEqual({ thinking: { type: 'adaptive' }, effort: 'max', on: true });
    expect(anthropicThinking('claude-sonnet-5-5', { effort: 'none' })).toEqual({ thinking: { type: 'disabled' }, on: false });
    expect(anthropicThinking('claude-opus-4-1-20250805', { effort: 'max' }))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 27648 }, budgetTokens: 27648, on: true });
    expect(anthropicThinking('claude-opus-4-1-20250805', { effort: 'none' })).toEqual({ on: false });
  });

  it('gives older models a thinking budget, with room for the answer', async () => {
    const server = await serve(() => claude([{ type: 'text', text: 'ok' }]));
    const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: server.url });
    await provider.complete({ model: 'claude-sonnet-4-20250514', messages: user('hi'), reasoning: { effort: 'high' } });
    expect(server.requests[0].json.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
    expect(server.requests[0].json.max_tokens).toBe(20480);
    expect(server.requests[0].json.output_config).toBeUndefined();

    await expect(provider.complete({ model: 'claude-sonnet-4-5', messages: user('hi'), maxTokens: 2000, reasoning: { budgetTokens: 4000 } }))
      .rejects.toThrow('maxTokens (2000) must be greater than the thinking budget (4000)');
    expect(supportsAdaptiveThinking('claude-opus-4-1-20250805')).toBe(false);
    expect(supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
    expect(supportsAdaptiveThinking('claude-3-7-sonnet-20250219')).toBe(false);
    expect(supportsAdaptiveThinking('claude-fable-5-1')).toBe(true);
  });

  it('uses structured output for schemas (closing objects) and an instruction for plain JSON', async () => {
    const server = await serve(() => claude([{ type: 'text', text: '{"tags":[{"name":"a"}]}' }]));
    const provider = new AnthropicProvider({ apiKey: 'k', baseUrl: server.url });
    const schema = {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } },
    };

    const response = await provider.complete({ model: '', messages: user('Tags?'), responseFormat: { type: 'json_schema', schema } });
    expect(server.requests[0].json.output_config.format).toEqual({
      type: 'json_schema',
      schema: {
        type: 'object', additionalProperties: false,
        properties: { tags: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } } } },
      },
    });
    expect(response.parsed).toEqual({ tags: [{ name: 'a' }] });

    await provider.complete({ model: '', messages: [{ role: 'system', content: 'Be brief.' }, ...user('Tags?')], jsonMode: true });
    expect(server.requests[1].json.system).toBe('Be brief.\n\nRespond with only a valid JSON object, with no other text.');
  });

  it("rewrites schemas the way Claude's structured output needs them", () => {
    expect(claudeOutputSchema({
      type: 'object',
      additionalProperties: true,
      properties: {
        age: { type: 'integer', minimum: 0, maximum: 150, description: 'Age in years' },
        tags: { type: 'array', items: { type: 'string', maxLength: 20 }, minItems: 2 },
        one: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    })).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        age: { type: 'integer', description: 'Age in years (minimum: 0, maximum: 150)' },
        tags: { type: 'array', items: { type: 'string', description: '(maxLength: 20)' }, description: '(minItems: 2)' },
        one: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    });
  });

  it('marks tools, the system prompt, and the conversation as cacheable, and reports cache usage', async () => {
    const server = await serve(() => claude([{ type: 'text', text: 'ok' }]));
    const response = await new AnthropicProvider({ apiKey: 'k', baseUrl: server.url }).complete({
      model: '',
      messages: [{ role: 'system', content: 'Long instructions' }, ...user('First'), { role: 'assistant', content: 'Hi' }, ...user('Second')],
      tools: [{ name: 'a', description: 'A', parameters: {} }, { name: 'b', description: 'B', parameters: {} }],
      cache: true,
    });
    const body = server.requests[0].json;
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system).toEqual([{ type: 'text', text: 'Long instructions', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages.at(-1).content).toEqual([{ type: 'text', text: 'Second', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages[0].content).toBe('First');
    expect(response.usage).toEqual({ promptTokens: 530, completionTokens: 4, totalTokens: 534, cachedTokens: 500, cacheWriteTokens: 20 });
  });

  it('sends PDFs and text files as documents, and refuses audio', () => {
    const [message] = toAnthropicMessages([{
      role: 'user', content: '',
      parts: [
        { type: 'file', url: 'data:application/pdf;base64,JVBERi0=', filename: 'spec.pdf' },
        { type: 'file', url: 'https://x.test/paper.pdf' },
        { type: 'file', url: `data:text/plain;base64,${Buffer.from('notes').toString('base64')}` },
      ],
    }]);
    expect(message.content).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' }, title: 'spec.pdf' },
      { type: 'document', source: { type: 'url', url: 'https://x.test/paper.pdf' } },
      { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'notes' } },
    ]);
    expect(() => toAnthropicMessages([{ role: 'user', content: '', parts: [{ type: 'audio', url: 'data:audio/wav;base64,AA' }] }]))
      .toThrow(/audio/);
    expect(() => toAnthropicMessages([{ role: 'user', content: '', parts: [{ type: 'file', url: 'data:application/zip;base64,AA' }] }]))
      .toThrow(/not application\/zip/);
  });

  it('returns thinking and sends the signed blocks back with the tool results', async () => {
    const thinking = { type: 'thinking', thinking: 'Use the tool.', signature: 'sig-1' };
    const server = await serve(() => claude(
      [thinking, { type: 'tool_use', id: 'tu1', name: 'weather', input: {} }],
      { stop_reason: 'tool_use' },
    ));
    const response = await new AnthropicProvider({ apiKey: 'k', baseUrl: server.url }).complete({
      model: '', messages: user('Weather?'), reasoning: { effort: 'high' },
    });
    expect(response.reasoning).toBe('Use the tool.');
    expect(response.providerData).toEqual({ anthropic: { thinking: [thinking] } });

    const replay = toAnthropicMessages([
      ...user('Weather?'),
      { role: 'assistant', content: '', toolCalls: response.toolCalls, providerData: response.providerData },
      { role: 'tool', content: '30C', toolCallId: 'tu1' },
    ]);
    expect(replay[1].content).toEqual([thinking, { type: 'tool_use', id: 'tu1', name: 'weather', input: {} }]);
  });

  it('streams thinking and keeps its signature for the next turn', async () => {
    const server = await serve(() => ({
      headers: { 'content-type': 'text/event-stream' },
      body: sseBody([
        { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-9' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'weather' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ]),
    }));
    const chunks = await collect(new AnthropicProvider({ apiKey: 'k', baseUrl: server.url }).stream({ model: '', messages: user('?') }));
    expect(chunks.find(c => c.reasoning)?.reasoning).toBe('Plan.');
    expect(chunks.at(-1)!.providerData).toEqual({ anthropic: { thinking: [{ type: 'thinking', thinking: 'Plan.', signature: 'sig-9' }] } });
  });

  it('lists models across pages', async () => {
    const server = await serve(req => req.url.includes('after_id')
      ? { body: { data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }, { id: 'claude-2', lifecycle: 'retired' }], has_more: false } }
      : {
        body: {
          data: [{
            id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-06-01T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000,
            lifecycle: 'active',
            capabilities: { image_input: { supported: true }, pdf_input: { supported: true }, structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } } },
          }],
          has_more: true, last_id: 'claude-sonnet-5-5',
        },
      });
    const models = await new AnthropicProvider({ apiKey: 'k', baseUrl: server.url }).listModels();
    expect(server.requests[1].url).toBe('/v1/models?limit=1000&after_id=claude-sonnet-5-5');
    expect(server.requests[0].headers['x-api-key']).toBe('k');
    expect(models.map(m => m.id)).toEqual(['claude-sonnet-5-5', 'claude-haiku-4-5']);
    expect(models[0]).toMatchObject({
      name: 'Claude Sonnet 5.5', contextWindow: 1000000, maxOutputTokens: 128000, createdAt: '2026-06-01T00:00:00Z',
      capabilities: { vision: true, files: true, structuredOutput: true, reasoning: true },
    });
  });
});

describe('Gemini', () => {
  it('maps reasoning to thinkingLevel on Gemini 3 and thinkingBudget on 2.5', () => {
    expect(geminiThinking('gemini-3-flash-preview', { effort: 'none' })).toEqual({ thinkingLevel: 'minimal' });
    expect(geminiThinking('gemini-3-flash-preview', { effort: 'medium', includeThoughts: true })).toEqual({ thinkingLevel: 'medium', includeThoughts: true });
    expect(geminiThinking('gemini-3-pro-preview', { effort: 'minimal' })).toEqual({ thinkingLevel: 'low' });
    expect(geminiThinking('gemini-2.5-flash', { effort: 'none' })).toEqual({ thinkingBudget: 0 });
    expect(geminiThinking('gemini-2.5-flash', { effort: 'xhigh' })).toEqual({ thinkingBudget: 24576 });
    expect(geminiThinking('gemini-2.5-pro', { effort: 'xhigh' })).toEqual({ thinkingBudget: 32768 });
    expect(geminiThinking('gemini-3-flash-preview', { budgetTokens: 2048 })).toEqual({ thinkingBudget: 2048 });
    expect(geminiThinking('gemini-2.0-flash', { effort: 'high' })).toBeUndefined();
    expect(geminiThinking('gemini-flash-latest', undefined)).toBeUndefined();
  });

  it('sends audio, video, and PDFs as inline data', async () => {
    const server = await serve(() => ({ body: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } }));
    await new GeminiProvider({ apiKey: 'k', baseUrl: server.url }).complete({
      model: 'gemini-3-flash-preview',
      messages: [{
        role: 'user', content: '',
        parts: [{ type: 'audio', url: 'data:audio/wav;base64,UklG' }, { type: 'file', url: 'data:application/pdf;base64,JVBE' }, { type: 'file', url: 'gs://b/v.mp4' }],
      }],
    });
    expect(server.requests[0].url).toBe('/models/gemini-3-flash-preview:generateContent');
    expect(server.requests[0].json.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'audio/wav', data: 'UklG' } },
      { inlineData: { mimeType: 'application/pdf', data: 'JVBE' } },
      { fileData: { mimeType: 'video/mp4', fileUri: 'gs://b/v.mp4' } },
    ]);
  });

  it('embeds in batches of 100 with batchEmbedContents', async () => {
    const server = await serve(req => ({
      body: { embeddings: req.json.requests.map((r: { content: { parts: Array<{ text: string }> } }) => ({ values: [Number(r.content.parts[0].text)] })) },
    }));
    const texts = Array.from({ length: 150 }, (_, i) => String(i));
    const vectors = await new GeminiProvider({ apiKey: 'k', baseUrl: server.url }).embedMany(texts);
    expect(vectors.map(v => v[0])).toEqual(texts.map(Number));
    expect(server.requests.map(r => r.url)).toEqual([
      '/models/gemini-embedding-001:batchEmbedContents', '/models/gemini-embedding-001:batchEmbedContents',
    ]);
    expect(server.requests[0].json.requests[0].model).toBe('models/gemini-embedding-001');
  });

  it('lists models with their limits and methods', async () => {
    const server = await serve(() => ({
      body: {
        models: [
          { name: 'models/gemini-3-flash-preview', displayName: 'Gemini 3 Flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'], thinking: true },
          { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      },
    }));
    const models = await new GeminiProvider({ apiKey: 'k', baseUrl: server.url }).listModels();
    expect(server.requests[0].headers['x-goog-api-key']).toBe('k');
    expect(models).toEqual([
      { id: 'gemini-3-flash-preview', provider: 'gemini', name: 'Gemini 3 Flash', contextWindow: 1048576, maxOutputTokens: 65536, capabilities: { chat: true, embeddings: false, reasoning: true } },
      { id: 'gemini-embedding-001', provider: 'gemini', capabilities: { chat: false, embeddings: true } },
    ]);
  });
});

describe('Ollama', () => {
  it('sends think and format, and returns the thinking', async () => {
    const server = await serve(() => ({
      body: { model: 'qwen3', message: { role: 'assistant', content: '{"a":1}', thinking: 'Let me see.' }, done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 4 },
    }));
    const provider = new OllamaProvider({ baseUrl: server.url });
    const schema = { type: 'object', properties: { a: { type: 'number' } } };

    const response = await provider.complete({ model: 'qwen3', messages: user('?'), reasoning: { effort: 'high' }, responseFormat: { type: 'json_schema', schema } });
    expect(server.requests[0].json).toMatchObject({ think: true, format: schema });
    expect(response.reasoning).toBe('Let me see.');
    expect(response.parsed).toEqual({ a: 1 });

    expect(ollamaThink('gpt-oss:20b', { effort: 'xhigh' })).toBe('high');
    expect(ollamaThink('qwen3', { effort: 'none' })).toBe(false);
    expect(ollamaThink('qwen3', undefined)).toBeUndefined();
  });

  it('embeds many texts in one request with the embedding model, and lists pulled models', async () => {
    const server = await serve(req => req.url === '/api/embed'
      ? { body: { embeddings: req.json.input.map((t: string) => [t.length]) } }
      : { body: { models: [{ name: 'llama3.1:8b', model: 'llama3.1:8b', modified_at: '2026-05-01T00:00:00Z', details: { parameter_size: '8.0B' } }] } });
    const provider = new OllamaProvider({ baseUrl: server.url, embeddingModel: 'nomic-embed-text' });

    await expect(provider.embedMany(['a', 'bb'])).resolves.toEqual([[1], [2]]);
    expect(server.requests[0].json).toEqual({ model: 'nomic-embed-text', input: ['a', 'bb'] });
    await expect(provider.listModels()).resolves.toEqual([
      { id: 'llama3.1:8b', provider: 'ollama', name: 'llama3.1:8b 8.0B', createdAt: '2026-05-01T00:00:00Z' },
    ]);
  });

  it('says how to start Ollama when it is not running', async () => {
    const closed = await serve(() => ({ body: {} }));
    await closed.close();
    servers.pop();
    const provider = new OllamaProvider({ baseUrl: closed.url });
    await expect(provider.complete({ model: '', messages: user('hi') })).rejects.toThrow('Ollama is not running. Start it with: ollama serve');
    expect(provider.isAvailable()).toBe(false);
  });

  it('refuses audio and files, and image URLs', async () => {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:9' });
    await expect(provider.complete({ model: '', messages: [{ role: 'user', content: '', parts: [{ type: 'audio', url: 'data:audio/wav;base64,AA' }] }] }))
      .rejects.toThrow('Ollama accepts text and images, not audio input');
    await expect(provider.complete({ model: '', messages: [{ role: 'user', content: '', parts: [{ type: 'image', url: 'https://x.test/a.png' }] }] }))
      .rejects.toThrow(/data: URIs/);
  });
});

describe('ModelRouter', () => {
  const fake = (id: string, extra: Partial<ModelProvider> = {}): ModelProvider => ({
    id, name: id, isAvailable: () => true,
    complete: async (req) => ({
      content: 'ok', model: req.model, provider: id,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 8, reasoningTokens: 3 },
      metadata: { latencyMs: 1, finishReason: 'stop' },
    }),
    ...extra,
  });

  it('lists the models of every provider, leaving out those whose listing fails', async () => {
    const router = new ModelRouter({
      routing: { default: { provider: 'a', model: '' } },
      providers: [
        fake('a', { listModels: async () => [{ id: 'a-1', provider: 'a' }] satisfies ModelInfo[] }),
        fake('b', { listModels: async () => { throw new Error('down'); } }),
        fake('c'),
      ],
    });
    await expect(router.listModels()).resolves.toEqual([{ id: 'a-1', provider: 'a' }]);
    await expect(router.listModels('b')).rejects.toThrow('down');
    await expect(router.listModels('c')).rejects.toThrow("c can't list its models.");
    await expect(router.listModels('zzz')).rejects.toThrow(/not registered/);
  });

  it('embeds many texts with embedMany, or one at a time with embed', async () => {
    const router = new ModelRouter({
      routing: { default: { provider: 'a', model: '' } },
      providers: [fake('a', { embed: async (t) => [t.length] })],
    });
    await expect(router.embedMany(['a', 'bbb'])).resolves.toEqual([[1], [3]]);
  });

  it('adds cached and reasoning tokens to its totals and to measured scopes', async () => {
    const router = new ModelRouter({ routing: { default: { provider: 'a', model: '' } }, providers: [fake('a')] });
    const { usage } = await router.measureUsage(async () => {
      await router.complete({ model: '', messages: user('a') });
      await router.complete({ model: '', messages: user('b') });
    });
    expect(usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30, cachedTokens: 16, reasoningTokens: 6 });
    expect(router.getUsageStats().usage).toMatchObject({ cachedTokens: 16, reasoningTokens: 6 });
  });
});

describe('provider catalog', () => {
  const ENV = [
    'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
    'AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS', 'HF_TOKEN',
    'OPENAI_BASE_URL', 'OPENAI_MODEL', 'ANTHROPIC_BASE_URL', 'OLLAMA_HOST',
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV) { saved[key] = process.env[key]; delete process.env[key]; }
  });
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('includes the cloud platforms and the newer OpenAI-compatible APIs', () => {
    expect(PROVIDER_CATALOG.azure.adapter).toBe('azure');
    expect(PROVIDER_CATALOG.bedrock.adapter).toBe('bedrock');
    expect(PROVIDER_CATALOG.vertex.adapter).toBe('vertex');
    expect(PROVIDER_CATALOG.huggingface.baseUrl).toBe('https://router.huggingface.co/v1');
    expect(PROVIDER_CATALOG.nvidia.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(PROVIDER_CATALOG.qwen.baseUrl).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    expect(PROVIDER_CATALOG.moonshot.baseUrl).toBe('https://api.moonshot.ai/v1');
    expect(PROVIDER_CATALOG.zai.baseUrl).toBe('https://api.z.ai/api/paas/v4');
  });

  it("follows Kimi K3's rules: no temperature, max_completion_tokens, and only low, high, or max effort", async () => {
    const server = await serve(() => chat({ content: 'ok' }));
    const kimi = createProvider('moonshot', { apiKey: 'k', baseUrl: server.url });
    await kimi.complete({ model: '', messages: user('hi'), reasoning: { effort: 'medium' }, temperature: 0.3 });
    const body = server.requests[0].json;
    expect(body.model).toBe('kimi-k3.1-pro');
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBe('high');
    expect(body.max_completion_tokens).toBe(16384);
    expect(body.max_tokens).toBeUndefined();
  });

  it("follows GLM's rules: GLM-5.3 can't turn thinking off, GLM-4.x only switches it", async () => {
    const server = await serve(() => chat({ content: 'ok' }));
    const glm = createProvider('zai', { apiKey: 'k', baseUrl: server.url });
    const fields = async (model: string, effort: 'none' | 'medium' | 'xhigh') => {
      await glm.complete({ model, messages: user('hi'), reasoning: { effort } });
      const { thinking, reasoning_effort } = server.requests.at(-1)!.json;
      return { thinking, reasoning_effort };
    };
    expect(await fields('', 'none')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
    expect(await fields('glm-5.3', 'xhigh')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' });
    expect(await fields('glm-5.2', 'medium')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'medium' });
    expect(await fields('glm-5.2', 'none')).toEqual({ thinking: { type: 'disabled' }, reasoning_effort: undefined });
    expect(await fields('glm-4.6', 'medium')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: undefined });
  });

  it('creates providers by alias, with adapter options added to the catalog defaults', async () => {
    expect(createProvider('azure_openai', { options: { endpoint: 'https://r.openai.azure.com' }, apiKey: 'k' })).toBeInstanceOf(AzureOpenAIProvider);
    const bedrock = createProvider('aws-bedrock', { options: { region: 'eu-west-3' }, apiKey: 'k' });
    expect(bedrock).toBeInstanceOf(BedrockProvider);
    expect((bedrock as BedrockProvider).region).toBe('eu-west-3');
    expect(createProvider('kimi', { apiKey: 'k' }).id).toBe('moonshot');

    const server = await serve(() => chat({ content: 'ok' }));
    const qwen = createProvider('dashscope', { apiKey: 'k', baseUrl: server.url, options: { embeddingModel: 'text-embedding-v4' } });
    await qwen.complete({ model: '', messages: user('hi'), reasoning: { effort: 'none' } });
    // The catalog's reasoning format survives the added option
    expect(server.requests[0].json.enable_thinking).toBe(false);
  });

  it('detects cloud platforms only when the environment sets them up', () => {
    const ids = () => detectProvidersFromCatalog().map(p => p.id);

    process.env.AWS_ACCESS_KEY_ID = 'AK';
    process.env.AWS_SECRET_ACCESS_KEY = 'SK';
    process.env.AZURE_OPENAI_API_KEY = 'k';
    expect(ids()).not.toContain('bedrock');
    expect(ids()).not.toContain('azure');

    process.env.AWS_BEARER_TOKEN_BEDROCK = 'bk';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://r.openai.azure.com';
    process.env.HF_TOKEN = 'hf';
    expect(ids()).toEqual(expect.arrayContaining(['bedrock', 'azure', 'huggingface']));
  });

  it('lets OPENAI_BASE_URL, OPENAI_MODEL, ANTHROPIC_BASE_URL, and OLLAMA_HOST override the catalog defaults', async () => {
    const server = await serve(req => req.url === '/api/chat'
      ? { body: { model: 'llama3.1', message: { role: 'assistant', content: 'ok' }, done: true } }
      : req.url.startsWith('/v1/messages') ? claude([{ type: 'text', text: 'ok' }]) : chat({ content: 'ok' }));
    process.env.OPENAI_BASE_URL = `${server.url}/v1`;
    process.env.OPENAI_MODEL = 'gpt-from-env';
    process.env.ANTHROPIC_BASE_URL = server.url;

    const openai = createProvider('openai', { apiKey: 'k' });
    expect(openai.defaultModel).toBe('gpt-from-env');
    await openai.complete({ model: '', messages: user('hi') });
    expect(server.requests[0]).toMatchObject({ url: '/v1/chat/completions', json: { model: 'gpt-from-env' } });

    await createProvider('anthropic', { apiKey: 'k' }).complete({ model: '', messages: user('hi') });
    expect(server.requests[1].url).toBe('/v1/messages');

    // An explicit setting still wins over the environment
    await createProvider('openai', { apiKey: 'k', baseUrl: `${server.url}/custom` }).complete({ model: '', messages: user('hi') });
    expect(server.requests[2].url).toBe('/custom/chat/completions');

    // OLLAMA_HOST may leave out the scheme, as Ollama itself allows
    process.env.OLLAMA_HOST = server.url.replace('http://', '');
    await createProvider('ollama').complete({ model: '', messages: user('hi') });
    expect(server.requests[3].url).toBe('/api/chat');
  });

  it('builds every catalog entry', () => {
    for (const [id, entry] of Object.entries(PROVIDER_CATALOG)) {
      expect(() => createProviderFromConfig({ ...entry, id, apiKey: 'k' }), id).not.toThrow();
    }
  });
});
