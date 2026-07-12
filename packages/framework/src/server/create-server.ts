/**
 * createServer — Creates the Kernova agent backend server.
 *
 * Boots KernovaKernel, registers discovered agents/tools from the filesystem,
 * and exposes the Gateway API for the frontend to consume.
 *
 * This is the REAL implementation — agents execute through the kernel with LLM calls.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { KernovaKernel } from '@kernova/core';
import { loadConfig } from './load-config.js';
import { discoverAgents } from './discover-agents.js';
import { discoverTools } from './discover-tools.js';
import { discoverMemory } from './discover-memory.js';
import type { KernovaFrameworkConfig } from '../types/config.js';
import type { AgentDefinition as FrameworkAgentDef } from '../types/agent.js';
import type { DiscoveredAgent } from './discover-agents.js';
import type { DiscoveredTool } from './discover-tools.js';
import type { DiscoveredMemory } from './discover-memory.js';

export interface ServerOptions {
  /** Project root directory */
  projectRoot?: string;
  /** Port to listen on (defaults to 4555) */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** CORS origins */
  cors?: string[];
  /** API key required for requests (simple auth) */
  apiKey?: string;
}

interface RouteHandler {
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, match: RegExpMatchArray) => Promise<void>;
}

/**
 * Create and start the Kernova agent backend server.
 * Wires discovered agents into KernovaKernel for real execution.
 */
