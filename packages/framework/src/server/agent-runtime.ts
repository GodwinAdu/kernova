/**
 * Agent runtime for the framework server: the pieces of an agent definition that apply
 * per request — middleware, skills, MCP servers, model selection, and budgets.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createProvider, resolveProviderAlias, type KernovaKernel, type ModelProvider } from '@kernova/core';
import type { KernovaFrameworkConfig } from '../types/config.js';
import type { AgentDefinition } from '../types/agent.js';
import type { MiddlewareContext, MiddlewareDefinition } from '../types/middleware.js';
import type { DiscoveredMiddleware } from './middleware-pipeline.js';
import type { MCPManager } from '../mcp/mcp-manager.js';
import { loadSkill } from '../skills/skill-loader.js';

// ─── Middleware ──────────────────────────────────────────────────────────────

/** A request stopped by middleware. `status` is the HTTP status to answer with. */
export class MiddlewareRejection extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MiddlewareRejection';
  }
}

/** The agent failed while running inside the middleware chain. */
export class AgentRunError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'AgentRunError';
  }
}

/**
 * The middleware that apply to an agent: all of them, or only the ones its
 * `middleware` list names (an empty list means none).
 */
export function middlewareFor(agent: AgentDefinition, all: DiscoveredMiddleware[]): MiddlewareDefinition[] {
  if (!agent.middleware) return all.map(m => m.definition);
  const byName = new Map(all.map(m => [m.definition.name, m.definition]));
  for (const name of agent.middleware) {
    if (!byName.has(name)) console.warn(`  ⚠ Agent "${agent.name}" lists unknown middleware "${name}"`);
  }
  return agent.middleware.flatMap(name => byName.get(name) ?? []);
}

/**
 * Run `runAgent` inside the middleware chain, Koa-style. `before` and `both` middleware
 * must call next() or the request is rejected; the agent runs inside the innermost next().
 * `after` middleware run once the agent has answered (ctx.response is set); their errors are logged.
 * A middleware error becomes a MiddlewareRejection (status: the error's `status`/`statusCode`, or 403).
 */
export async function runWithMiddleware(
  middleware: MiddlewareDefinition[],
  ctx: MiddlewareContext,
  runAgent: (input: string) => Promise<string>,
): Promise<void> {
  const dispatch = async (index: number): Promise<void> => {
    if (index === middleware.length) {
      let content: string;
      try {
        content = await runAgent(ctx.input);
      } catch (err) {
        throw new AgentRunError(err);
      }
      ctx.response = { content, metadata: ctx.response?.metadata };
      return;
    }

    const mw = middleware[index];
    if ((mw.stage ?? 'both') === 'after') {
      await dispatch(index + 1);
      try {
        await mw.handler(ctx, async () => {});
      } catch (err) {
        console.error(`  [middleware:${mw.name}] ${(err as Error).message}`);
      }
      return;
    }

    let called = false;
    try {
      await mw.handler(ctx, async () => {
        if (called) return;
        called = true;
        await dispatch(index + 1);
      });
    } catch (err) {
      if (err instanceof AgentRunError || err instanceof MiddlewareRejection) throw err;
      const e = err as Error & { status?: number; statusCode?: number };
      throw new MiddlewareRejection(e.message || `Rejected by middleware "${mw.name}"`, e.status ?? e.statusCode ?? 403);
    }
    if (!called) throw new MiddlewareRejection(`Request rejected by middleware "${mw.name}"`, 403);
  };

  await dispatch(0);
}

/** Request details middleware can read from ctx.metadata */
export function requestMetadata(
  headers: Record<string, string | string[] | undefined>,
  clientIp: string | undefined,
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const auth = typeof headers.authorization === 'string' ? headers.authorization : undefined;
  return {
    ...context,
    // The bearer token without the "Bearer " prefix (or the raw header for other schemes)
    authorization: auth?.startsWith('Bearer ') ? auth.slice(7) : auth,
    clientIp,
    headers,
  };
}

// ─── Skills ──────────────────────────────────────────────────────────────────

/** Knowledge files longer than this are cut off when added to the instructions */
const MAX_KNOWLEDGE_CHARS = 20_000;

export interface SkillTool {
  /** Tool ID registered with the kernel: "<skill>_<tool>" */
  id: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
}

export interface AgentSkills {
  /** Text to append to the agent's instructions (skill instructions and knowledge) */
  instructions: string;
  tools: SkillTool[];
  /** MCP servers the skills need */
  mcpServers: string[];
}

/**
 * Load an agent's skills: their instructions and knowledge files (appended in order),
 * their tools, and the MCP servers they need.
 */
