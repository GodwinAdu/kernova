/**
 * Matrix Channel Adapter
 *
 * Connects Kernova to Matrix homeservers via the Client-Server API.
 * Uses long-polling /sync for receiving messages.
 */

import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, MatrixConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const SYNC_TIMEOUT = 30_000;

export class MatrixAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'matrix';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private syncToken?: string;
  private syncing = false;
  private txnCounter = 0;
  private lastRoomId?: string;
  private lastSender?: string;

  constructor(private config: MatrixConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      // Verify access token via whoami
      const res = await this.matrixFetch('GET', '/_matrix/client/v3/account/whoami');
      if (!res.ok) {
        throw new Error(`Matrix auth failed: ${res.status}`);
      }

      // Join configured rooms
      if (this.config.roomIds?.length) {
        for (const roomId of this.config.roomIds) {
          await this.matrixFetch('POST', `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {});
        }
      }

      this.setState('connected');
      this.startSync();
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.syncing = false;
    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const roomId = this.lastRoomId ?? this.config.roomIds?.[0];
    if (!roomId) {
      return { success: false, timestamp: now(), error: 'No target room available' };
    }

    const txnId = `kernova_${Date.now()}_${this.txnCounter++}`;
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`;

    const body: Record<string, unknown> = {
      msgtype: 'm.text',
      body: message.content,
    };

    // Support formatted messages via structured content
    if (message.structured) {
      body.format = 'org.matrix.custom.html';
      body.formatted_body = message.content;
    }

    try {
      const res = await this.matrixFetch('PUT', path, body);
      if (!res.ok) {
        const errText = await res.text();
        return { success: false, timestamp: now(), error: `Matrix error: ${res.status} ${errText}` };
      }

      const data = (await res.json()) as { event_id?: string };
      return { success: true, platformMessageId: data.event_id, timestamp: now() };
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

  // ─── Sync Loop ──────────────────────────────────────────────

  private startSync(): void {
    this.syncing = true;
    this.syncLoop();
  }

  private async syncLoop(): Promise<void> {
    while (this.syncing) {
      try {
        const params = new URLSearchParams({ timeout: String(SYNC_TIMEOUT) });
        if (this.syncToken) params.set('since', this.syncToken);

        const res = await this.matrixFetch('GET', `/_matrix/client/v3/sync?${params.toString()}`);
        if (!res.ok) {
          // Back off on error
          await this.delay(5000);
          continue;
        }

        const data = (await res.json()) as MatrixSyncResponse;
        this.syncToken = data.next_batch;

        // Process room events
        const rooms = data.rooms?.join;
        if (rooms) {
          for (const [roomId, room] of Object.entries(rooms)) {
            for (const event of room.timeline?.events ?? []) {
              if (
                event.type === 'm.room.message' &&
                event.sender !== this.config.userId &&
                event.content?.body
              ) {
                this.lastRoomId = roomId;
                this.lastSender = event.sender;
                this.messageHandler?.({
                  sender: event.sender,
                  content: event.content.body,
                  timestamp: event.origin_server_ts
                    ? new Date(event.origin_server_ts).toISOString()
                    : now(),
                  raw: event,
                });
              }
            }
          }
        }
      } catch {
        // Non-fatal sync error — retry after delay
        await this.delay(5000);
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private matrixFetch(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.config.homeserverUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(url, opts);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}

interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, {
      timeline?: {
        events?: Array<{
          type: string;
          sender: string;
          origin_server_ts?: number;
          content?: { body?: string; msgtype?: string };
        }>;
      };
    }>;
  };
}
