/**
 * Microsoft Teams Channel Adapter
 *
 * Connects Kernova to Microsoft Teams via Bot Framework.
 * Uses native fetch for API calls and an HTTP server for the bot's messaging endpoint.
 * Every inbound activity must carry a valid Bot Framework token for this bot's app ID.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, TeamsConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';
import { BodyTooLargeError, BotFrameworkTokenVerifier, ReplyTargets, header, readBody } from '../inbound.js';

const BOT_FRAMEWORK_TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const BOT_FRAMEWORK_API = 'https://smba.trafficmanager.net/teams';
const DEFAULT_PORT = 3400;
/** Refresh the access token this long before it expires */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class TeamsAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'teams';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private server?: Server;
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  /** Conversation ID → the service URL Bot Framework gave for it (from verified activities only) */
  private readonly conversations = new ReplyTargets<string>();
  private readonly verifier: BotFrameworkTokenVerifier;

  constructor(private config: TeamsConfig & { port?: number }) {
    this.verifier = new BotFrameworkTokenVerifier({
      appId: config.appId,
      openIdMetadataUrl: config.openIdMetadataUrl,
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      await this.authenticate();
      await this.startWebhookServer();
      this.setState('connected');
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopWebhookServer();
    this.accessToken = undefined;
    this.accessTokenExpiresAt = 0;
    this.setState('disconnected');
  }

  /** Send to `recipient` (a conversation ID, e.g. an inbound message's replyTo) */
  async send(message: OutboundMessage, recipient?: string): Promise<DeliveryReceipt> {
    const resolved = this.conversations.resolve(recipient);
    if ('error' in resolved) {
      return { success: false, timestamp: now(), error: resolved.error };
    }
    const conversationId = resolved.target;
    const serviceUrl = (this.conversations.get(conversationId) ?? BOT_FRAMEWORK_API).replace(/\/$/, '');
    const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

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
      const token = await this.getAccessToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
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

  /** The access token for outbound calls, refreshed shortly before it expires (about hourly) */
  private async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() > this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      await this.authenticate();
    }
    return this.accessToken!;
  }

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

    const data = (await res.json()) as { access_token: string; expires_in?: number };
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  }

  // ─── Webhook Server ─────────────────────────────────────────

  private startWebhookServer(): Promise<void> {
    const port = this.config.port ?? DEFAULT_PORT;
    this.server = createServer((req, res) => void this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, () => resolve());
    });
  }

  private stopWebhookServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => { this.server = undefined; resolve(); });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }

    let activity: TeamsActivity;
    try {
      activity = JSON.parse((await readBody(req)).toString('utf-8')) as TeamsActivity;
    } catch (err) {
      res.writeHead(err instanceof BodyTooLargeError ? 413 : 400).end();
      return;
    }

    // Only Bot Framework can issue tokens for this bot; without this check anyone could post
    // activities, and a forged serviceUrl would receive the bot's access token on reply
    if (!(await this.verifier.verify(header(req, 'authorization'), activity))) {
      res.writeHead(401).end();
      return;
    }

    const conversationId = activity.conversation?.id;
    if (activity.type === 'message' && activity.text && conversationId) {
      if (activity.serviceUrl) this.conversations.remember(conversationId, activity.serviceUrl);
      this.messageHandler?.({
        sender: activity.from?.name ?? activity.from?.id ?? 'unknown',
        content: activity.text,
        timestamp: activity.timestamp ?? now(),
        raw: activity,
        replyTo: conversationId,
      });
    }

    res.writeHead(200).end();
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
  channelId?: string;
  from?: { id?: string; name?: string };
  conversation?: { id?: string };
}