export async function loadAgentSkills(names: string[], projectRoot: string): Promise<AgentSkills> {
  const result: AgentSkills = { instructions: '', tools: [], mcpServers: [] };

  for (const name of names) {
    const skill = await loadSkill(name, projectRoot);
    if (!skill) continue;
    const def = skill.definition;
    const skillId = safeId(def.name || skill.name);

    if (def.instructions) result.instructions += `\n\n## Skill: ${def.name || skill.name}\n${def.instructions.trim()}`;

    for (const file of def.knowledge ?? def.manifest?.knowledge ?? []) {
      const path = [isAbsolute(file) ? file : '', skill.filePath ? resolve(dirname(skill.filePath), file) : '', resolve(projectRoot, file)]
        .find(p => p && existsSync(p));
      if (!path) {
        console.warn(`  ⚠ Skill "${skill.name}": knowledge file not found: ${file}`);
        continue;
      }
      const text = readFileSync(path, 'utf-8');
      result.instructions += `\n\n### Reference: ${file}\n${text.slice(0, MAX_KNOWLEDGE_CHARS)}`;
    }

    for (const tool of def.tools ?? []) {
      result.tools.push({
        id: `${skillId}_${safeId(tool.name)}`,
        description: tool.description,
        parameters: toJsonSchema(tool.parameters),
        execute: tool.execute,
      });
    }

    result.mcpServers.push(...(def.mcpServers ?? []), ...(def.manifest?.requiredMcps ?? []));
  }

  return result;
}

/** Accepts a JSON Schema object or a framework-style map of { name: { type, description, required } } */
export function toJsonSchema(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!parameters) return { type: 'object', properties: {} };
  if (parameters.type === 'object') return parameters;
  const entries = Object.entries(parameters) as Array<[string, { type?: string; description?: string; required?: boolean }]>;
  return {
    type: 'object',
    properties: Object.fromEntries(entries.map(([key, p]) => [key, { type: p.type ?? 'string', description: p.description }])),
    required: entries.filter(([, p]) => p.required).map(([key]) => key),
  };
}

function safeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

/**
 * Start the named MCP servers (well-known names, mcp/ files, or .kernova/mcp.json) and connect
 * them to the kernel. Their tools are registered as "<server>_<tool>". Failures are logged.
 */
export async function connectMcpServers(kernel: KernovaKernel, manager: MCPManager, names: string[]): Promise<void> {
  await Promise.all(manager.resolveRequirements([...new Set(names)]).map(async (config) => {
    if (config.autoStart === false) {
      console.log(`  ↳ MCP: ${config.name} is disabled; not started`);
      return;
    }
    try {
      const server = kernel.mcp.register({
        name: config.name,
        transport: { type: 'stdio', command: config.command, args: config.args ?? [], env: config.env ?? {} },
        toolPrefix: mcpToolPrefix(config.name),
        enabled: true,
      });
      const tools = await kernel.mcp.connect(server.id);
      console.log(`  ✓ MCP: ${config.name} connected (${tools.length} tools)`);
    } catch (err) {
      console.warn(`  ⚠ MCP: couldn't start "${config.name}" (${config.command}): ${(err as Error).message}`);
    }
  }));
}

/** Tools of MCP server "github" are registered as "github_<tool>" */
export function mcpToolPrefix(server: string): string {
  return `${safeId(server)}_`;
}

// ─── Models ──────────────────────────────────────────────────────────────────

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'vllm', 'llamacpp']);
/** Cloud platforms that are only auto-detected in some setups (Bedrock with AWS keys, Vertex without GOOGLE_GENAI_USE_VERTEXAI) */
const CLOUD_PROVIDERS = new Set(['azure', 'bedrock', 'vertex']);

/** The kernel's ID for a provider name used in kernova.config.ts ("google" → "gemini", "azure_openai" → "azure") */
export function providerId(provider: string): string {
  return resolveProviderAlias(provider);
}

/**
 * Providers the kernel can't auto-detect from environment variables: local servers, cloud
 * platforms (Azure, Bedrock, Vertex AI), and models configured with a custom `baseUrl`,
 * `apiKeyEnv`, or `options`.
 */
export function createConfiguredProviders(config: KernovaFrameworkConfig): ModelProvider[] {
  const providers = new Map<string, ModelProvider>();
  for (const m of [config.model, ...Object.values(config.models ?? {})]) {
    if (!m) continue;
    const id = providerId(m.provider);
    if (providers.has(id)) continue;
    if (!LOCAL_PROVIDERS.has(id) && !CLOUD_PROVIDERS.has(id) && !m.baseUrl && !m.apiKeyEnv && !m.options) continue;
    const overrides = {
      defaultModel: m.model,
      ...(m.baseUrl && { baseUrl: m.baseUrl }),
      ...(m.apiKeyEnv && { apiKeyEnv: m.apiKeyEnv }),
      ...(m.options && { options: m.options }),
    };
    try {
      providers.set(id, createProvider(id, overrides));
    } catch {
      if (!m.baseUrl) {
        console.warn(`  ⚠ Unknown model provider "${m.provider}". Set a baseUrl to use an OpenAI-compatible API.`);
        continue;
      }
      // Not in the catalog: treat it as an OpenAI-compatible API
      providers.set(id, createProvider({ id, name: m.provider, adapter: 'openai', baseUrl: m.baseUrl, defaultModel: m.model, apiKeyEnv: m.apiKeyEnv, options: m.options }));
    }
  }
  return [...providers.values()];
}

