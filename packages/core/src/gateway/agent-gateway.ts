/**
 * Kernova Agent Gateway
 *
 * HTTP server that exposes agents as API services:
 * - POST /v1/chat/completions (OpenAI-compatible)
 * - POST /v1/intents (native intent API)
 * - POST /hooks/:path (webhook routing)
 * - GET /health
 * - Token-based auth
 * - Rate limiting integration
 * - CORS support
 *
 * Inspired by OpenClaw's gateway/server.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { NexusId, NexusEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { KernovaKernel } from '../kernel.js';
import { generateId, now } from '../utils.js';

export interface GatewayAuthConfig {
  /** Bearer tokens that grant access */
  tokens?: string[];
  /** Allow unauthenticated access (dev mode) */
  allowAnonymous?: boolean;
}

export interface GatewayConfig {
  port?: number;                 // default: 3000
  host?: string;                 // default: '0.0.0.0'
  auth?: GatewayAuthConfig;
  /** Enable CORS headers */
  cors?: boolean;                // default: true
  /** Request body size limit in bytes */
  maxBodyBytes?: number;         // default: 1MB
}

const DEFAULT_CONFIG: Required<GatewayConfig> = {
  port: 3000,
  host: '0.0.0.0',
  auth: { allowAnonymous: true },
  cors: true,
  maxBodyBytes: 1_048_576,
};

export class AgentGateway {
  private readonly kernel: KernovaKernel;
  private readonly eventBus: EventBus;
  private readonly config: Required<GatewayConfig>;
  private server: ReturnType<typeof createServer> | null = null;
  private running = false;

  constructor(kernel: KernovaKernel, eventBus: EventBus, config?: GatewayConfig) {
    this.kernel = kernel;
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<GatewayConfig>;
  }

