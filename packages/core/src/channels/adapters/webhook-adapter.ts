/**
 * Webhook Channel Adapter
 *
 * An HTTP POST-based channel adapter that starts an HTTP server
 * on a configurable port and path, receiving inbound messages as
 * POST requests and emitting them to registered handlers.
 *
 * With a `secret`, each request must carry the hex HMAC-SHA256 of its raw body in
 * `x-kernova-signature` (or "sha256=<hex>"). Without one, the server only listens on 127.0.0.1.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { OutboundMessage, DeliveryReceipt, InboundMessage, SDKChannelAdapter } from '@kernova/types';
import { generateId, now } from '../../utils.js';
import { BodyTooLargeError, header, readBody, verifyHmacSha256 } from '../inbound.js';

export interface WebhookAdapterConfig {
  /** Port to listen on (default: 3100) */
  port?: number;

  /** Path to listen for POST requests (default: '/webhook') */
  path?: string;

  /** Optional adapter ID override */
  id?: string;

  /** Shared secret: requests must be signed with HMAC-SHA256 of the raw body (recommended) */
  secret?: string;

  /** Header carrying the signature (default: 'x-kernova-signature') */
  signatureHeader?: string;

  /**
   * Interface to listen on. Default: all interfaces when `secret` is set, otherwise 127.0.0.1
   * (unsigned requests are only accepted from this machine unless you set a host explicitly).
   */
  host?: string;
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
        void this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
      });

      const host = this.config.host ?? (this.config.secret ? undefined : '127.0.0.1');
      this.server.listen(this.port, host, () => {
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

  async send(_message: OutboundMessage, _recipient?: string): Promise<DeliveryReceipt> {
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: Record<string, unknown>) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // Only handle POST requests to the configured path
    const pathname = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || pathname !== this.path) {
      reply(404, { error: 'Not found' });
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      reply(err instanceof BodyTooLargeError ? 413 : 400, { error: (err as Error).message });
      return;
    }

    if (this.config.secret) {
      const signature = header(req, this.config.signatureHeader ?? 'x-kernova-signature');
      if (!verifyHmacSha256(this.config.secret, body, signature)) {
        reply(401, { error: 'Invalid signature' });
        return;
      }
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      reply(400, { error: 'Invalid JSON body' });
      return;
    }

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
    reply(200, { received: true, messageId: message.id });

    // Dispatch to handlers asynchronously
    for (const handler of this.messageHandlers) {
      handler(message).catch(() => {
        // Handler errors don't affect message receipt
      });
    }
  }
}