/**
 * The provider and model an agent's `model` field selects: a named model from `config.models`,
 * or a model ID sent to the project's default provider. Undefined means the project default.
 */
export function resolveAgentModel(
  config: KernovaFrameworkConfig,
  model: string | undefined,
): { provider?: string; model: string } | undefined {
  if (!model) return undefined;
  const named = config.models?.[model];
  if (named) return { provider: providerId(named.provider), model: named.model };
  return { ...(config.model && { provider: providerId(config.model.provider) }), model };
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

/** Cost estimate when a provider doesn't report one (same rate as the kernel's BudgetManager) */
const DEFAULT_COST_PER_MILLION_TOKENS = 3;

export class BudgetExceededError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/** How long recorded usage may wait before it's written to disk */
const BUDGET_SAVE_DELAY_MS = 1000;

/**
 * Per-agent budgets from defineAgent({ budget }): requests per minute (in memory), and tokens
 * and estimated cost per calendar month (UTC). With a `storePath`, monthly usage is saved there
 * so it survives restarts.
 */
export class AgentBudgets {
  private readonly requests = new Map<string, number[]>();
  private readonly usage = new Map<string, { month: string; tokens: number; costUsd: number }>();
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly budgets: Map<string, NonNullable<AgentDefinition['budget']>>,
    private readonly storePath?: string,
  ) {
    if (storePath && existsSync(storePath)) {
      try {
        const saved = JSON.parse(readFileSync(storePath, 'utf-8')) as { usage?: Record<string, { month: string; tokens: number; costUsd: number }> };
        for (const [agent, used] of Object.entries(saved.usage ?? {})) this.usage.set(agent, used);
      } catch (err) {
        console.warn(`  ⚠ Couldn't read agent budget usage from ${storePath}: ${(err as Error).message}`);
      }
    }
  }

  /** Write pending usage to disk now (call on shutdown) */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.storePath) return;
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      // Write then rename, so a crash mid-write never leaves a truncated file
      const tmp = `${this.storePath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, usage: Object.fromEntries(this.usage) }, null, 2));
      renameSync(tmp, this.storePath);
    } catch (err) {
      console.warn(`  ⚠ Couldn't save agent budget usage: ${(err as Error).message}`);
    }
  }

  /** Count a request against the agent's budget, or throw BudgetExceededError */
  begin(agent: string): void {
    const budget = this.budgets.get(agent);
    if (!budget) return;

    const used = this.monthUsage(agent);
    if (budget.maxTokens !== undefined && used.tokens >= budget.maxTokens) {
      throw new BudgetExceededError(`Agent "${agent}" has used its monthly token budget (${budget.maxTokens})`);
    }
    if (budget.maxCostUsd !== undefined && used.costUsd >= budget.maxCostUsd) {
      throw new BudgetExceededError(`Agent "${agent}" has used its monthly cost budget ($${budget.maxCostUsd})`);
    }

    if (budget.maxRequestsPerMinute !== undefined) {
      const now = Date.now();
      const recent = (this.requests.get(agent) ?? []).filter(t => now - t < 60_000);
      if (recent.length >= budget.maxRequestsPerMinute) {
        this.requests.set(agent, recent);
        throw new BudgetExceededError(
          `Agent "${agent}" is limited to ${budget.maxRequestsPerMinute} requests per minute`,
          60_000 - (now - recent[0]),
        );
      }
      recent.push(now);
      this.requests.set(agent, recent);
    }
  }

  /** Record the tokens a request used */
  record(agent: string, usage: { totalTokens: number; estimatedCostUsd?: number }): void {
    if (!this.budgets.has(agent)) return;
    const used = this.monthUsage(agent);
    used.tokens += usage.totalTokens;
    used.costUsd += usage.estimatedCostUsd ?? (usage.totalTokens / 1_000_000) * DEFAULT_COST_PER_MILLION_TOKENS;
    if (this.storePath && !this.saveTimer) {
      this.saveTimer = setTimeout(() => this.flush(), BUDGET_SAVE_DELAY_MS);
      this.saveTimer.unref?.();
    }
  }

  private monthUsage(agent: string) {
    const month = new Date().toISOString().slice(0, 7);
    let used = this.usage.get(agent);
    if (!used || used.month !== month) {
      used = { month, tokens: 0, costUsd: 0 };
      this.usage.set(agent, used);
    }
    return used;
  }
}
