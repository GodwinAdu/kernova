/**
 * WhatsApp Channel Adapter
 *
 * Connects Kernova to WhatsApp Business via the Meta Cloud API.
 * Uses an HTTP webhook server for inbound messages and native fetch for outbound.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, WhatsAppConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';
import { BodyTooLargeError, ReplyTargets, header, readBody, safeEqual, verifyHmacSha256 } from '../inbound.js';

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const DEFAULT_WEBHOOK_PORT = 3400;

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'whatsapp';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private server?: Server;
  private readonly targets = new ReplyTargets();

  constructor(private config: WhatsAppConfig & { webhookPort?: number }) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    this.setState('connecting');

    // Verify access token by fetching phone number info
    const verifyUrl = `${GRAPH_API_BASE}/${this.config.phoneNumberId}`;
    const res = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });

    if (!res.ok) {
      this.setState('disconnected');
      const body = await res.text();
      throw new Error(`WhatsApp token verification failed (${res.status}): ${body}`);
    }

    // Start webhook server
    await this.startWebhookServer();
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = undefined;
    }
    this.setState('disconnected');
  }

  /** Send to `to` (a WhatsApp number, e.g. an inbound message's replyTo) */
  async send(message: OutboundMessage, to?: string): Promise<DeliveryReceipt> {
    const resolved = this.targets.resolve(to);
    if ('error' in resolved) {
      return { success: false, timestamp: now(), error: resolved.error };
    }
    const recipient = resolved.target;

    const url = `${GRAPH_API_BASE}/${this.config.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: message.content },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, timestamp: now(), error: `Send failed (${res.status}): ${body}` };
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    return {
      success: true,
      platformMessageId: data.messages?.[0]?.id,
      timestamp: now(),
    };
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Private ────────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }

  private startWebhookServer(): Promise<void> {
    const port = this.config.webhookPort ?? DEFAULT_WEBHOOK_PORT;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.once('error', reject);
      this.server.listen(port, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET') {
      this.handleVerification(req, res);
    } else if (req.method === 'POST') {
      this.handleIncomingMessage(req, res);
    } else {
      res.writeHead(405).end();
    }
  }

  private handleVerification(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '', `http://localhost`);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token !== null && safeEqual(token, this.config.verifyToken)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge ?? '');
    } else {
      res.writeHead(403).end();
    }
  }

  private handleIncomingMessage(req: IncomingMessage, res: ServerResponse): void {
    // Meta signs every webhook POST with the app secret (X-Hub-Signature-256); without the
    // secret there's no way to tell real messages from forged ones, so none are accepted
    if (!this.config.appSecret) {
      res.writeHead(403).end('Set appSecret to receive WhatsApp messages');
      return;
    }

    readBody(req).then((raw) => {
      if (!verifyHmacSha256(this.config.appSecret!, raw, header(req, 'x-hub-signature-256'))) {
        res.writeHead(401).end();
        return;
      }

      // Respond immediately per WhatsApp webhook requirements
      res.writeHead(200).end();

      try {
        const body = JSON.parse(raw.toString());
        const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message || message.type !== 'text') return;

        const sender: string = message.from;
        const content: string = message.text?.body ?? '';
        const timestamp: string = message.timestamp
          ? new Date(Number(message.timestamp) * 1000).toISOString()
          : now();

        this.targets.remember(sender);

        this.messageHandler?.({
          sender,
          content,
          timestamp,
          raw: body,
          replyTo: sender,
        });
      } catch {
        // Malformed payload — already responded 200, nothing more to do
      }
    }, (err) => {
      res.writeHead(err instanceof BodyTooLargeError ? 413 : 400).end();
    });
  }
}
