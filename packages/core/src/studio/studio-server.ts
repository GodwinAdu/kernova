/**
 * Kernova Studio Server
 * 
 * Embedded HTTP server that provides:
 * - REST API for querying kernel state
 * - Server-Sent Events for real-time event streaming
 * - Static HTML dashboard (self-contained, no build step)
 * 
 * Starts automatically with `kernova dev` on port 4200.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import type { KernovaKernel } from '../kernel.js';
import type { KernovaEvent } from '@kernova/types';
import { getStudioHTML } from './studio-ui.js';

export interface StudioServerConfig {
  port?: number;
  host?: string;
  /** Require authentication for API routes (default: false in dev) */
  requireAuth?: boolean;
  /** Path to TLS certificate for HTTPS (optional) */
  tlsCert?: string;
  /** Path to TLS key for HTTPS (optional) */
  tlsKey?: string;
}

export class StudioServer {
  private server: ReturnType<typeof createServer> | null = null;
  private kernel: KernovaKernel;
  private port: number;
  private host: string;
  private requireAuth: boolean;
  private tlsCert?: string;
  private tlsKey?: string;
  private sseClients: Set<ServerResponse> = new Set();
  private eventSubscriptionId: string | null = null;

  constructor(kernel: KernovaKernel, config: StudioServerConfig = {}) {
    this.kernel = kernel;
    this.port = config.port || 4200;
    this.host = config.host || 'localhost';
    this.requireAuth = config.requireAuth || false;
    this.tlsCert = config.tlsCert;
    this.tlsKey = config.tlsKey;
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const handler = (req: IncomingMessage, res: ServerResponse) => this.handleRequest(req, res);

      // Use HTTPS if TLS cert/key provided
      if (this.tlsCert && this.tlsKey) {
        this.server = createHttpsServer({
          cert: readFileSync(this.tlsCert),
          key: readFileSync(this.tlsKey),
        }, handler);
      } else {
        this.server = createServer(handler);
      }

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port
          this.port++;
          this.server!.listen(this.port, this.host);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        // Subscribe to events for SSE streaming
        this.eventSubscriptionId = this.kernel.events.subscribe(['*'], (event) => {
          this.broadcastEvent(event);
        });

        const protocol = this.tlsCert ? 'https' : 'http';
        const url = `${protocol}://${this.host}:${this.port}`;
        resolve(url);
      });
    });
  }

  async stop(): Promise<void> {
    // Unsubscribe from events
    if (this.eventSubscriptionId) {
      this.kernel.events.unsubscribe(this.eventSubscriptionId);
    }

    // Close all SSE connections
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    // Close server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  /** Same-origin browser requests and non-browser clients (no Origin header) only */
  private isTrustedRequest(req: IncomingMessage): boolean {
    const host = req.headers.host ?? '';
    const local = ['localhost', '127.0.0.1', '::1'].includes(this.host);
    if (local && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;

    const origin = req.headers.origin;
    if (!origin) return true;
    const scheme = this.tlsCert && this.tlsKey ? 'https' : 'http';
    return origin === `${scheme}://${host}`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // The dashboard is served from this server, so it never needs CORS. Refuse requests from
    // other origins (a web page open in your browser) and, on localhost, Host names other than
    // localhost (DNS rebinding), so other sites can't use the API through your browser.
    if (!this.isTrustedRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cross-origin requests are not allowed' }));
      return;
    }

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Authentication gate for API routes (UI and health are public)
    if (path.startsWith('/api/') && path !== '/api/health' && this.requireAuth) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      if (token) {
        // Try API key first, then session
        const keyAuth = this.kernel.identity.authenticateWithKey(token);
        const sessionAuth = !keyAuth ? this.kernel.identity.authenticateWithSession(token) : null;

        if (!keyAuth && !sessionAuth) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid authentication token' }));
          return;
        }
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required. Pass Bearer token in Authorization header.' }));
        return;
      }
    }

    // Route
    try {
      if (path === '/' || path === '/index.html') {
        this.serveUI(res);
      } else if (path === '/health' || path === '/api/health') {
        // Health check — no auth required, used by load balancers
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
      } else if (path === '/api/status') {
        this.handleStatus(res);
      } else if (path === '/api/agents') {
        this.handleAgents(res);
      } else if (path === '/api/events') {
        this.handleEvents(req, res, url);
      } else if (path === '/api/events/stream') {
        this.handleEventStream(req, res);
      } else if (path === '/api/memory') {
        this.handleMemory(req, res, url);
      } else if (path === '/api/intents' && method === 'POST') {
        this.handleSubmitIntent(req, res);
      } else if (path === '/api/workflows') {
        this.handleWorkflows(res);
      } else if (path === '/api/identity/keys' && method === 'POST') {
        await this.handleCreateKey(req, res);
      } else if (path === '/api/identity/keys') {
        this.handleListKeys(res);
      } else if (path === '/api/identity/users') {
        this.handleListIdentities(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  private serveUI(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getStudioHTML());
  }

  private handleStatus(res: ServerResponse): void {
    const status = this.kernel.getStatus();
    const eventStats = this.kernel.events.getStats();
    const memoryStats = this.kernel.memoryEngine.getStats();

    this.json(res, {
      ...status,
      events: eventStats,
      memory: memoryStats,
    });
  }

  private handleAgents(res: ServerResponse): void {
    const agents = this.kernel.agentRegistry.list();
    this.json(res, { agents });
  }

  private handleEvents(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const type = url.searchParams.get('type') || undefined;
    const category = url.searchParams.get('category') || undefined;
    const subjectId = url.searchParams.get('subjectId') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

    const events = this.kernel.events.query({
      type,
      category: category as any,
      subjectId,
      limit,
      order,
    });

    this.json(res, { events, total: events.length });
  }

  private handleEventStream(req: IncomingMessage, res: ServerResponse): void {
    // Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write('data: {"type":"connected"}\n\n');

    this.sseClients.add(res);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private async handleMemory(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const query = url.searchParams.get('q') || undefined;
    const layer = url.searchParams.get('layer') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const memories = await this.kernel.memoryEngine.query({
      query,
      layers: layer ? [layer as any] : undefined,
      limit,
    });

    this.json(res, { memories, total: memories.length });
  }

  private async handleSubmitIntent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { goal, type, priority } = JSON.parse(body);

    if (!goal) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'goal is required' }));
      return;
    }

    const result = await this.kernel.submit({
      goal,
      intentType: type || 'query',
      priority: priority || 'medium',
    });

    this.json(res, { intent: result });
  }

  private handleWorkflows(res: ServerResponse): void {
    const definitions = this.kernel.workflows.listDefinitions();
    const running = this.kernel.workflows.listRunning();
    const pending = this.kernel.workflows.getPendingApprovals();
    this.json(res, { definitions, running, pendingApprovals: pending });
  }

  private async handleCreateKey(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { name, ownerId, permissions } = JSON.parse(body);

    if (!name || !ownerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'name and ownerId required' }));
      return;
    }

    try {
      const result = this.kernel.identity.createApiKey({
        name,
        ownerId,
        permissions: permissions || ['intent:submit', 'memory:read'],
      });
      this.json(res, { key: result.key, plaintext: result.plaintext });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  private handleListKeys(res: ServerResponse): void {
    const keys = this.kernel.identity.apiKeys.listActive();
    // Never expose hashes — only safe metadata
    const safe = keys.map(k => ({
      id: k.id, name: k.name, prefix: k.prefix, ownerId: k.ownerId,
      permissions: k.permissions, createdAt: k.createdAt, active: k.active,
    }));
    this.json(res, { keys: safe });
  }

  private handleListIdentities(res: ServerResponse): void {
    const identities = this.kernel.identity.listIdentities();
    this.json(res, { identities });
  }

  private broadcastEvent(event: KernovaEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.sseClients) {
      client.write(`data: ${data}\n\n`);
    }
  }

  private json(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}
