/**
 * Microsoft Teams Channel Adapter
 *
 * Connects Kernova to Microsoft Teams via Bot Framework.
 * Uses native fetch for API calls and an HTTP server for webhook callbacks.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, TeamsConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const BOT_FRAMEWORK_TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const BOT_FRAMEWORK_API = 'https://smba.trafficmanager.net/teams';
const DEFAULT_PORT = 3400;

export class TeamsAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'teams';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private server?: Server;
  private accessToken?: string;
  private lastServiceUrl?: string;
  private lastConversationId?: string;

  constructor(private config: TeamsConfig & { port?: number }) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      await this.authenticate();
      this.startWebhookServer();
      this.setState('connected');
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopWebhookServer();
    this.accessToken = undefined;
    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    if (!this.accessToken || !this.lastConversationId) {
      return { success: false, timestamp: now(), error: 'No conversation context available' };
    }

    const serviceUrl = this.lastServiceUrl ?? BOT_FRAMEWORK_API;
    const url = `${serviceUrl}/v3/conversations/${this.lastConversationId}/activities`;

    const body: Record<string, unknown> = {
      type: 'message',
      text: message.content,
    };

    // Support adaptive cards via structured content
    if (message.structured) {
      body.attachments = [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: message.structured,
      }];
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, timestamp: now(), error: `Teams API error: ${res.status} ${errText}` };
      }

      const data = (await res.json()) as { id?: string };
      return { success: true, platformMessageId: data.id, timestamp: now() };
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

  // ─── Auth ───────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.appId,
      client_secret: this.config.appPassword,
      scope: 'https://api.botframework.com/.default',
    });

    const res = await fetch(BOT_FRAMEWORK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new Error(`Teams auth failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
  }

  // ─── Webhook Server ─────────────────────────────────────────

  private startWebhookServer(): void {
    const port = this.config.port ?? DEFAULT_PORT;
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
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as TeamsActivity;

        if (body.type === 'message' && body.text) {
          this.lastServiceUrl = body.serviceUrl;
          this.lastConversationId = body.conversation?.id;

          this.messageHandler?.({
            sender: body.from?.name ?? body.from?.id ?? 'unknown',
            content: body.text,
            timestamp: body.timestamp ?? now(),
            raw: body,
          });
        }

        res.writeHead(200).end();
      } catch {
        res.writeHead(400).end('Invalid JSON');
      }
    });
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}

interface TeamsActivity {
  type: string;
  text?: string;
  timestamp?: string;
  serviceUrl?: string;
  from?: { id?: string; name?: string };
  conversation?: { id?: string };
}
