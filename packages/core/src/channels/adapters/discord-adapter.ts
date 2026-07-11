/**
 * Discord Channel Adapter
 *
 * Connects Nexus to Discord via the Gateway WebSocket (for receiving)
 * and REST API (for sending). Handles heartbeat, identify, resume,
 * and automatic reconnection on unexpected disconnects.
 */

import WebSocket from 'ws';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, DiscordConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const DISCORD_API = 'https://discord.com/api/v10';
const GATEWAY_PARAMS = '?v=10&encoding=json';
const INTENTS = (1 << 9) | (1 << 15); // GUILD_MESSAGES | MESSAGE_CONTENT

/** Discord Gateway opcodes */
const enum GatewayOp {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  Resume = 6,
  Reconnect = 7,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatAck = 11,
}

/** Fatal close codes that should not trigger reconnection */
const FATAL_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export class DiscordAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'discord';

  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private lastChannelId: string | null = null;
  private shouldReconnect = false;

  constructor(private config: DiscordConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  // ─── Public API ───────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;

    this.shouldReconnect = true;
    this.setState('connecting');

    const gatewayUrl = await this.fetchGatewayUrl();
    this.openGateway(gatewayUrl);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.cleanup();
    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const channelId = this.lastChannelId;
    if (!channelId) {
      return { success: false, timestamp: now(), error: 'No channel ID available for routing' };
    }

    const body: Record<string, unknown> = { content: message.content };

    if (message.structured?.embeds?.length) {
      body.embeds = message.structured.embeds.map(e => ({
        title: e.title,
        description: e.description,
        color: e.color ? parseInt(e.color.replace('#', ''), 16) : undefined,
        fields: e.fields,
      }));
    }

    try {
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        return { success: false, timestamp: now(), error: `Discord API ${res.status}: ${errBody}` };
      }

      const data = (await res.json()) as { id: string };
      return { success: true, platformMessageId: data.id, timestamp: now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Gateway Connection ───────────────────────────────────────

  private async fetchGatewayUrl(): Promise<string> {
    const res = await fetch(`${DISCORD_API}/gateway`);
    if (!res.ok) throw new Error(`Failed to fetch gateway URL: ${res.status}`);
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  private openGateway(url: string): void {
    this.ws = new WebSocket(`${url}${GATEWAY_PARAMS}`);

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;
        this.handleGatewayMessage(payload);
      } catch {
        // Malformed payload — ignore
      }
    });

    this.ws.on('close', (code: number) => {
      this.clearHeartbeat();

      if (FATAL_CODES.has(code)) {
        this.setState('disconnected');
        return;
      }

      if (this.shouldReconnect) {
        this.setState('reconnecting');
        setTimeout(() => this.attemptReconnect(), 3000);
      } else {
        this.setState('disconnected');
      }
    });

    this.ws.on('error', () => {
      // Error events are followed by close — handled there
    });
  }

  private handleGatewayMessage(payload: GatewayPayload): void {
    if (payload.s !== null && payload.s !== undefined) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case GatewayOp.Hello:
        this.startHeartbeat(payload.d.heartbeat_interval);
        this.identify();
        break;

      case GatewayOp.HeartbeatAck:
        // Connection is healthy
        break;

      case GatewayOp.Dispatch:
        this.handleDispatch(payload.t!, payload.d);
        break;

      case GatewayOp.Reconnect:
        this.ws?.close(4000);
        break;

      case GatewayOp.InvalidSession:
        // If d is true, we can resume; otherwise start fresh
        this.sessionId = payload.d ? this.sessionId : null;
        setTimeout(() => {
          this.ws?.close(4000);
        }, 1000 + Math.random() * 4000);
        break;
    }
  }

  private handleDispatch(eventName: string, data: any): void {
    if (eventName === 'READY') {
      this.sessionId = data.session_id;
      this.resumeGatewayUrl = data.resume_gateway_url;
      this.setState('connected');
      return;
    }

    if (eventName === 'RESUMED') {
      this.setState('connected');
      return;
    }

    if (eventName === 'MESSAGE_CREATE') {
      // Skip bot messages to avoid loops
      if (data.author?.bot) return;

      this.lastChannelId = data.channel_id;

      this.messageHandler?.({
        sender: data.author?.username ?? 'unknown',
        content: data.content ?? '',
        timestamp: data.timestamp ?? new Date().toISOString(),
        raw: data,
      });
    }
  }

  // ─── Heartbeat ────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    // Send first heartbeat after jitter to avoid thundering herd
    setTimeout(() => this.sendHeartbeat(), Math.random() * intervalMs);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), intervalMs);
  }

  private sendHeartbeat(): void {
    this.wsSend({ op: GatewayOp.Heartbeat, d: this.lastSequence });
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Identify / Resume ────────────────────────────────────────

  private identify(): void {
    if (this.sessionId) {
      this.wsSend({
        op: GatewayOp.Resume,
        d: {
          token: this.config.botToken,
          session_id: this.sessionId,
          seq: this.lastSequence,
        },
      });
    } else {
      this.wsSend({
        op: GatewayOp.Identify,
        d: {
          token: this.config.botToken,
          intents: INTENTS,
          properties: { os: 'linux', browser: 'kernova', device: 'kernova' },
        },
      });
    }
  }

  // ─── Reconnection ────────────────────────────────────────────

  private attemptReconnect(): void {
    const url = this.resumeGatewayUrl ?? 'wss://gateway.discord.gg';
    this.openGateway(url);
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private wsSend(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private cleanup(): void {
    this.clearHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Normal closure');
      }
      this.ws = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.stateHandler?.(state);
  }
}

// ─── Internal Types ─────────────────────────────────────────────

interface GatewayPayload {
  op: number;
  d: any;
  s?: number | null;
  t?: string | null;
}
