/**
 * Telegram Channel Adapter
 *
 * Connects Nexus to Telegram via the Bot API using native fetch.
 * Supports both long-polling and webhook modes for receiving updates.
 */

import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, TelegramConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export class TelegramAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'telegram';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private pollOffset = 0;
  private polling = false;
  private abortController?: AbortController;
  private webhookServer?: Server;
  private chatIds = new Map<string, number>();

  constructor(private config: TelegramConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    this.setState('connecting');

    const me = await this.apiCall<{ id: number; username: string }>('getMe');
    if (!me) {
      this.setState('disconnected');
      throw new Error('Telegram: invalid bot token — getMe failed');
    }

    if (this.config.webhookUrl) {
      await this.startWebhook();
    } else {
      this.startPolling();
    }

    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.polling = false;
    this.abortController?.abort();

    if (this.config.webhookUrl) {
      await this.apiCall('deleteWebhook');
      await new Promise<void>((resolve) => {
        this.webhookServer?.close(() => resolve());
        if (!this.webhookServer) resolve();
      });
      this.webhookServer = undefined;
    }

    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const chatId = this.getTargetChatId(message);
    if (!chatId) {
      return { success: false, timestamp: now(), error: 'No chat_id available for routing' };
    }

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: message.content,
      parse_mode: 'Markdown',
    };

    // Support inline keyboard from structured buttons
    if (message.structured?.buttons?.length) {
      body.reply_markup = {
        inline_keyboard: [
          message.structured.buttons.map((btn) => ({
            text: btn.label,
            callback_data: btn.action,
          })),
        ],
      };
    }

    const result = await this.apiCall<{ message_id: number }>('sendMessage', body);
    if (!result) {
      return { success: false, timestamp: now(), error: 'sendMessage failed' };
    }

    return {
      success: true,
      platformMessageId: String(result.message_id),
      timestamp: now(),
    };
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Telegram Bot API ───────────────────────────────────────

  private async apiCall<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await fetch(`${TELEGRAM_API}${this.config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : JSON.stringify({}),
        signal: method === 'getUpdates' ? this.abortController?.signal : undefined,
      });

      const data = await res.json() as { ok: boolean; result: T; description?: string };
      if (!data.ok) return null;
      return data.result;
    } catch {
      return null;
    }
  }

  // ─── Long-Polling ───────────────────────────────────────────

  private startPolling(): void {
    this.polling = true;
    this.abortController = new AbortController();
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      const updates = await this.apiCall<TelegramUpdate[]>('getUpdates', {
        offset: this.pollOffset,
        timeout: 30,
      });

      if (!updates || !this.polling) continue;

      for (const update of updates) {
        this.pollOffset = update.update_id + 1;
        this.processUpdate(update);
      }
    }
  }

  // ─── Webhook Mode ──────────────────────────────────────────

  private async startWebhook(): Promise<void> {
    await this.apiCall('setWebhook', { url: this.config.webhookUrl });

    const port = new URL(this.config.webhookUrl!).port || 443;

    this.webhookServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200).end('OK');
        try {
          const update = JSON.parse(Buffer.concat(chunks).toString()) as TelegramUpdate;
          this.processUpdate(update);
        } catch { /* ignore malformed payloads */ }
      });
    });

    await new Promise<void>((resolve) => {
      this.webhookServer!.listen(Number(port), () => resolve());
    });
  }

  // ─── Update Processing ─────────────────────────────────────

  private processUpdate(update: TelegramUpdate): void {
    const msg = update.message;
    if (!msg?.text) return;

    const sender = msg.from?.username || msg.from?.first_name || String(msg.from?.id ?? 'unknown');
    this.chatIds.set(sender, msg.chat.id);

    this.messageHandler?.({
      sender,
      content: msg.text,
      timestamp: new Date(msg.date * 1000).toISOString(),
      raw: update,
    });
  }

  // ─── Helpers ───────────────────────────────────────────────

  private getTargetChatId(message: OutboundMessage): number | undefined {
    // Use the most recently received chat_id, or look up by raw metadata
    const raw = (message as unknown as Record<string, unknown>).raw as { chat_id?: number } | undefined;
    if (raw?.chat_id) return raw.chat_id;

    // Fall back to most recent chat
    const entries = [...this.chatIds.values()];
    return entries.length > 0 ? entries[entries.length - 1] : undefined;
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}

// ─── Telegram API Types ──────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}
