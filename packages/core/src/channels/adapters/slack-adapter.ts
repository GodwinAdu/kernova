/**
 * Slack Channel Adapter
 *
 * Connects Kernova to Slack via the Web API and Events API.
 * Uses native fetch for API calls and an HTTP server for incoming webhooks.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, SlackConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';
import { BodyTooLargeError, ReplyTargets, readBody } from '../inbound.js';

const SLACK_API = 'https://slack.com/api';
const DEFAULT_PORT = 3300;
const TIMESTAMP_MAX_AGE_SEC = 300; // 5 minutes

export class SlackAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'slack';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private server?: Server;
  private readonly targets = new ReplyTargets();

  constructor(private config: SlackConfig & { port?: number; defaultChannel?: string }) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    this.setState('connecting');

    try {
      const res = await fetch(`${SLACK_API}/auth.test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.botToken}` },
      });

      const data = (await res.json()) as { ok: boolean; error?: string };

      if (!data.ok) {
        this.setState('failed');
        throw new Error(`Slack auth.test failed: ${data.error ?? 'unknown error'}`);
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

  /** Post to `recipient` (a channel ID, e.g. an inbound message's replyTo), else defaultChannel */
  async send(message: OutboundMessage, recipient?: string): Promise<DeliveryReceipt> {
    const resolved = this.targets.resolve(recipient, this.config.defaultChannel);
    if ('error' in resolved) {
      return { success: false, timestamp: now(), error: resolved.error };
    }
    const channel = resolved.target;

    const body: Record<string, unknown> = { channel, text: message.content };

    // Support structured blocks passed as an array
    if (Array.isArray(message.structured)) {
      body.blocks = message.structured;
    }

    try {
      const res = await fetch(`${SLACK_API}/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };

      if (!data.ok) {
        return { success: false, timestamp: now(), error: data.error ?? 'chat.postMessage failed' };
      }

      return { success: true, platformMessageId: data.ts, timestamp: now() };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown send error';
      return { success: false, timestamp: now(), error: errMsg };
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
    const port = this.config.port ?? DEFAULT_PORT;

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port, () => {
      console.log(`[SlackAdapter] Webhook server listening on port ${port}`);
    });
  }

  private stopWebhookServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = undefined;
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    readBody(req).then((body) => {
      const rawBody = body.toString('utf-8');
      const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
      const signature = req.headers['x-slack-signature'] as string | undefined;

      // Reject stale requests
      if (timestamp && Math.abs(Date.now() / 1000 - Number(timestamp)) > TIMESTAMP_MAX_AGE_SEC) {
        res.writeHead(403).end('Request too old');
        return;
      }

      // Verify signature
      if (!timestamp || !signature || !verifySlackSignature(this.config.signingSecret, timestamp, rawBody, signature)) {
        res.writeHead(401).end('Invalid signature');
        return;
      }

      let payload: SlackEventPayload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        res.writeHead(400).end('Invalid JSON');
        return;
      }

      // URL verification challenge
      if (payload.type === 'url_verification') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: payload.challenge }));
        return;
      }

      // Process event callbacks
      if (payload.type === 'event_callback' && payload.event?.type === 'message') {
        const event = payload.event;

        // Ignore bot messages to avoid loops
        if (event.bot_id || event.subtype) {
          res.writeHead(200).end();
          return;
        }

        if (event.channel) this.targets.remember(event.channel);

        this.messageHandler?.({
          sender: event.user ?? 'unknown',
          content: event.text ?? '',
          // Slack's ts is "<seconds>.<sequence>"
          timestamp: event.ts ? new Date(Number(event.ts) * 1000).toISOString() : now(),
          raw: payload,
          ...(event.channel && { replyTo: event.channel }),
        });
      }

      res.writeHead(200).end();
    }, (err) => {
      res.writeHead(err instanceof BodyTooLargeError ? 413 : 400).end();
    });
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}

// ─── Signature Verification ───────────────────────────────────

export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const basestring = `v0:${timestamp}:${body}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(basestring).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf-8'), Buffer.from(signature, 'utf-8'));
  } catch {
    return false;
  }
}

// ─── Internal Types ───────────────────────────────────────────

interface SlackEventPayload {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    user?: string;
    text?: string;
    ts?: string;
    channel?: string;
    bot_id?: string;
    subtype?: string;
  };
}
