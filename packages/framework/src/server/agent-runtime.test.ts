import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineAgent } from '../define-agent.js';
import {
  AgentBudgets,
  AgentRunError,
  BudgetExceededError,
  MiddlewareRejection,
  createConfiguredProviders,
  middlewareFor,
  requestMetadata,
  resolveAgentModel,
  runWithMiddleware,
  toJsonSchema,
} from './agent-runtime.js';
import type { MiddlewareContext, MiddlewareDefinition } from '../types/middleware.js';
import type { DiscoveredMiddleware } from './middleware-pipeline.js';

const ctx = (): MiddlewareContext => ({ agentName: 'a', input: 'hi', threadId: 't', metadata: {} });
const discovered = (...defs: MiddlewareDefinition[]): DiscoveredMiddleware[] =>
  defs.map(definition => ({ name: definition.name, filePath: `${definition.name}.js`, definition }));

describe('runWithMiddleware', () => {
  it('runs before, both, and after middleware around the agent in order', async () => {
    const order: string[] = [];
    const middleware: MiddlewareDefinition[] = [
      { name: 'auth', stage: 'before', handler: async (_c, next) => { order.push('auth'); await next(); } },
      { name: 'log', stage: 'after', handler: async (c) => { order.push(`log:${c.response?.content}`); } },
      { name: 'timing', stage: 'both', handler: async (_c, next) => { order.push('timing:start'); await next(); order.push('timing:end'); } },
    ];
    const c = ctx();
    await runWithMiddleware(middleware, c, async (input) => { order.push(`agent:${input}`); return 'reply'; });
    expect(order).toEqual(['auth', 'timing:start', 'agent:hi', 'timing:end', 'log:reply']);
    expect(c.response?.content).toBe('reply');
  });

  it('rejects when before-middleware throws or skips next(), and the agent never runs', async () => {
    const agent = vi.fn(async () => 'reply');
    const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 });
    await expect(runWithMiddleware([{ name: 'auth', stage: 'before', handler: async () => { throw unauthorized; } }], ctx(), agent))
      .rejects.toMatchObject({ name: 'MiddlewareRejection', status: 401, message: 'Unauthorized' });
    await expect(runWithMiddleware([{ name: 'gate', stage: 'before', handler: async () => {} }], ctx(), agent))
      .rejects.toBeInstanceOf(MiddlewareRejection);
    await expect(runWithMiddleware([{ name: 'plain', handler: async () => { throw new Error('no'); } }], ctx(), agent))
      .rejects.toMatchObject({ status: 403 });
    expect(agent).not.toHaveBeenCalled();
  });

  it('lets middleware rewrite the input and the response', async () => {
    const c = ctx();
    await runWithMiddleware([
      { name: 'trim', stage: 'before', handler: async (x, next) => { x.input = x.input.toUpperCase(); await next(); } },
      { name: 'format', stage: 'after', handler: async (x) => { x.response!.content += '!'; } },
    ], c, async (input) => input);
    expect(c.response?.content).toBe('HI!');
  });

  it('wraps agent failures so they are not mistaken for rejections', async () => {
    await expect(runWithMiddleware([], ctx(), async () => { throw new Error('model down'); }))
      .rejects.toBeInstanceOf(AgentRunError);
  });

  it('logs after-middleware errors instead of failing the request', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = ctx();
    await runWithMiddleware([{ name: 'broken', stage: 'after', handler: async () => { throw new Error('x'); } }], c, async () => 'ok');
    expect(c.response?.content).toBe('ok');
    spy.mockRestore();
  });
});

describe('middlewareFor', () => {
  const all = discovered(
    { name: 'auth', handler: async (_c, n) => n() },
    { name: 'log', handler: async (_c, n) => n() },
  );

  it('applies every middleware unless the agent lists some', () => {
    expect(middlewareFor({ name: 'x', instructions: '' }, all).map(m => m.name)).toEqual(['auth', 'log']);
    expect(middlewareFor({ name: 'x', instructions: '', middleware: ['log'] }, all).map(m => m.name)).toEqual(['log']);
    expect(middlewareFor({ name: 'x', instructions: '', middleware: [] }, all)).toEqual([]);
  });
});

describe('requestMetadata', () => {
  it('exposes the bearer token, client IP, and request context', () => {
    const meta = requestMetadata({ authorization: 'Bearer key-1' }, '10.0.0.1', { plan: 'pro' });
    expect(meta).toMatchObject({ authorization: 'key-1', clientIp: '10.0.0.1', plan: 'pro' });
  });
});

describe('toJsonSchema', () => {
  it('converts framework parameter maps and keeps JSON Schema as is', () => {
    expect(toJsonSchema({ path: { type: 'string', description: 'File', required: true } })).toEqual({
      type: 'object',
      properties: { path: { type: 'string', description: 'File' } },
      required: ['path'],
    });
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    expect(toJsonSchema(schema)).toBe(schema);
  });
});

describe('model selection', () => {
  const config = {
    name: 'app',
    model: { provider: 'google', model: 'gemini-flash-latest' },
    models: { fast: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434' } },
  };

  it('resolves named models, plain model IDs, and the google alias', () => {
    expect(resolveAgentModel(config, 'fast')).toEqual({ provider: 'ollama', model: 'llama3.2' });
    expect(resolveAgentModel(config, 'gemini-pro-latest')).toEqual({ provider: 'gemini', model: 'gemini-pro-latest' });
    expect(resolveAgentModel(config, undefined)).toBeUndefined();
  });

  it('creates providers for local servers and custom endpoints only', () => {
    const providers = createConfiguredProviders({
      ...config,
      models: {
        ...config.models,
        proxy: { provider: 'my-proxy', model: 'm', baseUrl: 'http://127.0.0.1:9000/v1' },
      },
    });
    expect(providers.map(p => p.id).sort()).toEqual(['my-proxy', 'ollama']);
  });
});

describe('AgentBudgets', () => {
  it('limits requests per minute and monthly tokens', () => {
    const budgets = new AgentBudgets(new Map([
      ['a', { maxRequestsPerMinute: 2 }],
      ['b', { maxTokens: 100 }],
    ]));
    budgets.begin('a');
    budgets.begin('a');
    expect(() => budgets.begin('a')).toThrow(BudgetExceededError);

    budgets.begin('b');
    budgets.record('b', { totalTokens: 100 });
    expect(() => budgets.begin('b')).toThrow(/monthly token budget/);

    // Agents without a budget are never limited
    for (let i = 0; i < 5; i++) budgets.begin('c');
  });
});

describe('AgentBudgets persistence', () => {
  it('keeps monthly usage across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kernova-budgets-'));
    try {
      const file = join(dir, 'agent-budgets.json');
      const limits = new Map([['writer', { maxTokens: 100 }]]);

      const first = new AgentBudgets(limits, file);
      first.record('writer', { totalTokens: 100 });
      first.flush();

      const afterRestart = new AgentBudgets(limits, file);
      expect(() => afterRestart.begin('writer')).toThrow(/monthly token budget/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('defineAgent', () => {
  it('leaves middleware, temperature, and maxTokens unset unless given', () => {
    const agent = defineAgent({ name: 'a', instructions: 'x', reflection: { enabled: true } });
    expect(agent.middleware).toBeUndefined();   // undefined = every middleware runs
    expect(agent.temperature).toBeUndefined();  // the provider's default applies
    expect(agent.maxTokens).toBeUndefined();
    expect(agent.reflection).toEqual({ enabled: true });
  });
});
