/**
 * Telegram Channel Adapter
 *
 * Connects Kernova to Telegram via the Bot API using native fetch.
 * Supports both long-polling and webhook modes for receiving updates.
 */

import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, TelegramConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { BodyTooLargeError, ReplyTargets, header, readBody, safeEqual } from '../inbound.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';
/** Wait after a failed getUpdates before polling again */
const POLL_RETRY_MS = 5000;

export class TelegramAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'telegram';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private pollOffset = 0;
  private polling = false;
  private abortController?: AbortController;
  private webhookServer?: Server;
  private readonly targets = new ReplyTargets();
  /** Telegram sends this in X-Telegram-Bot-Api-Secret-Token with every webhook update */
  private webhookSecret?: string;

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

  /** Send to `recipient` (a chat ID, e.g. an inbound message's replyTo) */
  async send(message: OutboundMessage, recipient?: string): Promise<DeliveryReceipt> {
    const resolved = this.targets.resolve(recipient);
    if ('error' in resolved) {
      return { success: false, timestamp: now(), error: resolved.error };
    }
    const chatId = resolved.target;

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

    // Replies with unbalanced Markdown (a lone _ or *) are refused; send those as plain text
    const result = await this.apiCall<{ message_id: number }>('sendMessage', body)
      ?? await this.apiCall<{ message_id: number }>('sendMessage', { ...body, parse_mode: undefined });
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

      if (!this.polling) break;
      if (!updates) {
        // Network or API error: back off instead of retrying in a tight loop
        await new Promise((resolve) => setTimeout(resolve, POLL_RETRY_MS));
        continue;
      }

      for (const update of updates) {
        this.pollOffset = update.update_id + 1;
        this.processUpdate(update);
      }
    }
  }

  // ─── Webhook Mode ──────────────────────────────────────────

  private async startWebhook(): Promise<void> {
    const url = new URL(this.config.webhookUrl!);
    // Updates must carry this secret, so only Telegram can post to the webhook
    this.webhookSecret = this.config.secretToken ?? randomBytes(32).toString('hex');
    const registered = await this.apiCall('setWebhook', { url: this.config.webhookUrl, secret_token: this.webhookSecret });
    if (registered === null) throw new Error('Telegram: setWebhook failed');

    const port = this.config.webhookPort ?? (Number(url.port) || 443);

    this.webhookServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== url.pathname) {
        res.writeHead(404).end();
        return;
      }
      if (!safeEqual(header(req, 'x-telegram-bot-api-secret-token') ?? '', this.webhookSecret!)) {
        res.writeHead(401).end();
        return;
      }

      readBody(req).then((body) => {
        res.writeHead(200).end('OK');
        try {
          this.processUpdate(JSON.parse(body.toString()) as TelegramUpdate);
        } catch { /* ignore malformed payloads */ }
      }, (err) => {
        res.writeHead(err instanceof BodyTooLargeError ? 413 : 400).end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.webhookServer!.once('error', reject);
      this.webhookServer!.listen(port, () => resolve());
    });
  }

  // ─── Update Processing ─────────────────────────────────────

  private processUpdate(update: TelegramUpdate): void {
    const msg = update.message;
    if (!msg?.text) return;

    const sender = msg.from?.username || msg.from?.first_name || String(msg.from?.id ?? 'unknown');
    const chatId = String(msg.chat.id);
    this.targets.remember(chatId);

    this.messageHandler?.({
      sender,
      content: msg.text,
      timestamp: new Date(msg.date * 1000).toISOString(),
      raw: update,
      replyTo: chatId,
    });
  }

  // ─── Helpers ───────────────────────────────────────────────

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
