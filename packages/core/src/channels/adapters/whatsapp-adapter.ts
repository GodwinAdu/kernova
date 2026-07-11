/**
 * WhatsApp Channel Adapter
 *
 * Connects Nexus to WhatsApp Business via the Meta Cloud API.
 * Uses an HTTP webhook server for inbound messages and native fetch for outbound.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, WhatsAppConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const DEFAULT_WEBHOOK_PORT = 3400;

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'whatsapp';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private server?: Server;
  private lastSender?: string;

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

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const recipient = this.lastSender;
    if (!recipient) {
      return { success: false, timestamp: now(), error: 'No recipient — no inbound message received yet' };
    }

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

    if (mode === 'subscribe' && token === this.config.verifyToken) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge ?? '');
    } else {
      res.writeHead(403).end();
    }
  }

  private handleIncomingMessage(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      // Respond immediately per WhatsApp webhook requirements
      res.writeHead(200).end();

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message || message.type !== 'text') return;

        const sender: string = message.from;
        const content: string = message.text?.body ?? '';
        const timestamp: string = message.timestamp
          ? new Date(Number(message.timestamp) * 1000).toISOString()
          : now();

        this.lastSender = sender;

        this.messageHandler?.({
          sender,
          content,
          timestamp,
          raw: body,
        });
      } catch {
        // Malformed payload — already responded 200, nothing more to do
      }
    });
  }
}