  /**
   * Start the HTTP gateway server.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.server = createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.emitEvent('gateway.started', 'gateway', {
          port: this.config.port,
          host: this.config.host,
        });
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the gateway server.
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.emitEvent('gateway.stopped', 'gateway', {});
        resolve();
      });
    });
  }

  get port(): number { return this.config.port; }
  get isRunning(): boolean { return this.running; }

  // ─── Request Handling ──────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    if (this.config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }

    // Auth check
    if (!this.authenticate(req)) {
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      // Parse URL path and query string
      const [pathname, queryString] = url.split('?');
      const query = new URLSearchParams(queryString || '');

      if (pathname === '/health' && method === 'GET') {
        await this.handleHealth(res);
      } else if (pathname === '/v1/intents' && method === 'POST') {
        await this.handleIntentSubmit(req, res);
      } else if (pathname === '/v1/chat/completions' && method === 'POST') {
        await this.handleChatCompletion(req, res);
      } else if (pathname === '/v1/agents' && method === 'GET') {
        this.handleGetAgents(res);
      } else if (pathname === '/v1/events' && method === 'GET') {
        this.handleGetEvents(res, query);
      } else if (pathname === '/v1/memory/search' && method === 'POST') {
        await this.handleMemorySearch(req, res);
      } else if (pathname === '/v1/metrics' && method === 'GET') {
        this.handleGetMetrics(res);
      } else if (pathname === '/v1/workflows' && method === 'GET') {
        this.handleGetWorkflows(res);
      } else if (pathname === '/v1/plugins' && method === 'GET') {
        this.handleGetPlugins(res);
      } else if (pathname === '/v1/plugins/install' && method === 'POST') {
        await this.handlePluginInstall(req, res);
      } else if (pathname === '/v1/permissions/identities' && method === 'GET') {
        this.handleGetIdentities(res);
      } else if (pathname === '/v1/permissions/keys' && method === 'GET') {
        this.handleGetApiKeys(res);
      } else if (pathname === '/v1/logs' && method === 'GET') {
        this.handleGetLogs(res, query);
      } else if (pathname === '/v1/deployments' && method === 'GET') {
        this.handleGetDeployments(res);
      } else if (pathname?.startsWith('/v1/context/') && method === 'GET') {
        const intentId = pathname.split('/v1/context/')[1];
        this.handleGetContext(res, intentId);
      } else if (pathname === '/v1/workflows' && method === 'POST') {
        await this.handleCreateWorkflow(req, res);
      } else if (pathname === '/v1/permissions/identities' && method === 'POST') {
        await this.handleCreateIdentity(req, res);
      } else if (pathname === '/v1/permissions/keys' && method === 'POST') {
        await this.handleCreateApiKey(req, res);
      } else if (pathname?.startsWith('/v1/permissions/keys/') && method === 'DELETE') {
        const keyId = pathname.split('/v1/permissions/keys/')[1];
        this.handleRevokeApiKey(res, keyId);
      } else if (pathname?.startsWith('/v1/deployments/') && pathname.endsWith('/restart') && method === 'POST') {
        this.handleRestartDeployment(res);
      } else if (pathname?.startsWith('/hooks/') && method === 'POST') {
        await this.handleWebhook(req, res, url);
      } else {
        this.sendJson(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.sendJson(res, 500, { error: msg });
    }
  }

  private async handleHealth(res: ServerResponse): Promise<void> {
    const status = this.kernel.getStatus();
    this.sendJson(res, 200, {
      status: 'ok',
      running: status.running,
      agents: status.registeredAgents,
      activeIntents: status.activeIntents,
    });
  }

  private async handleIntentSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.goal) {
      this.sendJson(res, 400, { error: 'Missing required field: goal' });
      return;
    }

    const intent = await this.kernel.submit({
      goal: String(body.goal),
      intentType: (body.type as 'query' | 'action') ?? undefined,
      priority: (body.priority as 'low' | 'medium' | 'high' | 'critical') ?? undefined,
      owner: body.owner as string | undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });

    this.sendJson(res, 200, {
      id: intent.id,
      status: intent.intentStatus,
      result: intent.result,
    });
  }

  private async handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.messages || !Array.isArray(body.messages)) {
      this.sendJson(res, 400, { error: 'Missing required field: messages' });
      return;
    }

    // Extract the last user message as the goal
    const lastUserMsg = [...body.messages].reverse().find((m: { role: string }) => m.role === 'user');
    if (!lastUserMsg) {
      this.sendJson(res, 400, { error: 'No user message found' });
      return;
    }

    const intent = await this.kernel.submit({
      goal: lastUserMsg.content,
      intentType: 'query',
      priority: 'medium',
    });

    // OpenAI-compatible response format
    this.sendJson(res, 200, {
      id: `chatcmpl-${intent.id}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'kernova',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: intent.result?.summary ?? '',
        },
        finish_reason: intent.result?.success ? 'stop' : 'error',
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    const body = await this.readBody(req);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }

    const result = await this.kernel.webhooks.handle({
      method: 'POST',
      path: url,
      headers,
      body,
    });

    if (result.matched) {
      this.sendJson(res, result.error ? 400 : 200, { ok: !result.error, error: result.error });
    } else {
      this.sendJson(res, 404, { error: 'No matching webhook route' });
    }
  }

  // ─── Studio API Handlers ─────────────────────────────────────

  private handleGetAgents(res: ServerResponse): void {
    const agentDefs = this.kernel.agentRegistry.list();
    const agents = agentDefs.map((a) => ({
      id: a.id,
      name: a.name || a.id,
      capabilities: a.capabilities?.map((c: any) => typeof c === 'string' ? c : c.name) || [],
      status: 'active',
      model: a.models?.[0]?.model || 'default',
      intentsProcessed: 0,
      createdAt: a.createdAt || new Date().toISOString(),
    }));
    this.sendJson(res, 200, { agents });
  }

  private handleGetEvents(res: ServerResponse, query: URLSearchParams): void {
    const category = query.get('category') || undefined;
    const severity = query.get('severity') || undefined;
    const limit = parseInt(query.get('limit') || '50', 10);

    // Get recent events from EventBus history
    let events = this.eventBus.getRecentEvents ? this.eventBus.getRecentEvents(limit) : [];

    if (category) {
      events = events.filter((e: any) => e.category === category);
    }
    if (severity) {
      events = events.filter((e: any) => e.severity === severity);
    }

    const mapped = events.map((e: any) => ({
      id: e.id,
      type: e.eventType,
      category: e.category,
      severity: e.severity,
      message: this.formatEventMessage(e),
      data: e.data,
      timestamp: e.timestamp,
    }));

    this.sendJson(res, 200, { events: mapped });
  }

  private async handleMemorySearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.query) {
      this.sendJson(res, 400, { error: 'Missing required field: query' });
      return;
    }

    const searchQuery = String(body.query);
    const layer = body.layer as string | undefined;

    try {
      const memories = await this.kernel.memoryEngine.query({
        query: searchQuery,
        layers: layer ? [layer as any] : undefined,
        limit: 20,
      });

      const results = memories.map((m: any) => ({
        id: m.id,
        content: m.content || '',
        layer: m.layer || 'working',
        tags: m.tags || [],
        relevance: m.relevance ?? 0.5,
        timestamp: m.createdAt || new Date().toISOString(),
      }));

      this.sendJson(res, 200, { results });
    } catch {
      this.sendJson(res, 200, { results: [] });
    }
  }

  private handleGetMetrics(res: ServerResponse): void {
    const status = this.kernel.getStatus();
    const usageStats = status.modelUsage;

    this.sendJson(res, 200, {
      totalTokens: usageStats?.usage?.totalTokens ?? 0,
      totalRequests: usageStats?.requestCount ?? 0,
      errorRate: 0,
      avgLatency: 0,
      activeAgents: status.registeredAgents,
      pendingTasks: status.activeIntents,
      uptime: Math.floor(process.uptime()),
    });
  }

  private handleGetWorkflows(res: ServerResponse): void {
    const workflowDefs = this.kernel.workflows.listDefinitions();
    const running = this.kernel.workflows.listRunning();
    const runningIds = new Set(running.map((r: any) => r.definitionId));

    const workflows = workflowDefs.map((w: any) => ({
      id: w.id,
      name: w.name || w.id,
      steps: w.steps?.length ?? 0,
      status: runningIds.has(w.id) ? 'active' : 'draft',
      lastRun: '',
      createdAt: w.createdAt || new Date().toISOString(),
    }));
    this.sendJson(res, 200, { workflows });
  }

  private handleGetPlugins(res: ServerResponse): void {
    const tools = this.kernel.plugins.listTools();
    const registeredPlugins = this.kernel.plugins.list ? this.kernel.plugins.list() : [];

    // If plugins have a list method, use it directly
    if (registeredPlugins.length > 0) {
      const plugins = registeredPlugins.map((p: any) => ({
        id: p.id,
        name: p.name || p.id,
        version: p.version || '0.1.0',
        status: 'installed' as const,
        description: p.description || `Plugin with ${p.tools?.length ?? 0} tool(s)`,
        author: p.author || 'Kernova',
      }));
      this.sendJson(res, 200, { plugins });
      return;
    }

    // Fallback: infer from tools
    const plugins = [{
      id: '@kernova/built-in-tools',
      name: '@kernova/built-in-tools',
      version: '0.2.0',
      status: 'installed' as const,
      description: `Provides ${tools.length} built-in tool(s)`,
      author: 'Kernova',
    }];
    this.sendJson(res, 200, { plugins });
  }

  private async handlePluginInstall(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.name) {
      this.sendJson(res, 400, { error: 'Missing required field: name' });
      return;
    }
    // Plugin installation is a placeholder — in production this would download from marketplace
    this.sendJson(res, 200, { id: generateId('pl'), name: body.name, status: 'installed' });
  }

  private handleGetIdentities(res: ServerResponse): void {
    const identities = this.kernel.identity.listIdentities();
    const mapped = identities.map((i: any) => ({
      id: i.id,
      name: i.name || i.id,
      type: i.type || 'user',
      roles: i.roles || [],
      lastActive: i.lastActive || new Date().toISOString(),
    }));
    this.sendJson(res, 200, { identities: mapped });
  }

  private handleGetApiKeys(res: ServerResponse): void {
    // API keys are managed through the auth config — return configured token prefixes
    const tokens = this.config.auth.tokens || [];
    const keys = tokens.map((t, i) => ({
      id: `key-${String(i + 1).padStart(3, '0')}`,
      name: `API Key ${i + 1}`,
      prefix: `${t.slice(0, 8)}****...${t.slice(-4)}`,
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }));
    this.sendJson(res, 200, { keys });
  }

  private handleGetLogs(res: ServerResponse, query: URLSearchParams): void {
    const level = query.get('level') || undefined;
    const limit = parseInt(query.get('limit') || '100', 10);

    // Get recent events and format as log entries
    let events = this.eventBus.getRecentEvents ? this.eventBus.getRecentEvents(limit) : [];

    if (level) {
      const severityMap: Record<string, string[]> = {
        debug: ['info'],
        info: ['info'],
        warn: ['warn', 'warning'],
        error: ['error', 'critical'],
      };
      const allowed = severityMap[level] || [level];
      events = events.filter((e: any) => allowed.includes(e.severity));
    }

    const logs = events.map((e: any) => ({
      id: e.id,
      level: e.severity === 'critical' ? 'error' : e.severity === 'warning' ? 'warn' : e.severity,
      message: this.formatEventMessage(e),
      source: e.metadata?.source || e.category || 'kernel',
      traceId: e.correlationId?.slice(0, 8),
      timestamp: e.timestamp,
    }));

    this.sendJson(res, 200, { logs });
  }

  private handleGetDeployments(res: ServerResponse): void {
    const status = this.kernel.getStatus();
    // The kernel itself is a "deployment" — return runtime info
    this.sendJson(res, 200, {
      deployments: [{
        id: status.instanceId,
        environment: status.environment,
        status: status.running ? 'running' : 'stopped',
        version: '0.2.0',
        timestamp: new Date().toISOString(),
      }],
    });
  }

  private handleGetContext(res: ServerResponse, intentId: string): void {
    const memoryStats = this.kernel.memoryEngine.getStats();

    const layers = [
      { name: 'system', entries: 1, tokens: 200 },
      { name: 'organizational', entries: memoryStats.organizational ?? 0, tokens: (memoryStats.organizational ?? 0) * 50 },
      { name: 'longterm', entries: memoryStats.longterm ?? 0, tokens: (memoryStats.longterm ?? 0) * 80 },
      { name: 'session', entries: memoryStats.session ?? 0, tokens: (memoryStats.session ?? 0) * 100 },
      { name: 'working', entries: memoryStats.working ?? 0, tokens: (memoryStats.working ?? 0) * 120 },
      { name: 'intent', entries: 1, tokens: 100 },
    ];

    const totalTokens = layers.reduce((sum, l) => sum + l.tokens, 0);

    this.sendJson(res, 200, {
      intentId,
      layers,
      totalTokens,
      computedAt: new Date().toISOString(),
    });
  }

  private formatEventMessage(event: any): string {
    const data = event.data || {};
    switch (event.eventType) {
      case 'intent.created': return `New intent submitted: ${data.goal || 'unknown'}`;
      case 'intent.executing': return `Agent executing intent ${data.intentId || ''}`;
      case 'intent.completed': return `Intent ${data.intentId || ''} completed`;
      case 'intent.failed': return `Intent ${data.intentId || ''} failed: ${data.error || ''}`;
      case 'agent.selected': return `Agent "${data.agentId || ''}" selected`;
      case 'gateway.started': return `Gateway started on port ${data.port || 3000}`;
      case 'gateway.stopped': return `Gateway stopped`;
      case 'kernel.started': return `Kernel started (${data.instanceId || ''})`;
      case 'kernel.stopping': return `Kernel stopping (${data.activeIntents || 0} active intents)`;
      default: return event.eventType;
    }
  }

  // ─── Write Operations (Studio Actions) ─────────────────────

  private async handleCreateWorkflow(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.name) {
      this.sendJson(res, 400, { error: 'Missing required field: name' });
      return;
    }

    const id = generateId('wf');
    const steps = Array.isArray(body.steps) ? body.steps : [];

    const definition = {
      id,
      type: 'workflow_definition' as const,
      version: '1.0.0',
      owner: 'system',
      status: 'active' as const,
      createdAt: now(),
      updatedAt: now(),
      metadata: {},
      name: String(body.name),
      description: String(body.description || ''),
      steps: steps.map((s: any, i: number) => ({
        id: `${id}-step-${i + 1}`,
        name: String(s.name || `Step ${i + 1}`),
        type: (s.type || 'agent') as 'agent' | 'tool' | 'human' | 'conditional' | 'parallel',
        config: s.config || {},
      })),
    };

    this.kernel.workflows.define(definition as any);
    this.sendJson(res, 201, { id, name: body.name, steps: steps.length, status: 'draft' });
  }

  private async handleCreateIdentity(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.name) {
      this.sendJson(res, 400, { error: 'Missing required field: name' });
      return;
    }

    try {
      const identity = this.kernel.identity.registerIdentity({
        name: String(body.name),
        type: (body.type as 'user' | 'agent' | 'service') || 'user',
        roles: Array.isArray(body.roles) ? body.roles : [],
      });

      this.sendJson(res, 201, {
        id: identity.id,
        name: identity.name,
        type: identity.type,
        roles: Array.isArray(body.roles) ? body.roles : [],
      });
    } catch (err: any) {
      this.sendJson(res, 400, { error: err.message });
    }
  }

  private async handleCreateApiKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body || !body.name || !body.ownerId) {
      this.sendJson(res, 400, { error: 'Missing required fields: name, ownerId' });
      return;
    }

    try {
      const result = this.kernel.identity.createApiKey({
        name: String(body.name),
        ownerId: String(body.ownerId),
        permissions: Array.isArray(body.permissions) ? body.permissions : ['*'],
      });

      this.sendJson(res, 201, {
        id: result.key.id,
        name: result.key.name,
        key: result.plaintext, // Only returned on creation — client must save this
        prefix: result.key.prefix,
        createdAt: result.key.createdAt,
      });
    } catch (err: any) {
      this.sendJson(res, 400, { error: err.message });
    }
  }

  private handleRevokeApiKey(res: ServerResponse, keyId: string): void {
    if (!keyId) {
      this.sendJson(res, 400, { error: 'Missing key ID' });
      return;
    }

    try {
      const revoked = this.kernel.identity.revokeApiKey(keyId);
      if (revoked) {
        this.sendJson(res, 200, { ok: true, id: keyId });
      } else {
        this.sendJson(res, 404, { error: 'API key not found' });
      }
    } catch (err: any) {
      this.sendJson(res, 400, { error: err.message });
    }
  }

  private handleRestartDeployment(res: ServerResponse): void {
    // In a real deployment orchestrator this would restart the service.
    // For the local runtime, we emit a restart event and confirm.
    this.emitEvent('deployment.restart', this.kernel.getStatus().instanceId, {
      action: 'restart',
      timestamp: new Date().toISOString(),
    });
    this.sendJson(res, 200, { ok: true, message: 'Restart signal sent' });
  }

  // ─── Helpers ───────────────────────────────────────────────

  private authenticate(req: IncomingMessage): boolean {
    if (this.config.auth.allowAnonymous) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return false;

    const token = authHeader.slice(7);
    return this.config.auth.tokens?.includes(token) ?? false;
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.config.maxBodyBytes) {
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });

      req.on('error', () => resolve(null));
    });
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'gateway',
      actorId: 'agent-gateway',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'agent-gateway', environment: 'runtime' },
    });
  }
}
