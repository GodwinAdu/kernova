/**
 * End-to-end tests for the framework server, against a stand-in for Ollama that records
 * every model request.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from './create-server.js';

interface ChatRequest {
  model: string;
  stream?: boolean;
  messages: Array<{ role: string; content: string }>;
}

function startFakeOllama(): Promise<{ server: Server; url: string; requests: ChatRequest[] }> {
  const requests: ChatRequest[] = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/api/chat') {
        requests.push(body);
        // Call the test tool when it's offered and hasn't been called yet in this conversation
        const whoami = (body.tools ?? []).find((t: any) => String(t.function?.name).includes('whoami'));
        if (whoami && !body.messages.some((m: any) => m.role === 'tool')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: { role: 'assistant', content: '', tool_calls: [{ function: { name: whoami.function.name, arguments: {} } }] },
            done: true, prompt_eval_count: 10, eval_count: 5,
          }));
          return;
        }
        const content = `reply from ${body.model}`;
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          res.write(`${JSON.stringify({ message: { role: 'assistant', content }, done: false })}\n`);
          res.end(`${JSON.stringify({ done: true, prompt_eval_count: 10, eval_count: 5 })}\n`);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: { role: 'assistant', content }, done: true, prompt_eval_count: 10, eval_count: 5 }));
        }
      } else if (req.url === '/api/embed') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests });
  }));
}

async function freePort(): Promise<number> {
  const probe = createHttpServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

function writeProject(root: string, ollamaUrl: string): void {
  const file = (path: string, content: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  file('package.json', JSON.stringify({ type: 'module' }));
  file('kernova.config.js', `export default ${JSON.stringify({
    name: 'test-app',
    model: { provider: 'ollama', model: 'default-model', baseUrl: ollamaUrl },
    models: { fast: { provider: 'ollama', model: 'fast-model' } },
    memory: { autoRecall: false },
    gateway: { openaiCompat: true },
  })};`);
  file('agents/assistant.agent.js', `export default {
    name: 'Assistant',
    instructions: 'You are the test assistant.',
    model: 'fast',
    skills: ['coding'],
    middleware: ['auth'],
    budget: { maxRequestsPerMinute: 3 },
  };`);
  file('agents/open.agent.js', `export default { name: 'Open', instructions: 'You are open.', middleware: [] };`);
  file('middleware/auth.js', `export default {
    name: 'auth',
    stage: 'before',
    handler: async (ctx, next) => {
      if (ctx.metadata.authorization !== 'secret') throw Object.assign(new Error('Unauthorized'), { status: 401 });
      await next();
    },
  };`);
  file('skills/coding/index.js', `export default { name: 'coding', description: 'Coding', instructions: 'SKILL: always write tests.' };`);
  // A tool that records the context it was called in, an agent that uses it, and triggers
  file('tools/whoami.js', `export default {
    name: 'whoami',
    description: 'Report who is asking',
    parameters: {},
    execute: async (params, ctx) => {
      globalThis.__toolCalls.push({ threadId: ctx.threadId, user: ctx.user, trigger: ctx.trigger, autonomous: ctx.autonomous, agent: ctx.agent });
      return 'recorded';
    },
  };`);
  file('agents/tooly.agent.js', `export default { name: 'Tooly', instructions: 'Use whoami.', tools: ['whoami'], middleware: [] };`);
  file('agents/triggers/ping.js', `export default {
    name: 'ping', event: 'test.ping', agent: 'tooly', goal: 'Ping goal', cooldown: 1,
    when: () => globalThis.__allowPing === true,
  };`);
  file('agents/triggers/off.js', `export default { name: 'off', event: 'test.ping', agent: 'tooly', goal: 'Off goal', enabled: false };`);
}

type ToolCallRecord = { threadId?: string; user?: { id: string }; trigger?: string; autonomous?: boolean; agent?: string };
const toolCalls = (): ToolCallRecord[] => (globalThis as any).__toolCalls;

describe('framework server', () => {
  let root: string;
  let ollama: Awaited<ReturnType<typeof startFakeOllama>>;
  let app: Awaited<ReturnType<typeof createServer>>;
  let base: string;

  const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = (request: ChatRequest) => request.messages.map(m => m.content).join('\n');

  beforeAll(async () => {
    (globalThis as any).__toolCalls = [];
    (globalThis as any).__allowPing = false;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    root = mkdtempSync(join(tmpdir(), 'kernova-fw-'));
    ollama = await startFakeOllama();
    writeProject(root, ollama.url);
    const port = await freePort();
    app = await createServer({ projectRoot: root, port, host: '127.0.0.1' });
    if (!app.server.listening) await once(app.server, 'listening');
    base = `http://127.0.0.1:${port}`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await new Promise(resolve => ollama.server.close(resolve));
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('runs middleware before the agent and answers its rejection', async () => {
    const res = await post('/agents/assistant', { input: 'hello' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(ollama.requests).toHaveLength(0);
  });

  it("uses the agent's named model and adds its skill instructions", async () => {
    const res = await post('/agents/assistant', { input: 'first question', threadId: 'th1' }, { Authorization: 'Bearer secret' });
    expect(res.status).toBe(200);
    expect((await res.json()).content).toBe('reply from fast-model');

    const request = ollama.requests.at(-1)!;
    expect(request.model).toBe('fast-model');
    expect(text(request)).toContain('You are the test assistant.');
    expect(text(request)).toContain('SKILL: always write tests.');
  });

  it('sends each earlier turn of a thread to the model once', async () => {
    const res = await post('/agents/assistant', { input: 'second question', threadId: 'th1' }, { Authorization: 'Bearer secret' });
    expect(res.status).toBe(200);
    const sent = text(ollama.requests.at(-1)!);
    expect(sent.split('first question').length - 1).toBe(1);
  });

  it("enforces the agent's requests-per-minute budget (rejected requests don't count)", async () => {
    const auth = { Authorization: 'Bearer secret' };
    expect((await post('/agents/assistant', { input: 'third' }, auth)).status).toBe(200);
    const limited = await post('/agents/assistant', { input: 'fourth' }, auth);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('answers OpenAI-style chat completions, routing `model` to an agent', async () => {
    const res = await post('/v1/chat/completions', {
      model: 'open',
      messages: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
        { role: 'user', content: 'latest question' },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message).toEqual({ role: 'assistant', content: 'reply from default-model' });
    expect(body.usage.total_tokens).toBe(15);

    const sent = text(ollama.requests.at(-1)!);
    expect(sent).toContain('latest question');
    expect(sent).toContain('User: earlier question');
  });

  it('streams with the project default model when the agent has none', async () => {
    const res = await post('/agents/open/stream', { input: 'stream please' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('reply from default-model');
    expect(ollama.requests.at(-1)).toMatchObject({ model: 'default-model', stream: true });
  });

  it('tells tools which thread, user, and agent a request is for', async () => {
    const before = toolCalls().length;
    const res = await post('/agents/tooly', { input: 'who is asking?', threadId: 'thread-42', user: { id: 'user-7' } });
    expect(res.status).toBe(200);
    expect(toolCalls().slice(before)).toEqual([
      { threadId: 'thread-42', user: { id: 'user-7' }, trigger: undefined, autonomous: false, agent: 'tooly' },
    ]);
  });

  it("marks trigger runs as autonomous, honours a trigger's when(), and skips disabled triggers", async () => {
    const ping = () => app.kernel.events.publish({
      id: `evt_${Date.now()}`, eventType: 'test.ping', category: 'system', severity: 'info', timestamp: new Date().toISOString(),
      subjectId: 'test', subjectType: 'test', actorId: 'test', correlationId: 'test', data: {},
      metadata: { schemaVersion: '1.0.0', source: 'test', environment: 'test' },
    } as any);

    const before = toolCalls().length;
    ping();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(toolCalls().length).toBe(before); // when() said no

    (globalThis as any).__allowPing = true;
    ping();
    await vi.waitFor(() => expect(toolCalls().length).toBeGreaterThan(before), { timeout: 10_000 });
    const runs = toolCalls().slice(before);
    expect(runs[0]).toEqual({ threadId: 'trigger_ping', user: undefined, trigger: 'ping', autonomous: true, agent: 'tooly' });
    expect(runs.some(r => r.trigger === 'off')).toBe(false);
  });

});
