/**
 * Kernel behaviour regression tests: what actually reaches the model, how owners,
 * limits, budgets and tool policies apply, and that the kernel cleans up after itself.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompletionRequest, CompletionResponse, ToolCall } from '@kernova/types';
import { KernovaKernel, type KernelConfig } from '../kernel.js';
import { defineAgent, type AgentSpec } from '../define-agent.js';
import { DaemonRunner } from '../daemon/index.js';
import type { ModelProvider } from '../models/provider.js';

/** Provider that records requests; `reply` decides each response. */
function recordingProvider(
  reply: (req: CompletionRequest, call: number) => Partial<CompletionResponse> = () => ({ content: 'ok' }),
) {
  const calls: CompletionRequest[] = [];
  const provider: ModelProvider & { calls: CompletionRequest[] } = {
    calls,
    id: 'rec',
    name: 'Recorder',
    defaultModel: 'rec-1',
    isAvailable: () => true,
    async complete(req) {
      calls.push(req);
      return {
        content: '',
        model: req.model,
        provider: 'rec',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        metadata: { latencyMs: 1, finishReason: 'stop' },
        ...reply(req, calls.length),
      };
    },
  };
  return provider;
}

const kernels: KernovaKernel[] = [];
afterEach(async () => {
  while (kernels.length) await kernels.pop()!.stop();
});

async function startKernel(provider: ModelProvider, config: Partial<KernelConfig> = {}, agent: Partial<AgentSpec> = {}) {
  const kernel = new KernovaKernel({ environment: 'development', ephemeral: true, providers: [provider], ...config });
  kernels.push(kernel);
  await kernel.start();
  const defined = defineAgent({
    name: 'helper',
    description: 'general helper',
    capabilities: [{ id: 'query', name: 'query', description: 'answers', confidence: 0.9 }],
    tools: [],
    instructions: 'You are helpful.',
    ...agent,
  });
  kernel.agentRegistry.register(defined.definition, defined.executor);
  return kernel;
}

const sentText = (req: CompletionRequest) => JSON.stringify(req.messages);

describe('model calls', () => {
  it('uses the first provider and its own default model, with one call per question', async () => {
    const provider = recordingProvider(() => ({ content: 'Paris.' }));
    const kernel = await startKernel(provider);

    const intent = await kernel.submit({ goal: 'Capital of France?' });

    expect(intent.result?.summary).toBe('Paris.');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].model).toBe('rec-1');
  });

  it('offers only the safe built-in tools by default', async () => {
    const provider = recordingProvider();
    const kernel = await startKernel(provider);
    await kernel.submit({ goal: 'hi' });

    const offered = (provider.calls[0].tools ?? []).map((t) => t.name).join(' ');
    for (const unsafe of ['shell-exec', 'code-eval', 'file-read', 'file-write', 'database-query']) {
      expect(offered).not.toContain(unsafe);
    }
    expect(offered).toContain('date-time');
  });

  it('runs reflection only when enabled, globally or for the agent', async () => {
    const grade = (req: CompletionRequest) =>
      JSON.stringify(req.messages).includes('overallScore') ? { content: '{"overallScore":0.9}' } : { content: 'answer' };

    const global = recordingProvider(grade);
    await (await startKernel(global, { reflection: { enabled: true } })).submit({ goal: 'q' });
    expect(global.calls).toHaveLength(2);

    const perAgent = recordingProvider(grade);
    await (await startKernel(perAgent, {}, { reflection: { enabled: true } })).submit({ goal: 'q' });
    expect(perAgent.calls).toHaveLength(2);
  });

  it("uses an agent's own provider, model, temperature and maxTokens", async () => {
    const fallback = recordingProvider();
    const other = { ...recordingProvider(), id: 'other' };
    const kernel = await startKernel(fallback, { providers: [fallback, other] }, {
      model: { provider: 'other', model: 'other-large' },
      temperature: 0.2,
      maxTokens: 77,
    });

    await kernel.submit({ goal: 'q' });

    expect(fallback.calls).toHaveLength(0);
    expect(other.calls[0]).toMatchObject({ provider: 'other', model: 'other-large', temperature: 0.2, maxTokens: 77 });
  });

  it('prefers providers passed in over auto-detected ones with the same ID', async () => {
    const previous = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'test-key';
    try {
      const custom = { ...recordingProvider(), id: 'groq' };
      const kernel = await startKernel(custom);
      await kernel.submit({ goal: 'q' });
      expect(custom.calls).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = previous;
    }
  });

  it('counts a call toward every measureUsage() scope it runs in', async () => {
    const kernel = await startKernel(recordingProvider());
    let inner = 0;
    const outer = await kernel.models.measureUsage(async () => {
      inner = (await kernel.models.measureUsage(() => kernel.models.complete({ model: '', messages: [] }))).usage.totalTokens;
    });
    expect(inner).toBe(15);
    expect(outer.usage.totalTokens).toBe(15);
  });
});

