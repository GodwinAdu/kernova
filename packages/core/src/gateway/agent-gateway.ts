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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
      if (url === '/health' && method === 'GET') {
        await this.handleHealth(res);
      } else if (url === '/v1/intents' && method === 'POST') {
        await this.handleIntentSubmit(req, res);
      } else if (url === '/v1/chat/completions' && method === 'POST') {
        await this.handleChatCompletion(req, res);
      } else if (url.startsWith('/hooks/') && method === 'POST') {
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