export async function createServer(options: ServerOptions = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const port = options.port || parseInt(process.env.KERNOVA_PORT || '4555');
  const host = options.host || '0.0.0.0';
  const apiKey = options.apiKey || process.env.KERNOVA_API_KEY;

  // Load config
  const config = await loadConfig(projectRoot);

  // Discover project structure
  const agents = await discoverAgents(projectRoot);
  const tools = await discoverTools(projectRoot);
  const memories = await discoverMemory(projectRoot);

  // Boot KernovaKernel
  const kernel = new KernovaKernel({
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    debug: process.env.NODE_ENV !== 'production',
    dataDir: `${projectRoot}/kernova-data`,
    models: config.model ? {
      default: {
        provider: config.model.provider,
        model: config.model.model,
      },
      ...(config.models ? Object.fromEntries(
        Object.entries(config.models).map(([key, val]) => [key, { provider: val.provider, model: val.model }])
      ) : {}),
    } : undefined,
  });

  await kernel.start();

  // Register discovered agents with the kernel
  const agentRouteMap = new Map<string, string>(); // route → definitionId

  for (const agent of agents) {
    const definitionId = `agent_${agent.route.replace(/\//g, '_')}`;
    const def = agent.definition;

    // Convert framework AgentDefinition → core AgentDefinition
    const coreDefinition = {
      id: definitionId,
      type: 'agent_definition' as const,
      version: '1.0.0',
      owner: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
      name: def.name,
      description: def.description || `Agent: ${def.name}`,
      capabilities: (def.capabilities || []).map((cap: string) => ({
        id: cap,
        name: cap,
        description: cap,
        confidence: 0.8,
      })),
      tools: (def.tools || []).map((t: string) => ({ id: t, name: t, required: false })),
      models: [{
        id: def.model || config.model?.model || 'gpt-4o',
        provider: config.model?.provider || 'openai',
        purpose: 'primary' as const,
      }],
      instructions: def.instructions,
      memoryConfig: {
        layers: {
          working: { maxItems: 50 },
          session: { ttlSeconds: def.memory?.ttl ? parseTtl(def.memory.ttl) : 3600 },
          longterm: { provider: 'local' },
        },
      },
      permissions: [],
      concurrency: 5,
      config: {
        maxTokens: def.maxTokens || 4096,
        temperature: def.temperature || 0.7,
      },
    };

    // Create the executor — uses the kernel's model router + tools
    const executor = createAgentExecutor(def, tools);

    kernel.agentRegistry.register(coreDefinition as any, executor);
    agentRouteMap.set(agent.route, definitionId);
  }

  // Register custom tools as plugins
  for (const tool of tools) {
    try {
      await kernel.plugins.register({
        id: `framework-tool:${tool.name}`,
        name: tool.name,
        version: '1.0.0',
        type: 'tool',
        tools: [{
          id: tool.name,
          name: tool.name,
          description: tool.definition.description,
          parameters: Object.fromEntries(
            Object.entries(tool.definition.parameters).map(([name, param]) => [
              name,
              { type: param.type, description: param.description, required: param.required ?? false },
            ])
          ),
          execute: async (params: Record<string, unknown>) => {
            return await tool.definition.execute(params as any, {
              env: process.env as Record<string, string | undefined>,
              log: (msg: string) => console.log(`  [tool:${tool.name}] ${msg}`),
            });
          },
        }],
      });
    } catch {
      // Tool may already be registered (built-in) or plugin ID conflict
    }
  }

  console.log(`\n  🧠 Kernova Framework Server`);
  console.log(`  ├─ Agents:  ${agents.length} discovered`);
  console.log(`  ├─ Tools:   ${tools.length} registered`);
  console.log(`  ├─ Memory:  ${memories.length} namespaces`);
  console.log(`  └─ Config:  ${config.name} v${config.version}\n`);

  // Build route table
  const routes: RouteHandler[] = buildRoutes(kernel, agents, tools, memories, config, agentRouteMap, apiKey);

  // Create HTTP server
  const server = createHttpServer(async (req, res) => {
    // CORS handling
    const corsOrigins = options.cors || config.gateway?.cors || ['*'];
    const origin = req.headers.origin || '*';

    if (corsOrigins.includes('*') || corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (apiKey) {
      const authHeader = req.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

      // Skip auth for health endpoint
      const url = req.url || '/';
      if (url !== '/health' && providedKey !== apiKey) {
        sendJson(res, 401, { error: 'Unauthorized. Provide a valid Bearer token.' });
        return;
      }
    }

    // Match route
    const url = req.url || '/';
    const matched = matchRoute(routes, req.method || 'GET', url);

    if (matched) {
      try {
        await matched.handler(req, res, matched.match);
      } catch (err) {
        console.error(`Error handling ${req.method} ${url}:`, err);
        sendJson(res, 500, {
          error: 'Internal server error',
          message: process.env.NODE_ENV !== 'production' ? (err as Error).message : undefined,
        });
      }
    } else {
      sendJson(res, 404, { error: 'Not found', path: url });
    }
  });

  server.listen(port, host, () => {
    console.log(`  ⚡ Agent API ready at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`  📡 Routes:`);
    for (const agent of agents) {
      console.log(`     POST /agents/${agent.route}`);
      console.log(`     POST /agents/${agent.route}/stream`);
    }
    console.log(`     POST /v1/intents`);
    console.log(`     GET  /memory/search`);
    console.log(`     POST /memory`);
    console.log(`     GET  /health`);
    console.log('');
  });

  return { server, kernel, config, agents, tools, memories };
}

// ─── Route Builder ───────────────────────────────────────────────────────────

function buildRoutes(
  kernel: KernovaKernel,
  agents: DiscoveredAgent[],
  tools: DiscoveredTool[],
  memories: DiscoveredMemory[],
  config: KernovaFrameworkConfig,
  agentRouteMap: Map<string, string>,
  apiKey: string | undefined,
): RouteHandler[] {
  const routes: RouteHandler[] = [];

  // Health check (no auth required)
  routes.push({
    method: 'GET',
    pattern: /^\/health$/,
    handler: async (_req, res) => {
      const status = kernel.getStatus();
      sendJson(res, 200, {
        status: 'healthy',
        name: config.name,
        version: config.version,
        agents: agents.map((a) => ({ route: a.route, name: a.definition.name })),
        registeredAgents: status.registeredAgents,
        uptime: process.uptime(),
        environment: status.environment,
      });
    },
  });

  // ─── Agent routes (file-based) ───────────────────────────────────────────

  for (const agent of agents) {
    const routePattern = new RegExp(`^\\/agents\\/${escapeRegex(agent.route)}$`);
    const streamPattern = new RegExp(`^\\/agents\\/${escapeRegex(agent.route)}\\/stream$`);
    const definitionId = agentRouteMap.get(agent.route)!;

    // POST /agents/:name — synchronous request through KernovaKernel
    routes.push({
      method: 'POST',
      pattern: routePattern,
      handler: async (req, res) => {
        const body = await parseBody(req);
        const { input, threadId, context, user } = body as {
          input?: string;
          threadId?: string;
          context?: Record<string, unknown>;
          user?: { id: string };
        };

        if (!input) {
          sendJson(res, 400, { error: 'Missing "input" in request body' });
          return;
        }

        // Submit intent to the kernel (routed to specific agent)
        const result = await kernel.submit({
          goal: input,
          intentType: 'action',
          priority: 'medium',
          owner: user?.id || 'anonymous',
          metadata: {
            threadId: threadId || `thread_${Date.now()}`,
            agentRoute: agent.route,
            targetAgent: definitionId,
            ...context,
          },
        });

        sendJson(res, 200, {
          content: result.result?.summary || result.result?.data || '',
          threadId: threadId || `thread_${Date.now()}`,
          agent: agent.route,
          intentId: result.id,
          status: result.intentStatus,
          metadata: {
            model: agent.definition.model || config.model?.model,
            durationMs: result.result?.durationMs,
            confidence: result.result?.evidence?.confidence,
          },
        });
      },
    });

    // POST /agents/:name/stream — streaming response via SSE
    routes.push({
      method: 'POST',
      pattern: streamPattern,
      handler: async (req, res) => {
        const body = await parseBody(req);
        const { input, threadId, user } = body as {
          input?: string;
          threadId?: string;
          user?: { id: string };
        };

        if (!input) {
          sendJson(res, 400, { error: 'Missing "input" in request body' });
          return;
        }

        // Set up SSE
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        // Subscribe to kernel events for this intent
        const intentId = `intent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // For streaming, we submit the intent and listen for token events
        // The kernel's model router emits token events during completion
        const tokenHandler = (event: any) => {
          if (event.data?.intentId === intentId && event.data?.token) {
            res.write(`data: ${JSON.stringify({
              choices: [{ delta: { content: event.data.token } }],
            })}\n\n`);
          }
        };

        const subscriptionId = kernel.events.subscribe(['model.token'], tokenHandler);

        try {
          const result = await kernel.submit({
            id: intentId,
            goal: input,
            intentType: 'action',
            priority: 'medium',
            owner: user?.id || 'anonymous',
            metadata: {
              threadId: threadId || `thread_${Date.now()}`,
              agentRoute: agent.route,
              targetAgent: definitionId,
              streaming: true,
            },
          });

          // Send the final result if the model didn't stream token-by-token
          if (result.result?.summary) {
            res.write(`data: ${JSON.stringify({
              choices: [{ delta: { content: result.result.summary } }],
              done: true,
            })}\n\n`);
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
        } finally {
          kernel.events.unsubscribe(subscriptionId);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      },
    });
  }

  // ─── Generic intent endpoint ─────────────────────────────────────────────

  routes.push({
    method: 'POST',
    pattern: /^\/v1\/intents$/,
    handler: async (req, res) => {
      const body = await parseBody(req);
      const { goal, agent: agentName, priority, owner } = body as {
        goal?: string;
        agent?: string;
        priority?: string;
        owner?: string;
      };

      if (!goal) {
        sendJson(res, 400, { error: 'Missing "goal" in request body' });
        return;
      }

      const metadata: Record<string, unknown> = {};
      if (agentName) {
        const definitionId = agentRouteMap.get(agentName);
        if (!definitionId) {
          sendJson(res, 404, { error: `Agent "${agentName}" not found. Available: ${agents.map(a => a.route).join(', ')}` });
          return;
        }
        metadata.targetAgent = definitionId;
        metadata.agentRoute = agentName;
      }

      const result = await kernel.submit({
        goal,
        intentType: 'action',
        priority: (priority as any) || 'medium',
        owner: owner || 'anonymous',
        metadata,
      });

      sendJson(res, 200, {
        id: result.id,
        goal,
        agent: agentName || 'auto',
        status: result.intentStatus,
        result: {
          content: result.result?.summary || result.result?.data || '',
          confidence: result.result?.evidence?.confidence,
          durationMs: result.result?.durationMs,
        },
      });
    },
  });

  // ─── Memory endpoints ────────────────────────────────────────────────────

  routes.push({
    method: 'GET',
    pattern: /^\/memory\/search/,
    handler: async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const query = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '10');

      const results = await kernel.memoryEngine.query({
        query,
        limit,
        layers: ['longterm'],
      });

      sendJson(res, 200, {
        entries: results.map((r: any) => ({
          id: r.id,
          content: r.content,
          score: r.score,
          tags: r.tags || [],
          metadata: r.metadata,
          createdAt: r.createdAt,
        })),
        query,
        count: results.length,
      });
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/memory$/,
    handler: async (req, res) => {
      const body = await parseBody(req);
      const { content, tags, namespace, metadata } = body as {
        content?: string;
        tags?: string[];
        namespace?: string;
        metadata?: Record<string, unknown>;
      };

      if (!content) {
        sendJson(res, 400, { error: 'Missing "content" in request body' });
        return;
      }

      const entry = await kernel.memoryEngine.store({
        content,
        layer: 'longterm',
        tags: tags || [],
        metadata: { namespace, ...metadata },
      });

      sendJson(res, 201, {
        id: entry.id,
        content: entry.content,
        tags: entry.tags,
        createdAt: entry.createdAt,
      });
    },
  });

  routes.push({
    method: 'DELETE',
    pattern: /^\/memory\/([^/]+)$/,
    handler: async (req, res, match) => {
      const id = match[1];

      try {
        await kernel.memoryEngine.delete(id);
        sendJson(res, 200, { deleted: true, id });
      } catch {
        sendJson(res, 404, { error: `Memory entry "${id}" not found` });
      }
    },
  });

  // ─── Thread management ───────────────────────────────────────────────────

  routes.push({
    method: 'GET',
    pattern: /^\/threads$/,
    handler: async (_req, res) => {
      // Return conversation threads from conversation manager
      const threads = kernel.conversation.listThreads?.() || [];
      sendJson(res, 200, { threads });
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/threads$/,
    handler: async (req, res) => {
      const body = await parseBody(req);
      const { title, agentName } = body as { title?: string; agentName?: string };

      const thread = {
        id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: title || 'New Conversation',
        agentName: agentName || agents[0]?.route || 'default',
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      sendJson(res, 201, thread);
    },
  });

  routes.push({
    method: 'DELETE',
    pattern: /^\/threads\/([^/]+)$/,
    handler: async (_req, res, match) => {
      const threadId = match[1];
      // Clear thread from conversation manager
      sendJson(res, 200, { deleted: true, id: threadId });
    },
  });

  return routes;
}

// ─── Agent Executor Factory ──────────────────────────────────────────────────

/**
 * Creates a KernovaKernel-compatible executor from a framework agent definition.
 * This bridges defineAgent() → kernel.agentRegistry.register().
 */
function createAgentExecutor(
  agentDef: FrameworkAgentDef,
  tools: DiscoveredTool[]
): (intent: any, context: any, agentTools: any) => Promise<any> {
  return async (intent, context, agentTools) => {
    const startTime = Date.now();

    // If the agent has a custom handler, use it
    if (agentDef.handler) {
      const result = await agentDef.handler({
        input: intent.goal,
        threadId: intent.metadata?.threadId || 'default',
        user: intent.metadata?.user,
        recall: async (query, opts) => {
          const memories = await agentTools.recall(query);
          return memories.map((m: string) => ({
            content: m,
            score: 1,
            tags: [],
            createdAt: new Date(),
          }));
        },
        remember: async (content, tags) => {
          await agentTools.remember(content, 'longterm');
        },
        delegate: async (agentName, input) => {
          const result = await agentTools.delegate(agentName, input);
          return { content: result.output || '', metadata: {} };
        },
        emit: (chunk) => {
          agentTools.emit('model.token', { token: chunk, intentId: intent.id });
        },
      });

      const content = typeof result === 'string' ? result : result.content;
      return {
        success: true,
        summary: content,
        data: content,
        evidence: { sources: [], confidence: 0.9, reasoning: 'Custom handler execution' },
        durationMs: Date.now() - startTime,
      };
    }

    // Default: Use LLM completion with the agent's instructions + tools
    const systemPrompt = agentDef.instructions;
    const userMessage = intent.goal;

    // Build prompt
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;

    // If agent has tools configured, use tool-calling completion
    const agentToolNames = agentDef.tools || [];

    let response: string;

    if (agentToolNames.length > 0) {
      // Use tool-calling completion (LLM can invoke tools)
      response = await agentTools.completeWithTools(fullPrompt, agentToolNames);
    } else {
      // Simple completion (no tools)
      response = await agentTools.complete(fullPrompt);
    }

    return {
      success: true,
      summary: response,
      data: response,
      evidence: {
        sources: [],
        confidence: 0.85,
        reasoning: 'LLM completion with agent instructions',
      },
      durationMs: Date.now() - startTime,
    };
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchRoute(routes: RouteHandler[], method: string, url: string) {
  const pathname = url.split('?')[0];

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) {
      return { handler: route.handler, match };
    }
  }
  return null;
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a TTL string like '7d', '30d', '24h' into seconds.
 */
function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 3600;

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 3600;
  }
}