describe('context', () => {
  it('puts retrieved documents in the prompt', async () => {
    const provider = recordingProvider();
    const kernel = await startKernel(provider);
    await kernel.rag.ingest('The office wifi password is ZEBRA-4471.', 'handbook.md');

    await kernel.submit({ goal: 'What is the office wifi password?' });

    expect(sentText(provider.calls[0])).toContain('ZEBRA-4471');
  });

  it('remembers earlier turns within a thread, and only within that thread', async () => {
    const provider = recordingProvider(() => ({ content: 'Noted.' }));
    const kernel = await startKernel(provider);

    await kernel.submit({ goal: 'My favourite colour is teal.', metadata: { threadId: 'alice' } });
    await kernel.submit({ goal: 'What is my favourite colour?', metadata: { threadId: 'alice' } });
    await kernel.submit({ goal: 'What is my favourite colour?', metadata: { threadId: 'bob' } });
    await kernel.submit({ goal: 'What is my favourite colour?' });

    expect(sentText(provider.calls[1])).toContain('teal');
    expect(sentText(provider.calls[2])).not.toContain('teal');
    expect(sentText(provider.calls[3])).not.toContain('teal');
  });

  it('leaves history to the app with threadHistory: false', async () => {
    const provider = recordingProvider(() => ({ content: 'Noted.' }));
    const kernel = await startKernel(provider, { threadHistory: false });

    await kernel.submit({ goal: 'My favourite colour is teal.', metadata: { threadId: 'alice' } });
    await kernel.submit({ goal: 'What is my favourite colour?', metadata: { threadId: 'alice' } });

    expect(sentText(provider.calls[1])).not.toContain('teal');
    expect(kernel.conversation.getThreadContext('alice').messages).toHaveLength(0);
  });
});

