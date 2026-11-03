/**
 * WebSocket Channel Adapter
 *
 * A WebSocket server-based channel adapter that accepts client connections,
 * manages them with ping/pong keepalive (30s interval), and routes messages
 * to registered handlers.
 *
 * Uses Node.js built-in WebSocket support (no external dependencies).
 */

import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { OutboundMessage, DeliveryReceipt, InboundMessage, SDKChannelAdapter } from '@kernova/types';
import { generateId, now } from '../../utils.js';
import { MAX_INBOUND_BODY_BYTES, header, safeEqual } from '../inbound.js';

export interface WebSocketAdapterConfig {
  /** Port to listen on (default: 3200) */
  port?: number;

  /** Path for WebSocket connections (default: '/ws') */
  path?: string;

  /** Ping/pong keepalive interval in ms (default: 30000) */
  keepaliveIntervalMs?: number;

  /** Optional adapter ID override */
  id?: string;

  /**
   * Token clients must present: `Authorization: Bearer <token>`, or `?token=<token>` in the
   * URL (browsers can't set headers on WebSocket connections)
   */
  token?: string;

  /**
   * Browser origins allowed to connect, e.g. ['https://app.example.com']. Browsers don't apply
   * CORS to WebSockets, so connections that send an Origin header are refused unless the origin
   * is listed here or the client presents the token.
   */
  allowedOrigins?: string[];

  /** Interface to listen on (default: all interfaces when `token` is set, otherwise 127.0.0.1) */
  host?: string;
}

interface ClientInfo {
  ws: WebSocket;
  id: string;
  alive: boolean;
}

export class WebSocketChannelAdapter implements SDKChannelAdapter {
  readonly id: string;
  readonly type = 'websocket';

  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private messageHandlers: Array<(message: InboundMessage) => Promise<void>> = [];
  private clients: Map<string, ClientInfo> = new Map();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private port: number;
  private path: string;
  private keepaliveIntervalMs: number;
  private connected = false;

  constructor(private config: WebSocketAdapterConfig = {}) {
    this.id = config.id || generateId('ws');
    this.port = config.port ?? 3200;
    this.path = config.path ?? '/ws';
    this.keepaliveIntervalMs = config.keepaliveIntervalMs ?? 30_000;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise<void>((resolve, reject) => {
      this.httpServer = createServer();

      this.wss = new WebSocketServer({
        server: this.httpServer,
        path: this.path,
        maxPayload: MAX_INBOUND_BODY_BYTES,
        verifyClient: (info: { origin: string; req: IncomingMessage }, done: (ok: boolean, code?: number, reason?: string) => void) => {
          const refusal = this.refuse(info.req, info.origin);
          if (refusal) done(false, refusal.code, refusal.reason);
          else done(true);
        },
      });

      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });

      this.httpServer.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
      });

      const host = this.config.host ?? (this.config.token ? undefined : '127.0.0.1');
      this.httpServer.listen(this.port, host, () => {
        this.connected = true;
        this.startKeepalive();
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.stopKeepalive();

    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close(1000, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.connected = false;
  }

  /** Send to one client (`recipient` = an inbound message's replyTo), or to every client without one */
  async send(message: OutboundMessage, recipient?: string): Promise<DeliveryReceipt> {
    if (recipient && !this.clients.has(recipient)) {
      return { success: false, timestamp: now(), error: `Client ${recipient} is not connected` };
    }
    if (!this.connected || this.clients.size === 0) {
      return {
        success: false,
        timestamp: now(),
        error: 'No connected clients',
      };
    }

    const payload = JSON.stringify({
      type: 'message',
      content: message.content,
      structured: message.structured,
      timestamp: now(),
    });

    let sentCount = 0;
    const targets = recipient ? [this.clients.get(recipient)!] : this.clients.values();
    for (const client of targets) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        sentCount++;
      }
    }

    return {
      success: sentCount > 0,
      timestamp: now(),
      platformMessageId: generateId('wsmsg'),
    };
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  /** Get the port the server is listening on */
  getPort(): number {
    return this.port;
  }

  /** Get the number of connected clients */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Check if the adapter is connected */
  isConnected(): boolean {
    return this.connected;
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = generateId('client');
    const client: ClientInfo = { ws, id: clientId, alive: true };
    this.clients.set(clientId, client);

    ws.on('pong', () => {
      client.alive = true;
    });

    ws.on('message', (data: RawData) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('error', () => {
      this.clients.delete(clientId);
    });
  }

  private handleMessage(clientId: string, data: RawData): void {
    try {
      const payload = JSON.parse(data.toString());

      const message: InboundMessage = {
        id: generateId('imsg'),
        sender: payload.sender || clientId,
        channel: 'websocket' as any,
        content: payload.content || '',
        timestamp: payload.timestamp || now(),
        connectorId: this.id,
        raw: payload,
        replyTo: clientId,
      };

      for (const handler of this.messageHandlers) {
        handler(message).catch(() => {
          // Handler errors don't affect message processing
        });
      }
    } catch {
      // Invalid message format — silently ignore
    }
  }

  /** Why a connection is refused (token or origin checks), or undefined to accept it */
  private refuse(req: IncomingMessage, origin: string | undefined): { code: number; reason: string } | undefined {
    const { token, allowedOrigins } = this.config;
    let tokenOk = false;
    if (token) {
      const bearer = header(req, 'authorization');
      const fromQuery = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
      tokenOk = (bearer?.startsWith('Bearer ') && safeEqual(bearer.slice(7), token)) || (fromQuery !== null && safeEqual(fromQuery, token));
      if (!tokenOk) return { code: 401, reason: 'Unauthorized' };
    }
    // Browser connections: the origin must be listed, or (without a list) the client must have the token
    if (origin && (allowedOrigins ? !allowedOrigins.includes(origin) : !tokenOk)) {
      return { code: 403, reason: 'Origin not allowed' };
    }
    return undefined;
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (!client.alive) {
          // Client didn't respond to last ping — terminate
          client.ws.terminate();
          this.clients.delete(clientId);
          continue;
        }

        client.alive = false;
        client.ws.ping();
      }
    }, this.keepaliveIntervalMs);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
