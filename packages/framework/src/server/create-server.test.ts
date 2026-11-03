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
}

describe('framework server', () => {
  let root: string;
  let ollama: Awaited<ReturnType<typeof startFakeOllama>>;
  let app: Awaited<ReturnType<typeof createServer>>;
  let base: string;

  const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = (request: ChatRequest) => request.messages.map(m => m.content).join('\n');

  beforeAll(async () => {
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
});
