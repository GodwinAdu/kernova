/**
 * kernova doctor: the checks it runs against each provider, and which providers it picks.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { CompletionRequest, CompletionResponse, StreamChunk } from '@kernova/types';
import type { ModelProvider } from '@kernova/core';
import { checkProvider, findProviders, optionValues } from '../commands/doctor.js';

function fakeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'fake',
    name: 'Fake AI',
    defaultModel: 'fake-1',
    isAvailable: () => true,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      return {
        content: 'OK',
        model: request.model,
        provider: 'fake',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        toolCalls: request.tools ? [{ id: 't1', name: 'get_time', arguments: {} }] : undefined,
        metadata: { latencyMs: 1, finishReason: request.tools ? 'tool_call' : 'stop' },
      };
    },
    async *stream(): AsyncGenerator<StreamChunk> {
      yield { content: '1 2 3', done: false };
      yield { content: '', done: true };
    },
    embed: async () => [0.1, 0.2],
    ...overrides,
  };
}

describe('checkProvider', () => {
  it('passes a provider whose chat, tools, streaming, and embeddings work', async () => {
    const result = await checkProvider(fakeProvider());
    expect(result).toMatchObject({
      provider: 'Fake AI', id: 'fake', model: 'fake-1',
      chat: 'pass', toolCalling: 'pass', streaming: 'pass', embeddings: 'pass', notes: [],
    });
  });

  it('stops after a failed chat, and says why', async () => {
    const result = await checkProvider(fakeProvider({
      complete: async () => { throw new Error('Anthropic API error (401): invalid x-api-key'); },
    }));
    expect(result).toMatchObject({
      chat: 'fail', toolCalling: 'skip', streaming: 'skip', embeddings: 'skip',
      error: 'Anthropic API error (401): invalid x-api-key',
    });
  });

  it('fails tool calling when the model answers without the tool, and skips embeddings it lacks', async () => {
    const provider = fakeProvider({ embed: async () => { throw new Error('Groq does not support embeddings.'); } });
    const complete = provider.complete.bind(provider);
    provider.complete = async (request) => ({ ...(await complete(request)), toolCalls: undefined });

    const result = await checkProvider(provider);
    expect(result.toolCalling).toBe('fail');
    expect(result.notes).toContain('tools: the model answered without calling the tool');
    expect(result.embeddings).toBe('skip');
  });

  it('reports failing streams and providers that hang', async () => {
    const result = await checkProvider(fakeProvider({
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<StreamChunk> { throw new Error('connection reset'); },
      embed: () => new Promise<number[]>(() => {}),
    }), 50);
    expect(result.streaming).toBe('fail');
    expect(result.notes).toContain('stream: connection reset');
    expect(result.embeddings).toBe('fail');
    expect(result.notes).toContain('embed: Timed out after 0.05s');
  });
});

describe('findProviders', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it('checks only the providers asked for, and explains the ones that are not set up', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { providers, notes } = await findProviders(['anthropic', 'no-such-provider']);
    expect(providers).toEqual([]);
    expect(notes[0]).toBe("Anthropic isn't set up: Anthropic provider not available. Set ANTHROPIC_API_KEY environment variable.");
    expect(notes[1]).toMatch(/Unknown provider: "no-such-provider"/);

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const found = await findProviders(['anthropic']);
    expect(found.providers.map(p => p.id)).toEqual(['anthropic']);
  });
});

describe('optionValues', () => {
  it('reads repeated, comma-separated, and = forms', () => {
    expect(optionValues(['--provider', 'bedrock', '--provider=vertex,azure', '-v'], '--provider')).toEqual(['bedrock', 'vertex', 'azure']);
    expect(optionValues(['--provider', '--verbose'], '--provider')).toEqual([]);
  });
});
