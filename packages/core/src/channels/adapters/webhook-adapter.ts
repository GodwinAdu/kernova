/**
 * Webhook Channel Adapter
 *
 * An HTTP POST-based channel adapter that starts an HTTP server
 * on a configurable port and path, receiving inbound messages as
 * POST requests and emitting them to registered handlers.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { OutboundMessage, DeliveryReceipt, InboundMessage, SDKChannelAdapter } from '@kernova/types';
import { generateId, now } from '../../utils.js';

export interface WebhookAdapterConfig {
  /** Port to listen on (default: 3100) */
  port?: number;

  /** Path to listen for POST requests (default: '/webhook') */
  path?: string;

  /** Optional adapter ID override */
  id?: string;
}

export class WebhookChannelAdapter implements SDKChannelAdapter {
  readonly id: string;
  readonly type = 'webhook';

  private server: Server | null = null;
  private messageHandlers: Array<(message: InboundMessage) => Promise<void>> = [];
  private port: number;
  private path: string;
  private connected = false;

  constructor(private config: WebhookAdapterConfig = {}) {
    this.id = config.id || generateId('webhook');
    this.port = config.port ?? 3100;
    this.path = config.path ?? '/webhook';
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        this.connected = true;
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.server) return;

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.connected = false;
        this.server = null;
        resolve();
      });
    });
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    // Webhook adapter is primarily a receiver.
    // Send is a no-op that acknowledges delivery (could be extended for outbound webhooks).
    return {
      success: true,
      timestamp: now(),
      platformMessageId: generateId('wmsg'),
    };
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  /** Get the port the server is listening on */
  getPort(): number {
    return this.port;
  }

  /** Get the path the server is listening on */
  getPath(): string {
    return this.path;
  }

  /** Check if the adapter is connected */
  isConnected(): boolean {
    return this.connected;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only handle POST requests to the configured path
    if (req.method !== 'POST' || req.url !== this.path) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        const message: InboundMessage = {
          id: generateId('imsg'),
          sender: payload.sender || 'unknown',
          channel: 'webhook' as any,
          content: payload.content || '',
          timestamp: payload.timestamp || now(),
          connectorId: this.id,
          raw: payload,
        };

        // Respond immediately with 200
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, messageId: message.id }));

        // Dispatch to handlers asynchronously
        for (const handler of this.messageHandlers) {
          handler(message).catch(() => {
            // Handler errors don't affect message receipt
          });
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
  }
}
