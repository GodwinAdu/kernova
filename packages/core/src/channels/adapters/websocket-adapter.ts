/**
 * WebSocket Channel Adapter
 *
 * A WebSocket server-based channel adapter that accepts client connections,
 * manages them with ping/pong keepalive (30s interval), and routes messages
 * to registered handlers.
 *
 * Uses Node.js built-in WebSocket support (no external dependencies).
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { OutboundMessage, DeliveryReceipt, InboundMessage, SDKChannelAdapter } from '@kernova/types';
import { generateId, now } from '../../utils.js';

export interface WebSocketAdapterConfig {
  /** Port to listen on (default: 3200) */
  port?: number;

  /** Path for WebSocket connections (default: '/ws') */
  path?: string;

  /** Ping/pong keepalive interval in ms (default: 30000) */
  keepaliveIntervalMs?: number;

  /** Optional adapter ID override */
  id?: string;
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
      });

      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });

      this.httpServer.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
      });

      this.httpServer.listen(this.port, () => {
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

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
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
    for (const client of this.clients.values()) {
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
