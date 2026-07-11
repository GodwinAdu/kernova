/**
 * SMS Channel Adapter (Twilio)
 *
 * Connects Kernova to SMS via Twilio's REST API.
 * Uses native fetch for API calls and an HTTP server for inbound webhook.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, SmsConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const DEFAULT_PORT = 3500;

export class SmsAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'sms';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private server?: Server;
  private lastSenderNumber?: string;

  constructor(private config: SmsConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      // Verify credentials by fetching account info
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}.json`,
        { headers: { Authorization: this.basicAuth() } },
      );

      if (!res.ok) {
        throw new Error(`Twilio auth failed: ${res.status}`);
      }

      this.startWebhookServer();
      this.setState('connected');
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopWebhookServer();
    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const to = this.lastSenderNumber;
    if (!to) {
      return { success: false, timestamp: now(), error: 'No recipient number available' };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      From: this.config.fromNumber,
      To: to,
      Body: message.content,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.basicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, timestamp: now(), error: `Twilio error: ${res.status} ${errText}` };
      }

      const data = (await res.json()) as { sid?: string };
      return { success: true, platformMessageId: data.sid, timestamp: now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown send error';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Webhook Server ─────────────────────────────────────────

  private startWebhookServer(): void {
    const port = this.config.webhookPort ?? DEFAULT_PORT;
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port);
  }

  private stopWebhookServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => { this.server = undefined; resolve(); });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        const params = new URLSearchParams(rawBody);

        const from = params.get('From');
        const body = params.get('Body');

        if (from && body) {
          this.lastSenderNumber = from;
          this.messageHandler?.({
            sender: from,
            content: body,
            timestamp: now(),
            raw: Object.fromEntries(params.entries()),
          });
        }

        // Respond with empty TwiML to acknowledge
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<Response></Response>');
      } catch {
        res.writeHead(400).end();
      }
    });
  }

  private basicAuth(): string {
    const credentials = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    return `Basic ${credentials}`;
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}