describe('configuration', () => {
  it('passes identity settings through', async () => {
    const kernel = await startKernel(recordingProvider(), { identity: { sessionTtlSeconds: 60 } });
    const user = kernel.identity.registerIdentity({ type: 'user', name: 'Ada' });
    const session = kernel.identity.createSession({ identityId: user.id, permissions: [] });
    expect(Date.parse(session.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('accepts a single event pattern in subscribe()', async () => {
    const kernel = await startKernel(recordingProvider());
    const seen: string[] = [];
    kernel.events.subscribe('intent.completed', (event) => { seen.push(event.eventType); });
    await kernel.submit({ goal: 'q' });
    await vi.waitFor(() => expect(seen).toContain('intent.completed'));
  });

  it('exports the documented channel adapters and autonomy modules', async () => {
    const core = await import('../index.js');
    for (const name of [
      'SlackAdapter', 'DiscordAdapter', 'TelegramAdapter', 'WhatsAppAdapter', 'EmailAdapter', 'TeamsAdapter',
      'SmsAdapter', 'SignalAdapter', 'MatrixAdapter', 'IrcAdapter', 'VoiceAdapter', 'PushAdapter', 'RssAdapter',
      'ConnectorRegistry', 'Scheduler', 'BackgroundLoopModule', 'ApprovalManager', 'DurableExecutor', 'CheckpointStore',
    ]) {
      expect(typeof (core as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

describe('owners, limits and budgets', () => {
  it('accepts owners that are not registered identities', async () => {
    const kernel = await startKernel(recordingProvider());
    const intent = await kernel.submit({ goal: 'hi', owner: 'user-123' });
    expect(intent.intentStatus).toBe('completed');
  });

  it('still enforces permissions for registered identities', async () => {
    const kernel = await startKernel(recordingProvider());
    const identity = kernel.identity.registerIdentity({ type: 'user', name: 'Restricted', roles: ['viewer'] });
    kernel.identity.permissions.removeRole(identity.id, 'developer');
    await expect(kernel.submit({ goal: 'hi', owner: identity.id })).rejects.toThrow(/Permission denied/);
  });

  it('does not rate-limit the kernel itself, but does limit named owners', async () => {
    const kernel = await startKernel(recordingProvider(), { rateLimits: { defaultMaxRequests: 3 } });

    for (let i = 0; i < 10; i++) await kernel.submit({ goal: `q${i}` });

    for (let i = 0; i < 3; i++) await kernel.submit({ goal: `q${i}`, owner: 'user-1' });
    await expect(kernel.submit({ goal: 'one more', owner: 'user-1' })).rejects.toThrow(/Rate limit/);
  });

  it('charges each owner only for its own tokens when intents run concurrently', async () => {
    const provider = recordingProvider((req) => {
      const big = sentText(req).includes('big');
      return { usage: { promptTokens: big ? 900 : 10, completionTokens: 0, totalTokens: big ? 900 : 10 }, content: 'ok' };
    });
    const slow: ModelProvider = {
      ...provider,
      async complete(req) {
        await new Promise((r) => setTimeout(r, sentText(req).includes('big') ? 30 : 5));
        return provider.complete(req);
      },
    };
    const kernel = await startKernel(slow);

    await Promise.all([
      kernel.submit({ goal: 'small question', owner: 'alice' }),
      kernel.submit({ goal: 'big question', owner: 'bob' }),
    ]);

    expect(kernel.budget.getUsage('alice').totalTokens).toBe(10);
    expect(kernel.budget.getUsage('bob').totalTokens).toBe(900);
  });
});

describe('tool policy', () => {
  const offeredTo = async (config: Partial<KernelConfig>, agent: Partial<AgentSpec> = {}) => {
    const provider = recordingProvider();
    const kernel = await startKernel(provider, config, agent);
    await kernel.submit({ goal: 'hi' });
    return (provider.calls[0].tools ?? []).map((t) => t.name);
  };

  it('applies the kernel-wide policy by short tool name', async () => {
    const offered = await offeredTo({ toolPolicy: { deny: ['math-eval'] } });
    expect(offered.some((n) => n.endsWith('math-eval'))).toBe(false);
    expect(offered.some((n) => n.endsWith('date-time'))).toBe(true);
  });

  it('applies an agent policy on top', async () => {
    const offered = await offeredTo({}, { toolPolicy: { allow: ['date-time'] } });
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatch(/date-time$/);
  });

  it('refuses to run a tool the model was not offered', async () => {
    const executed = vi.fn(async () => 'ran');
    const provider = recordingProvider((_req, call) =>
      call === 1
        ? { toolCalls: [{ id: 't1', name: 'sdk-tool_secret_secret', arguments: {} } satisfies ToolCall] }
        : { content: 'done' });
    const kernel = await startKernel(provider, { toolPolicy: { deny: ['secret'] } });
    await kernel.plugins.register({
      id: 'sdk-tool:secret', name: 'secret', version: '1.0.0', type: 'tool',
      tools: [{ id: 'secret', name: 'secret', description: 'secret', parameters: { type: 'object', properties: {} }, execute: executed }],
    });

    await kernel.submit({ goal: 'use the secret tool' });

    expect(executed).not.toHaveBeenCalled();
    expect(sentText(provider.calls[1])).toContain('is not available');
  });
});

describe('agent model settings', () => {
  it("sends an agent's reasoning, response format, and caching, and gives providerData back during tool use", async () => {
    const providerData = { rec: { thinking: [{ type: 'thinking', signature: 'sig' }] } };
    const provider = recordingProvider((req, call) => {
      if (call > 1) return { content: '{"time":"now"}' };
      const tool = req.tools!.find((t) => t.name.endsWith('date-time'))!;
      return { toolCalls: [{ id: 't1', name: tool.name, arguments: {} }], providerData };
    });
    const schema = { type: 'object', properties: { time: { type: 'string' } } };
    const kernel = await startKernel(provider, {}, {
      reasoning: { effort: 'high' },
      responseFormat: { type: 'json_schema', schema },
      promptCache: true,
    });

    await kernel.submit({ goal: 'What time is it?' });

    expect(provider.calls).toHaveLength(2);
    for (const call of provider.calls) {
      expect(call.reasoning).toEqual({ effort: 'high' });
      expect(call.responseFormat).toEqual({ type: 'json_schema', schema });
      expect(call.cache).toBe(true);
    }
    const assistant = provider.calls[1].messages.find((m) => m.role === 'assistant' && m.toolCalls?.length);
    expect(assistant?.providerData).toEqual(providerData);
  });
});

describe('MCP tools', () => {
  it('registers a connected server\'s tools for agents and removes them on disconnect', async () => {
    const provider = recordingProvider();
    const kernel = await startKernel(provider);
    vi.spyOn(kernel.mcp, 'getServer').mockReturnValue({ id: 'srv', name: 'GitHub', toolPrefix: 'github_', enabled: true, transport: { type: 'stdio', command: 'x' } } as never);
    vi.spyOn(kernel.mcp, 'getServerTools').mockReturnValue([{ name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' }, serverId: 'srv' }]);
    const callTool = vi.spyOn(kernel.mcp, 'callTool').mockResolvedValue({ content: [{ type: 'text', text: 'issue #1' }] });

    const publish = (eventType: string) => kernel.events.publish({
      id: `evt_${eventType}`, eventType, category: 'system', severity: 'info', timestamp: new Date().toISOString(),
      subjectId: 'srv', subjectType: 'mcp', actorId: 'mcp-bridge', correlationId: 'srv', data: {},
      metadata: { schemaVersion: '1.0.0', source: 'test', environment: 'test' },
    });

    publish('mcp.connected');
    await vi.waitFor(() => expect(kernel.plugins.listTools().some((t) => t.id.endsWith('github_create_issue'))).toBe(true));

    const toolId = kernel.plugins.listTools().find((t) => t.id.endsWith('github_create_issue'))!.id;
    await expect(kernel.plugins.executeTool(toolId, { title: 'Bug' })).resolves.toBe('issue #1');
    expect(callTool).toHaveBeenCalledWith('srv', 'create_issue', { title: 'Bug' });

    publish('mcp.disconnected');
    await vi.waitFor(() => expect(kernel.plugins.listTools().some((t) => t.id.endsWith('github_create_issue'))).toBe(false));
  });
});

describe('lifecycle', () => {
  it('stop() lets active intents finish and refuses new ones', async () => {
    const provider = recordingProvider(() => ({ content: 'finished' }));
    const slow: ModelProvider = {
      ...provider,
      async complete(req) {
        await new Promise((r) => setTimeout(r, 200));
        return provider.complete(req);
      },
    };
    const kernel = await startKernel(slow);
    kernels.pop(); // stopped by this test

    const inFlight = kernel.submit({ goal: 'slow question' });
    await new Promise((r) => setTimeout(r, 20));
    const stopping = kernel.stop();
    await expect(kernel.submit({ goal: 'too late' })).rejects.toThrow(/stopping/);
    await stopping;

    expect((await inFlight).result?.summary).toBe('finished');
  });

  it('releases its database files on stop()', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kernova-lifecycle-'));
    const kernel = new KernovaKernel({ environment: 'development', dataDir, providers: [recordingProvider()] });
    await kernel.start();
    await kernel.submit({ goal: 'hi' });
    await kernel.stop();

    // Fails with EBUSY/EPERM on Windows if any SQLite handle is still open
    expect(() => rmSync(dataDir, { recursive: true })).not.toThrow();
  });

  it('DaemonRunner starts the kernel and serves the gateway on its port', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const kernel = new KernovaKernel({
      environment: 'development', ephemeral: true, providers: [recordingProvider()],
      gateway: { auth: { tokens: ['daemon-token'] } },
    });
    const daemon = new DaemonRunner(kernel, { port });
    const running = daemon.start();

    await vi.waitFor(() => expect(kernel.getStatus().running).toBe(true));
    await vi.waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: 'Bearer daemon-token' } });
      expect(res.status).toBe(200);
    });

    await daemon.stop();
    await running;
    expect(kernel.getStatus().running).toBe(false);
  });

  it("DaemonRunner stops the kernel again if the gateway can't start", async () => {
    delete process.env.KERNOVA_API_KEY;
    const kernel = new KernovaKernel({ environment: 'development', ephemeral: true, providers: [recordingProvider()] });
    await expect(new DaemonRunner(kernel, { port: 20000 + Math.floor(Math.random() * 20000) }).start())
      .rejects.toThrow(/no authentication configured/);
    expect(kernel.getStatus().running).toBe(false);
  });
});

describe('gateway', () => {
  const port = () => 20000 + Math.floor(Math.random() * 20000);

  it('refuses to start without authentication', async () => {
    const kernel = await startKernel(recordingProvider());
    delete process.env.KERNOVA_API_KEY;
    await expect(kernel.gateway.start({ port: port() })).rejects.toThrow(/no authentication configured/);
  });

  it('requires the bearer token and binds to localhost', async () => {
    const p = port();
    const kernel = await startKernel(recordingProvider(), { gateway: { port: p, auth: { tokens: ['secret-token'] } } });
    await kernel.gateway.start();

    const health = (headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${p}/health`, { headers });
    expect((await health()).status).toBe(401);
    expect((await health({ Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await health({ Authorization: 'Bearer secret-token' })).status).toBe(200);
  });

  it('in anonymous mode, refuses browser requests from origins CORS does not allow', async () => {
    const p = port();
    const kernel = await startKernel(recordingProvider(), {
      gateway: { port: p, auth: { allowAnonymous: true }, cors: ['http://localhost:4200'] },
    });
    await kernel.gateway.start();

    const fromOrigin = (origin?: string) => fetch(`http://127.0.0.1:${p}/health`, { headers: origin ? { Origin: origin } : {} });
    expect((await fromOrigin()).status).toBe(200);
    expect((await fromOrigin('http://localhost:4200')).status).toBe(200);
    expect((await fromOrigin('https://evil.example')).status).toBe(403);
  });

  it('accepts signed webhooks without a token, verifying the raw body', async () => {
    const p = port();
    const kernel = await startKernel(recordingProvider(), { gateway: { port: p, auth: { tokens: ['t'] } } });
    kernel.webhooks.register({
      path: '/hooks/github', method: 'POST', secret: 'hook-secret',
      transform: { signatureHeader: 'x-hub-signature-256' },
      target: { type: 'event', eventType: 'github.push' }, enabled: true,
    });
    await kernel.gateway.start();

    // Formatting a JSON parser would not reproduce, so a re-serialized body would not match
    const raw = '{ "ref":  "main" }';
    const signature = `sha256=${createHmac('sha256', 'hook-secret').update(raw).digest('hex')}`;
    const send = (sig: string) => fetch(`http://127.0.0.1:${p}/hooks/github`, {
      method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    });

    expect((await send(signature)).status).toBe(200);
    expect((await send('sha256=' + '0'.repeat(64))).status).toBe(400);
  });
});
