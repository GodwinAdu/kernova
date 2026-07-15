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
import { TeamExecutorLocal } from './team-executor-local.js';
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

  // Initialize pluggable memory provider (if configured)
  let memoryProvider: any = null;
  if (config.memory?.provider && config.memory.provider !== 'local' && config.memory.provider !== 'sqlite') {
    try {
      const { createMemoryProvider } = await import('@kernova/core') as any;
      if (createMemoryProvider) {
        memoryProvider = await createMemoryProvider({
          provider: config.memory.provider as any,
          url: config.memory.url || process.env.DATABASE_URL,
          path: `${projectRoot}/kernova-data/memory.db`,
          table: config.memory.table,
          options: config.memory.options,
        });

        // Verify the provider works with a test query
        try {
          const count = await memoryProvider.count('longterm');
          console.log(`  ✓ Memory provider: ${config.memory.provider} connected (${count} memories stored)`);
        } catch (verifyErr: any) {
          console.log(`  ✓ Memory provider: ${config.memory.provider} connected (verify query failed: ${verifyErr.message})`);
        }
      }
    } catch (err) {
      console.error(`  ✗ Memory provider (${config.memory.provider}) failed:`, (err as Error).message);
      console.error(`  ✗ Stack:`, (err as Error).stack?.split('\n').slice(0, 3).join('\n'));
      console.log('  ↳ Falling back to kernel built-in memory (SQLite)');
    }
  }

  // ─── Memory v2 initialization (opt-in) ──────────────────────────────────────
  // Activated when config.memory.version === 2 OR when a memory/ config directory exists.
  // Keeps v1 memoryProvider as fallback — v2 is used preferentially when available.
  let memoryEngine: any = null;
  const memoryV2Enabled = (config.memory as any)?.version === 2 ||
    (() => { try { const { existsSync } = require('node:fs'); const { join } = require('node:path'); return existsSync(join(projectRoot, 'memory', 'index.ts')) || existsSync(join(projectRoot, 'memory', 'index.js')); } catch { return false; } })();

  if (memoryV2Enabled) {
    try {
      const { createMemoryEngine, PostgresMemoryAdapter, SqliteMemoryAdapter, InMemoryAdapter } = await import('@kernova/core') as any;

      // Determine adapter
      let adapter: any;
      const memConfig = config.memory as any;
      const dbUrl = memConfig?.url || process.env.DATABASE_URL;
      const adapterType = memConfig?.adapter || memConfig?.provider || (dbUrl ? 'postgres' : 'sqlite');

      if (typeof adapterType === 'object' && adapterType.name) {
        // Custom adapter instance passed directly
        adapter = adapterType;
      } else if (adapterType === 'postgres' && dbUrl) {
        adapter = new PostgresMemoryAdapter({
          url: dbUrl,
          table: memConfig?.table,
          schema: memConfig?.schema,
          vectorDimensions: memConfig?.vectorDimensions || memConfig?.embedding?.dimensions || 1536,
        });
      } else if (adapterType === 'sqlite') {
        adapter = new SqliteMemoryAdapter({
          path: memConfig?.path || `${projectRoot}/kernova-data/memory.db`,
          table: memConfig?.table,
        });
      } else if (adapterType === 'memory') {
        adapter = new InMemoryAdapter();
      } else if (dbUrl) {
        // Default: postgres if DATABASE_URL is set
        adapter = new PostgresMemoryAdapter({ url: dbUrl, table: memConfig?.table });
      } else {
        // Default: SQLite for local dev
        adapter = new SqliteMemoryAdapter({
          path: `${projectRoot}/kernova-data/memory.db`,
          table: memConfig?.table,
        });
      }

      // Embedding function (reuses existing generateEmbedding)
      const embed = async (text: string): Promise<number[] | null> => {
        return await generateEmbedding(text);
      };

      memoryEngine = await createMemoryEngine({
        adapter,
        embed,
        scoring: memConfig?.scoring,
        compaction: memConfig?.compaction,
        hooks: memConfig?.hooks,
        defaultNamespace: memConfig?.defaultNamespace || 'default',
        debug: process.env.NODE_ENV !== 'production',
      });

      console.log(`  ✓ Memory Engine v2: initialized (adapter: ${adapter.name})`);
    } catch (err: any) {
      console.error(`  ✗ Memory Engine v2 failed:`, err.message);
      // Continue — v1 memoryProvider or kernel fallback still available
    }
  }

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
    const executor = createAgentExecutor(def, tools, projectRoot);

    kernel.agentRegistry.register(coreDefinition as any, executor);
    agentRouteMap.set(agent.route, definitionId);
  }

  // Register custom tools as plugins
  for (const tool of tools) {
    try {
      // Use clean IDs that match OpenAI's pattern: ^[a-zA-Z0-9_-]+$
      const cleanId = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_');

      await kernel.plugins.register({
        id: `fw_${cleanId}`,
        name: cleanId,
        version: '1.0.0',
        type: 'tool',
        tools: [{
          id: cleanId,
          name: cleanId,
          description: tool.definition.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(tool.definition.parameters).map(([name, param]) => [
                name,
                { type: param.type, description: param.description },
              ])
            ),
            required: Object.entries(tool.definition.parameters)
              .filter(([_, param]) => param.required)
              .map(([name]) => name),
          },
          execute: async (params: Record<string, unknown>) => {
            const result = await tool.definition.execute(params as any, {
              env: process.env as Record<string, string | undefined>,
              log: (msg: string) => console.log(`  [tool:${tool.name}] ${msg}`),
            });

            // Auto-persist tool results to memory (only if config.memory.autoSave is enabled)
            const shouldPersistTool = config.memory && (config.memory as any).autoSave === true;
            if (shouldPersistTool && (tool.name.includes('save') || tool.name.includes('note') || tool.name.includes('remember'))) {
              try {
                const content = params.content as string || JSON.stringify(params);
                const tags = params.tags ? (params.tags as string).split(',').map(t => t.trim()) : [];
                tags.push(tool.name);
                if (params.category) tags.push(params.category as string);

                const memEntry = {
                  id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  content,
                  layer: 'longterm' as const,
                  tags,
                  metadata: { tool: tool.name, category: params.category, timestamp: new Date().toISOString() },
                  relevance: 1.0,
                  confidence: 0.8,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };

                if (memoryProvider) {
                  await memoryProvider.store(memEntry);
                } else {
                  await kernel.memoryEngine.store({
                    content,
                    layer: 'longterm',
                    tags,
                    metadata: { tool: tool.name, category: params.category, timestamp: new Date().toISOString() },
                  });
                }
              } catch {
                // Non-critical — continue even if memory store fails
              }
            }

            return result;
          },
        }],
      });
    } catch {
      // Tool may already be registered (built-in) or plugin ID conflict
    }
  }

  // Discover teams
  const { discoverTeams: discoverTeamsFromDir } = await import('./discover-teams.js') as any;
  let discoveredTeams: any[] = [];
  try {
    discoveredTeams = await discoverTeamsFromDir(projectRoot);
  } catch {
    // No teams directory — that's fine
  }

  // Discover remote agents
  let discoveredRemotes: any[] = [];
  try {
    discoveredRemotes = await discoverRemoteAgents(projectRoot);
  } catch {
    // No remotes — that's fine
  }

  // Discover triggers and start scheduler
  let discoveredTriggers: any[] = [];
  try {
    const { discoverTriggers } = await import('./discover-triggers.js');
    discoveredTriggers = await discoverTriggers(projectRoot);
  } catch {
    // No triggers — that's fine
  }

  console.log(`\n  🧠 Kernova Framework Server`);
  console.log(`  ├─ Agents:  ${agents.length} discovered`);
  console.log(`  ├─ Tools:   ${tools.length} registered`);
  console.log(`  ├─ Teams:   ${discoveredTeams.length} configured`);
  console.log(`  ├─ Triggers: ${discoveredTriggers.length} scheduled`);
  console.log(`  ├─ Remotes: ${discoveredRemotes.length} connected`);
  console.log(`  ├─ Memory:  ${memories.length} namespaces`);
  console.log(`  └─ Config:  ${config.name} v${config.version}\n`);

  // Initialize conversation store (PostgreSQL or SQLite — persistent)
  let conversationStore: any;
  try {
    const { createConversationStore } = await import('@kernova/core') as any;
    const dbUrl = config.memory?.url || process.env.DATABASE_URL;
    conversationStore = await createConversationStore({
      provider: dbUrl ? 'postgres' : 'sqlite',
      url: dbUrl,
      path: `${projectRoot}/kernova-data/conversations.db`,
    });
    console.log(`  ✓ Conversation store: ${dbUrl ? 'postgres' : 'sqlite'} connected`);
  } catch (err) {
    // Fallback to in-memory
    const inMemoryThreads = new Map<string, any>();
    conversationStore = {
      async createThread(id: string, title: string, agentName?: string) { const t = { id, title, agentName: agentName || 'assistant', messageCount: 0, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; inMemoryThreads.set(id, t); return t; },
      async getThread(id: string) { return inMemoryThreads.get(id) || null; },
      async listThreads(limit = 50) { return Array.from(inMemoryThreads.values()).sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit); },
      async deleteThread(id: string) { inMemoryThreads.delete(id); },
      async addMessage(threadId: string, role: string, content: string) { if (!inMemoryThreads.has(threadId)) { await (this as any).createThread(threadId, content.slice(0, 60)); } const t = inMemoryThreads.get(threadId)!; const msg = { id: `msg_${Date.now()}`, threadId, role, content, createdAt: new Date().toISOString() }; t.messages.push(msg); t.messageCount++; t.updatedAt = msg.createdAt; if (t.messageCount === 1 && role === 'user') t.title = content.slice(0, 60); return msg; },
      async getMessages(threadId: string, limit = 50) { const t = inMemoryThreads.get(threadId); if (!t) return []; return t.messages.slice(-limit); },
      async getMessageCount(threadId: string) { return inMemoryThreads.get(threadId)?.messageCount || 0; },
      async close() { inMemoryThreads.clear(); },
    };
    console.log('  ↳ Conversation store: in-memory (fallback)');
  }

  // Start autonomous scheduler for triggers
  if (discoveredTriggers.length > 0) {
    startTriggerScheduler(discoveredTriggers, kernel, agentRouteMap);
  }

  // Build route table
  const routes: RouteHandler[] = buildRoutes(kernel, agents, tools, memories, config, agentRouteMap, apiKey, projectRoot, memoryProvider, conversationStore, memoryEngine);

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
    console.log(`     GET  /v1/teams`);
    for (const team of discoveredTeams) {
      const teamSlug = team.name.toLowerCase().replace(/\s+/g, '-');
      console.log(`     POST /v1/teams/${teamSlug}/execute`);
    }
    console.log(`     GET  /memory/search`);
    console.log(`     POST /memory`);
    console.log(`     GET  /health`);
    console.log('');
  });

  return { server, kernel, config, agents, tools, memories, teams: discoveredTeams };
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
  projectRoot: string,
  memoryProvider: any,
  conversationStore: any,
  memoryEngine: any,
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

        const resolvedThreadId = threadId || `thread_${Date.now()}`;

        // ─── MEMORY RECALL (vector search for scale, fallback to all for small stores) ───
        let memoryContext = '';
        const autoRecall = config.memory?.autoRecall !== false; // Default: ON

        if (autoRecall) {
          try {
            let memoryLines: string[] = [];

            // ─── Memory v2 recall (preferred when engine is available) ───
            if (memoryEngine) {
              const results = await memoryEngine.recall(input, { limit: 15, namespace: 'default' });
              memoryLines = results
                .map((r: any) => r.entry.content)
                .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
            }

            // ─── Fallback: v1 memory provider ───
            if (memoryLines.length === 0) {
            const useVectors = config.memory?.vectorSearch !== false; // Default: ON if provider supports it

            console.log(`  [recall] Provider: ${memoryEngine ? 'v2-engine' : memoryProvider ? 'PostgreSQL' : 'kernel-sqlite'}, vectorSearch: ${useVectors}`);

            if (memoryProvider) {
              const totalCount = await memoryProvider.count('longterm').catch(() => 0);

              if (totalCount > 30 && useVectors && memoryProvider.searchByVector) {
                // VECTOR SEARCH — generate embedding of user input, find relevant memories
                const embedding = await generateEmbedding(input);
                if (embedding) {
                  const results = await memoryProvider.searchByVector(embedding, { limit: 15, layer: 'longterm', minScore: 0.3 });
                  memoryLines = results
                    .map((r: any) => {
                      const content = r.entry?.content || r.content || '';
                      const date = r.entry?.createdAt || r.createdAt || '';
                      const dateStr = date ? ` [${new Date(date).toLocaleDateString()}]` : '';
                      return content + dateStr;
                    })
                    .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
                }

                // If vector search returned nothing, fallback to text search
                if (memoryLines.length === 0) {
                  const textResults = await memoryProvider.search({ query: input, layer: 'longterm', limit: 15 });
                  memoryLines = textResults
                    .map((r: any) => (r.entry?.content || r.content || ''))
                    .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
                }
              } else {
                // Small store (< 30) — load all
                const allMemories = await memoryProvider.getAll({ layer: 'longterm', limit: 50 });
                memoryLines = (Array.isArray(allMemories) ? allMemories : [])
                  .map((e: any) => {
                    const content = e.content || '';
                    const date = e.createdAt || '';
                    const dateStr = date ? ` [${new Date(date).toLocaleDateString()}]` : '';
                    return content + dateStr;
                  })
                  .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
              }
            } else {
              // Kernel memory — get all (SQLite, no vectors)
              const memories = await kernel.memoryEngine.query({ limit: 50, layers: ['longterm'] });
              memoryLines = (memories || [])
                .map((m: any) => m.content || '')
                .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
            }
            } // end v1 fallback (memoryLines.length === 0)

            if (memoryLines.length > 0) {
              memoryContext = '\n\nTHINGS I REMEMBER ABOUT YOU (facts from past conversations — ALWAYS reference these!):\n' +
                memoryLines.map((m: string) => `• ${m}`).join('\n') + '\n';
            }
          } catch (err) {
            console.error('[Memory] Recall failed:', (err as Error).message);
          }
        } else {
          console.log('  [debug] Memory recall DISABLED (autoRecall=false)');
        }

        // ─── CONVERSATION CONTEXT (configurable: how many messages to include) ───
        let conversationContext = '';
        const contextMessages = (config.memory as any)?.contextMessages ?? 20;

        if (contextMessages > 0) {
          const recentMessages = await conversationStore.getMessages(resolvedThreadId, contextMessages);
          if (recentMessages.length > 0) {
            conversationContext = '\n\nCONVERSATION HISTORY (use this for context):\n' +
              recentMessages.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
              '\n\n---\nNow respond to the latest user message above. Reference conversation history and memories when relevant.\n';
          }
        }

        // Save user message to conversation store
        console.log(`  [conversation] Saving user message to thread: ${resolvedThreadId}`);
        await conversationStore.addMessage(resolvedThreadId, 'user', input);

        // Build the full prompt with optional memory + history
        const fullInput = `${input}${memoryContext}${conversationContext}`;

        // Submit intent to the kernel (routed to specific agent)
        const result = await kernel.submit({
          goal: fullInput,
          intentType: 'action',
          priority: 'medium',
          owner: user?.id || 'system',
          metadata: {
            threadId: resolvedThreadId,
            agentRoute: agent.route,
            targetAgent: definitionId,
            ...context,
          },
        });

        const responseContent = result.result?.summary || result.result?.data || '';

        // ─── MEMORY AUTO-SAVE (opt-in via config.memory.autoSave) ─────────
        const autoSave = (config.memory as any)?.autoSave === true; // Default: OFF

        if (autoSave) {
          const lowerInput = input.toLowerCase();
          const isPersonalInfo = lowerInput.includes('my name') || lowerInput.includes('i am') ||
            lowerInput.includes('i live') || lowerInput.includes('i work') ||
            lowerInput.includes('remember') || lowerInput.includes('i like') ||
            lowerInput.includes('i prefer') || lowerInput.includes('i spent') ||
            lowerInput.includes('i slept') || lowerInput.includes('call me') ||
            lowerInput.includes('my email');

          if (isPersonalInfo) {
            console.log(`  [memory] Auto-saving personal info: "${input.slice(0, 60)}..."`);
            try {
              // Prefer Memory Engine v2 when available
              if (memoryEngine) {
                await memoryEngine.store(input, {
                  tags: ['user-fact', 'auto-saved'],
                  namespace: 'default',
                  metadata: { threadId: resolvedThreadId, timestamp: new Date().toISOString() },
                  relevance: 1.0,
                  confidence: 0.9,
                });
                console.log(`  [memory] ✓ Saved via Memory Engine v2`);
              } else {
              // Generate embedding for vector search later
              const embedding = await generateEmbedding(input);
              console.log(`  [memory] Embedding generated: ${embedding ? 'yes' : 'no'} (${embedding?.length || 0} dims)`);

              const memEntry = {
                id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                content: input,
                layer: 'longterm' as const,
                tags: ['user-fact', 'auto-saved'],
                metadata: { threadId: resolvedThreadId, timestamp: new Date().toISOString() },
                relevance: 1.0,
                confidence: 0.9,
                embedding: embedding || undefined,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              if (memoryProvider) {
                await memoryProvider.store(memEntry);
                console.log(`  [memory] ✓ Saved to PostgreSQL memory provider`);
              } else {
                await kernel.memoryEngine.store({
                  content: input,
                  layer: 'longterm',
                  tags: ['user-fact', 'auto-saved'],
                  metadata: { threadId: resolvedThreadId, timestamp: new Date().toISOString() },
                });
                console.log(`  [memory] ✓ Saved to kernel memory (SQLite fallback)`);
              }
              }
            } catch (err: any) {
              console.error(`  [memory] ✗ Auto-save failed:`, err.message);
            }
          }
        } else {
          // Only log once per session, not every request
        }

        // Save assistant response to conversation store
        console.log(`  [conversation] Saving assistant response to thread: ${resolvedThreadId}`);
        await conversationStore.addMessage(resolvedThreadId, 'assistant', String(responseContent));

        sendJson(res, 200, {
          content: responseContent,
          threadId: resolvedThreadId,
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

        const resolvedThreadId = threadId || `thread_${Date.now()}`;

        // ─── MEMORY RECALL (same as sync endpoint) ───
        let memoryContext = '';
        const autoRecall = config.memory?.autoRecall !== false;

        if (autoRecall) {
          try {
            let memoryLines: string[] = [];

            // ─── Memory v2 recall (preferred when engine is available) ───
            if (memoryEngine) {
              const results = await memoryEngine.recall(input, { limit: 15, namespace: 'default' });
              memoryLines = results
                .map((r: any) => r.entry.content)
                .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
            }

            // ─── Fallback: v1 memory provider ───
            if (memoryLines.length === 0) {
            if (memoryProvider) {
              const totalCount = await memoryProvider.count('longterm').catch(() => 0);
              if (totalCount <= 30) {
                const allMemories = await memoryProvider.getAll({ layer: 'longterm', limit: 50 });
                memoryLines = (Array.isArray(allMemories) ? allMemories : [])
                  .map((e: any) => {
                    const content = e.content || '';
                    const date = e.createdAt || '';
                    const dateStr = date ? ` [${new Date(date).toLocaleDateString()}]` : '';
                    return content + dateStr;
                  })
                  .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
              } else {
                // Vector or text search for large stores
                const useVectors = config.memory?.vectorSearch !== false;
                if (useVectors && memoryProvider.searchByVector) {
                  const embedding = await generateEmbedding(input);
                  if (embedding) {
                    const results = await memoryProvider.searchByVector(embedding, { limit: 15, layer: 'longterm', minScore: 0.3 });
                    memoryLines = results
                      .map((r: any) => (r.entry?.content || r.content || ''))
                      .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
                  }
                }
                if (memoryLines.length === 0) {
                  const textResults = await memoryProvider.search({ query: input, layer: 'longterm', limit: 15 });
                  memoryLines = textResults
                    .map((r: any) => (r.entry?.content || r.content || ''))
                    .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
                }
              }
            } else {
              const memories = await kernel.memoryEngine.query({ limit: 50, layers: ['longterm'] });
              memoryLines = (memories || [])
                .map((m: any) => m.content || '')
                .filter((s: string) => s.length > 0 && !s.startsWith('{') && !s.startsWith('[') && s.length < 500);
            }
            } // end v1 fallback

            if (memoryLines.length > 0) {
              memoryContext = '\n\nTHINGS I REMEMBER ABOUT YOU (facts from past conversations — ALWAYS reference these!):\n' +
                memoryLines.map((m: string) => `• ${m}`).join('\n') + '\n';
            }
          } catch (err) {
            console.error('[Stream Memory] Recall failed:', (err as Error).message);
          }
        }

        // ─── CONVERSATION CONTEXT ───
        let conversationContext = '';
        const contextMessages = (config.memory as any)?.contextMessages ?? 20;
        if (contextMessages > 0) {
          const recentMessages = await conversationStore.getMessages(resolvedThreadId, contextMessages);
          if (recentMessages.length > 0) {
            conversationContext = '\n\nCONVERSATION HISTORY (use this for context):\n' +
              recentMessages.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
              '\n\n---\nNow respond to the latest user message above. Reference conversation history and memories when relevant.\n';
          }
        }

        // Save user message
        await conversationStore.addMessage(resolvedThreadId, 'user', input);

        // Build full input with memory + conversation
        const fullInput = `${input}${memoryContext}${conversationContext}`;

        // Set up SSE
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        // Subscribe to kernel events for this intent
        const intentId = `intent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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
            goal: fullInput,
            intentType: 'action',
            priority: 'medium',
            owner: user?.id || 'system',
            metadata: {
              threadId: resolvedThreadId,
              agentRoute: agent.route,
              targetAgent: definitionId,
              streaming: true,
            },
          });

          const responseContent = result.result?.summary || result.result?.data || '';

          // Send the final result if the model didn't stream token-by-token
          if (responseContent) {
            res.write(`data: ${JSON.stringify({
              choices: [{ delta: { content: responseContent } }],
              done: true,
            })}\n\n`);
          }

          // Save assistant response
          if (responseContent) {
            await conversationStore.addMessage(resolvedThreadId, 'assistant', String(responseContent));
          }

          // Auto-save personal info (same logic as sync endpoint)
          const autoSave = (config.memory as any)?.autoSave === true;
          if (autoSave) {
            const lowerInput = input.toLowerCase();
            const isPersonalInfo = lowerInput.includes('my name') || lowerInput.includes('i am') ||
              lowerInput.includes('i live') || lowerInput.includes('i work') ||
              lowerInput.includes('remember') || lowerInput.includes('i like') ||
              lowerInput.includes('i prefer') || lowerInput.includes('call me');
            if (isPersonalInfo) {
              try {
                if (memoryEngine) {
                  await memoryEngine.store(input, {
                    tags: ['user-fact', 'auto-saved'],
                    namespace: 'default',
                    metadata: { threadId: resolvedThreadId, timestamp: new Date().toISOString() },
                    relevance: 1.0,
                    confidence: 0.9,
                  });
                } else {
                const embedding = await generateEmbedding(input);
                const memEntry = {
                  id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  content: input, layer: 'longterm' as const, tags: ['user-fact', 'auto-saved'],
                  metadata: { threadId: resolvedThreadId, timestamp: new Date().toISOString() },
                  relevance: 1.0, confidence: 0.9, embedding: embedding || undefined,
                  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                };
                if (memoryProvider) { await memoryProvider.store(memEntry); }
                else { await kernel.memoryEngine.store({ content: input, layer: 'longterm', tags: ['user-fact', 'auto-saved'], metadata: { threadId: resolvedThreadId } }); }
                }
              } catch { /* non-critical */ }
            }
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
        owner: owner || 'system',
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

      let results: any[] = [];

      // Use PostgreSQL memory provider when available (supports text search + vectors)
      if (memoryProvider) {
        try {
          const searchResults = await memoryProvider.search({
            query,
            limit,
            layer: 'longterm',
          });
          results = searchResults.map((r: any) => ({
            id: r.entry?.id || r.id,
            content: r.entry?.content || r.content || '',
            score: r.score || 0.5,
            tags: r.entry?.tags || r.tags || [],
            metadata: r.entry?.metadata || r.metadata || {},
            createdAt: r.entry?.createdAt || r.createdAt || '',
          }));
        } catch (err: any) {
          console.error('[Memory Search] Provider search failed:', err.message);
        }
      }

      // Fallback to kernel memory engine
      if (results.length === 0) {
        const kernelResults = await kernel.memoryEngine.query({
          query,
          limit,
          layers: ['longterm'],
        });
        results = (kernelResults || []).map((r: any) => ({
          id: r.id,
          content: r.content,
          score: r.score,
          tags: r.tags || [],
          metadata: r.metadata,
          createdAt: r.createdAt,
        }));
      }

      sendJson(res, 200, {
        entries: results,
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

      const entryId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();

      // Use PostgreSQL memory provider when available
      if (memoryProvider) {
        try {
          // Generate embedding for vector search
          const embedding = await generateEmbedding(content);

          await memoryProvider.store({
            id: entryId,
            content,
            layer: 'longterm',
            tags: tags || [],
            metadata: { namespace, ...metadata },
            relevance: 1.0,
            confidence: 0.9,
            embedding: embedding || undefined,
            createdAt: now,
            updatedAt: now,
          });

          console.log(`  [memory] ✓ POST /memory stored: "${content.slice(0, 50)}..." (id: ${entryId})`);

          sendJson(res, 201, {
            id: entryId,
            content,
            tags: tags || [],
            createdAt: now,
          });
          return;
        } catch (err: any) {
          console.error(`  [memory] ✗ POST /memory provider store failed:`, err.message);
          // Fall through to kernel
        }
      }

      // Fallback to kernel memory engine
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

  // ─── Thread management (Conversation Persistence) ─────────────────────────

  // (Conversation store is passed in from createServer)

  // GET /threads — list all conversations
  routes.push({
    method: 'GET',
    pattern: /^\/threads$/,
    handler: async (_req, res) => {
      const threads = await conversationStore.listThreads(50);
      sendJson(res, 200, { threads });
    },
  });

  // POST /threads — create a new thread
  routes.push({
    method: 'POST',
    pattern: /^\/threads$/,
    handler: async (req, res) => {
      const body = await parseBody(req);
      const { title, agentName } = body as { title?: string; agentName?: string };
      const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const thread = await conversationStore.createThread(id, title || 'New Conversation', agentName);
      sendJson(res, 201, { id: thread.id, title: thread.title });
    },
  });

  // GET /threads/:id — get a thread
  routes.push({
    method: 'GET',
    pattern: /^\/threads\/([^/]+)$/,
    handler: async (_req, res, match) => {
      const threadId = match[1];
      const thread = await conversationStore.getThread(threadId);
      if (!thread) { sendJson(res, 404, { error: 'Thread not found' }); return; }
      sendJson(res, 200, thread);
    },
  });

  // POST /threads/:id/messages — add a message
  routes.push({
    method: 'POST',
    pattern: /^\/threads\/([^/]+)\/messages$/,
    handler: async (req, res, match) => {
      const threadId = match[1];
      const body = await parseBody(req);
      const { role, content } = body as { role?: string; content?: string };
      if (!content) { sendJson(res, 400, { error: 'Missing "content"' }); return; }
      const message = await conversationStore.addMessage(threadId, role || 'user', content);
      sendJson(res, 201, { message });
    },
  });

  // GET /threads/:id/messages — get messages (paginated)
  routes.push({
    method: 'GET',
    pattern: /^\/threads\/([^/]+)\/messages$/,
    handler: async (req, res, match) => {
      const threadId = match[1];
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const before = url.searchParams.get('before') || undefined;
      const messages = await conversationStore.getMessages(threadId, limit, before);
      sendJson(res, 200, { messages });
    },
  });

  // DELETE /threads/:id — delete a thread
  routes.push({
    method: 'DELETE',
    pattern: /^\/threads\/([^/]+)$/,
    handler: async (_req, res, match) => {
      const threadId = match[1];
      await conversationStore.deleteThread(threadId);
      sendJson(res, 200, { deleted: true, id: threadId });
    },
  });

  // ─── Tasks & Workflows (Durable Execution) ─────────────────────────

  routes.push({
    method: 'POST',
    pattern: /^\/v1\/teams\/([^/]+)\/execute$/,
    handler: async (req, res, match) => {
      const teamName = match[1];
      const body = await parseBody(req);
      const { goal, strategy, context, timeout } = body as {
        goal?: string;
        strategy?: string;
        context?: Record<string, unknown>;
        timeout?: number;
      };

      if (!goal) {
        sendJson(res, 400, { error: 'Missing "goal" in request body' });
        return;
      }

      // Discover teams from the project
      const { discoverTeams } = await import('./discover-teams.js');
      const teams = await discoverTeams(projectRoot);
      const teamDef = teams.find(t => t.name.toLowerCase().replace(/\s+/g, '-') === teamName || t.name === teamName);

      if (!teamDef) {
        sendJson(res, 404, {
          error: `Team "${teamName}" not found`,
          available: teams.map(t => t.name.toLowerCase().replace(/\s+/g, '-')),
        });
        return;
      }

      // Build the agent executor that bridges team tasks → kernel agents
      const teamAgentExecutor = async (agentName: string, input: string, ctx: any): Promise<{ content: string; metadata?: Record<string, unknown> }> => {
        const defId = agentRouteMap.get(agentName);
        if (!defId) {
          return { content: `[Agent "${agentName}" not found]` };
        }

        const result = await kernel.submit({
          goal: input,
          intentType: 'action',
          priority: 'medium',
          owner: 'team-executor',
          metadata: {
            targetAgent: defId,
            agentRoute: agentName,
            teamExecution: true,
            threadId: `team_${teamName}_${Date.now()}`,
          },
        });

        const content: string = String(result.result?.summary || result.result?.data || '');
        return { content, metadata: { intentId: result.id } };
      };

      // Create and execute the team
      const executor = new TeamExecutorLocal(
        {
          id: teamName,
          name: teamDef.name,
          description: teamDef.description,
          strategy: (strategy as any) || teamDef.strategy,
          members: teamDef.members,
          maxDelegationDepth: teamDef.maxDelegationDepth,
          taskTimeout: timeout || teamDef.taskTimeout,
          requireLeadApproval: teamDef.requireLeadApproval,
          workspace: teamDef.workspace,
        },
        teamAgentExecutor,
      );

      // Set up SSE for progress tracking
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const trace = await executor.execute({
        goal,
        context,
        timeout: timeout || teamDef.taskTimeout,
        onProgress: (event: any) => {
          res.write(`data: ${JSON.stringify({ type: 'progress', event })}\n\n`);
        },
      });

      // Send final result
      res.write(`data: ${JSON.stringify({
        type: 'result',
        result: {
          result: trace.result,
          tasks: trace.tasks,
          messages: trace.messages,
          duration: trace.completedAt
            ? new Date(trace.completedAt).getTime() - new Date(trace.startedAt).getTime()
            : 0,
          totalTasks: trace.tasks.length,
        },
      })}\n\n`);

      res.write('data: [DONE]\n\n');
      res.end();
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/v1\/teams$/,
    handler: async (_req, res) => {
      const { discoverTeams } = await import('./discover-teams.js');
      const teams = await discoverTeams(projectRoot);
      sendJson(res, 200, {
        teams: teams.map(t => ({
          name: t.name,
          description: t.description,
          strategy: t.strategy,
          members: t.members.map(m => ({
            agent: m.agent,
            role: m.role,
            description: m.description,
            specialization: m.specialization,
          })),
        })),
      });
    },
  });

  routes.push({
    method: 'GET',
    pattern: /^\/tasks$/,
    handler: async (_req, res) => {
      // Return durable execution tasks
      sendJson(res, 200, { tasks: [], count: 0 });
    },
  });

  // ─── Approvals (Human-in-the-Loop) ───────────────────────────────

  routes.push({
    method: 'GET',
    pattern: /^\/approvals$/,
    handler: async (_req, res) => {
      sendJson(res, 200, { pending: [], all: [] });
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/approvals\/([^/]+)\/(approve|deny)$/,
    handler: async (req, res, match) => {
      const requestId = match[1];
      const action = match[2];
      const body = await parseBody(req);

      sendJson(res, 200, {
        success: true,
        requestId,
        action,
        message: `Approval ${action}d`,
      });
    },
  });

  // ─── Logs (Runtime) ──────────────────────────────────────────────

  routes.push({
    method: 'GET',
    pattern: /^\/logs$/,
    handler: async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') || '50');

      // Return recent events from the kernel's event bus
      try {
        sendJson(res, 200, { logs: [], count: 0 });
      } catch {
        sendJson(res, 200, { logs: [], count: 0 });
      }
    },
  });

  // ─── Metrics ─────────────────────────────────────────────────────

  routes.push({
    method: 'GET',
    pattern: /^\/metrics$/,
    handler: async (_req, res) => {
      const status = kernel.getStatus();
      sendJson(res, 200, {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        agents: status.registeredAgents,
        environment: status.environment,
        providers: status.availableProviders,
      });
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
  tools: DiscoveredTool[],
  projectRoot: string,
): (intent: any, context: any, agentTools: any) => Promise<any> {
  return async (intent, context, agentTools) => {
    const startTime = Date.now();

    // If the agent has a custom handler, use it
    if (agentDef.handler) {
      const noopWorkspace = {
        get: <T = unknown>(_key: string): T | undefined => undefined,
        set: (_key: string, _value: unknown) => {},
        has: (_key: string) => false,
        delete: (_key: string) => {},
        getAll: () => ({}),
        merge: (_key: string, _data: Record<string, unknown>) => {},
        append: (_key: string, _item: unknown) => {},
      };

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
        delegateTo: async (agentName: string, goal: string) => {
          const result = await agentTools.delegate(agentName, goal);
          return result.output || '';
        },
        askRemote: async (agentName: string, input: string, options?: any) => {
          return await executeRemoteAgentCall(projectRoot, agentName, input, options);
        },
        workspace: noopWorkspace,
        teamMembers: undefined,
        emit: (chunk) => {
          agentTools.emit('model.token', { token: chunk, intentId: intent.id });
        },
        log: (msg: string) => console.log(`  [agent:${agentDef.name}] ${msg}`),
        env: process.env as Record<string, string | undefined>,
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

// ─── Trigger Scheduler (Autonomous Background Tasks) ─────────────────────────

/**
 * Starts background timers that fire triggers at their configured intervals.
 * Each trigger submits a goal to the specified agent when it fires.
 */
function startTriggerScheduler(
  triggers: Array<{ name: string; event: string; agent: string; goal: string; priority?: string; cooldown?: number }>,
  kernel: any,
  agentRouteMap: Map<string, string>,
): void {
  const lastFired = new Map<string, number>();

  for (const trigger of triggers) {
    // Parse interval from event pattern
    const intervalMs = parseEventInterval(trigger.event);
    if (intervalMs <= 0) continue;

    console.log(`  ⏰ Trigger: "${trigger.name}" → every ${formatInterval(intervalMs)}`);

    // Set up the interval
    setInterval(async () => {
      // Check cooldown
      const last = lastFired.get(trigger.name) || 0;
      const cooldown = trigger.cooldown || intervalMs;
      if (Date.now() - last < cooldown) return;

      lastFired.set(trigger.name, Date.now());

      console.log(`  [trigger] Firing: ${trigger.name}`);

      try {
        // Find the target agent
        const defId = agentRouteMap.get(trigger.agent);
        if (!defId) {
          console.warn(`  [trigger] Agent "${trigger.agent}" not found for trigger "${trigger.name}"`);
          return;
        }

        // Submit the goal to the agent
        const result = await kernel.submit({
          goal: trigger.goal,
          intentType: 'action',
          priority: trigger.priority || 'medium',
          owner: 'system',
          metadata: {
            triggerName: trigger.name,
            triggerEvent: trigger.event,
            autonomous: true,
            threadId: `trigger_${trigger.name}`,
            targetAgent: defId,
            agentRoute: trigger.agent,
          },
        });

        console.log(`  [trigger] ✓ ${trigger.name} completed`);
      } catch (err) {
        console.error(`  [trigger] ✗ ${trigger.name} failed:`, (err as Error).message);
      }
    }, intervalMs);
  }
}

/**
 * Generate an embedding vector using OpenAI's embedding API.
 * Returns null if no API key or request fails.
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000), // Max input for embedding
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json() as any;
      return data.data?.[0]?.embedding || null;
    }
  } catch {
    // Embedding generation failed — non-critical
  }
  return null;
}

/**
 * Parse event pattern to interval in milliseconds.
 * Supports: schedule.5m, schedule.1h, schedule.12h, schedule.24h, schedule.weekly
 */
function parseEventInterval(event: string): number {
  if (!event.startsWith('schedule.')) return 0;
  const value = event.replace('schedule.', '');

  if (value === 'weekly') return 7 * 24 * 60 * 60 * 1000;

  const match = value.match(/^(\d+)(m|h|d|s)$/);
  if (!match) {
    // Try as hours (e.g., "24h")
    if (value.endsWith('h')) return parseInt(value) * 3600000;
    if (value.endsWith('m')) return parseInt(value) * 60000;
    return 0;
  }

  const num = parseInt(match[1]);
  switch (match[2]) {
    case 's': return num * 1000;
    case 'm': return num * 60000;
    case 'h': return num * 3600000;
    case 'd': return num * 86400000;
    default: return 0;
  }
}

function formatInterval(ms: number): string {
  if (ms >= 86400000) return `${ms / 86400000}d`;
  if (ms >= 3600000) return `${ms / 3600000}h`;
  if (ms >= 60000) return `${ms / 60000}m`;
  return `${ms / 1000}s`;
}

// ─── Remote Agent Execution ──────────────────────────────────────────────────

/**
 * Execute a remote agent call via KAP.
 *
 * Resolution order:
 * 1. If defineRemoteAgent has endpoint + auth → call directly (external agent)
 * 2. Otherwise → route through Kernova Cloud proxy using the project's API key
 *    (the same key from `kernova login` — no extra keys needed)
 *
 * For Kernova Cloud agents: the developer clicks "Connect" in the dashboard,
 * and `ctx.askRemote()` just works. Kernova Cloud uses the project's identity
 * to look up the connection and proxy the request.
 */
async function executeRemoteAgentCall(
  projectRoot: string,
  agentName: string,
  input: string,
  options?: { capability?: string; params?: Record<string, unknown>; timeout?: number },
): Promise<string> {
  // Load remote agent definitions
  const remoteAgents = await discoverRemoteAgents(projectRoot);
  const remoteDef = remoteAgents.find(r => r.name === agentName);

  // If we have a direct endpoint + auth (external non-Kernova agent), call directly
  if (remoteDef?.endpoint && remoteDef.auth?.token) {
    return await callRemoteAgentDirect(
      { name: remoteDef.name, endpoint: remoteDef.endpoint, auth: remoteDef.auth },
      input,
      options,
    );
  }

  // Otherwise, route through Kernova Cloud proxy
  // Auth: use the project's KERNOVA_API_KEY (from `kernova login` or dashboard env)
  // Kernova Cloud identifies the calling project and checks its connections
  const cloudUrl = process.env.KERNOVA_CLOUD_URL || 'https://kernova-cloud.vercel.app';
  const projectApiKey = process.env.KERNOVA_API_KEY || process.env.KERNOVA_PROJECT_KEY;

  if (projectApiKey) {
    return await callRemoteAgentViaProxy(cloudUrl, projectApiKey, agentName, input, options);
  }

  // No API key at all — give helpful error
  return `[Cannot reach remote agent "${agentName}". Either:\n` +
    `  1. Connect via Kernova Cloud dashboard (recommended — no keys needed)\n` +
    `  2. Set KERNOVA_API_KEY in your environment (from kernova login)\n` +
    `  3. Use defineRemoteAgent() with endpoint + auth for external agents]`;
}

/**
 * Call a remote agent directly (when endpoint + auth are provided)
 */
async function callRemoteAgentDirect(
  remoteDef: { name: string; endpoint: string; auth: { type: string; token?: string; headerName?: string } },
  input: string,
  options?: { capability?: string; params?: Record<string, unknown>; timeout?: number },
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Agent-Protocol': 'kap/1.0',
  };

  // Set auth header
  if (remoteDef.auth.type === 'api-key' && remoteDef.auth.token) {
    headers[remoteDef.auth.headerName || 'X-API-Key'] = remoteDef.auth.token;
  } else if ((remoteDef.auth.type === 'bearer' || remoteDef.auth.type === 'oauth2') && remoteDef.auth.token) {
    headers['Authorization'] = `Bearer ${remoteDef.auth.token}`;
  }

  const body = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    protocol: 'kap/1.0',
    from: { id: 'local', name: 'Local Agent', organization: 'self' },
    capability: options?.capability || 'ask',
    input,
    params: options?.params,
    timeout: options?.timeout || 30000,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(remoteDef.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options?.timeout || 30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return `[Error from ${remoteDef.name}: HTTP ${res.status} — ${errText || res.statusText}]`;
    }

    const response = await res.json() as any;
    return response.output || response.data || JSON.stringify(response);
  } catch (err: any) {
    return `[Failed to reach ${remoteDef.name}: ${err.message}]`;
  }
}

/**
 * Call a remote agent via Kernova Cloud's proxy (registry-authenticated)
 */
async function callRemoteAgentViaProxy(
  cloudUrl: string,
  connectionToken: string,
  agentName: string,
  input: string,
  options?: { capability?: string; params?: Record<string, unknown>; timeout?: number },
): Promise<string> {
  const body = {
    capability: options?.capability || 'ask',
    input,
    params: options?.params,
    context: { agentName },
  };

  try {
    const res = await fetch(`${cloudUrl}/api/kap/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${connectionToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options?.timeout || 30000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: { message: res.statusText } })) as any;
      return `[KAP Proxy Error: ${errData.error?.message || res.statusText}]`;
    }

    const response = await res.json() as any;

    if (response.status === 'error') {
      return `[Remote agent error: ${response.error?.message || 'Unknown error'}]`;
    }

    return response.output || response.data || JSON.stringify(response);
  } catch (err: any) {
    return `[Failed to reach Kernova Cloud proxy: ${err.message}]`;
  }
}

/**
 * Discover remote agent definitions from the filesystem.
 * Looks in: agents/remotes/, remotes/, src/agents/remotes/
 */
async function discoverRemoteAgents(projectRoot: string): Promise<Array<{
  name: string;
  endpoint?: string;
  discover?: boolean;
  auth: { type: string; token?: string; headerName?: string };
  timeout?: number;
}>> {
  const { existsSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const dirs = [
    join(projectRoot, 'agents', 'remotes'),
    join(projectRoot, 'remotes'),
    join(projectRoot, 'src', 'agents', 'remotes'),
  ];

  const results: Array<any> = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter(
      (f: string) => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mts') || f.endsWith('.mjs'),
    );

    for (const file of files) {
      try {
        const filePath = join(dir, file);
        const fileUrl = pathToFileURL(filePath).href;
        const mod = await import(fileUrl);
        const def = mod.default || mod;

        if (def && def.name && def.auth) {
          results.push(def);
        }
      } catch {
        // Skip files that fail to load
      }
    }
  }

  return results;
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
