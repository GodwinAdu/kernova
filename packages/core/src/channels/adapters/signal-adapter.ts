/**
 * Signal Channel Adapter (via signal-cli)
 *
 * Connects Kernova to Signal by shelling out to the signal-cli binary.
 * Polls for incoming messages at a configurable interval.
 */

import { exec } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, SignalConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const DEFAULT_POLL_INTERVAL = 5000;

export class SignalAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'signal';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSender?: string;

  constructor(private config: SignalConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      // Verify signal-cli binary is accessible
      await access(this.config.signalCliPath, constants.X_OK);

      // Verify it runs (version check)
      await this.execSignalCli('--version');

      this.setState('connected');

      // Start polling for incoming messages
      const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
      this.pollTimer = setInterval(() => this.pollMessages(), interval);
      this.pollMessages(); // first poll immediately
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const recipient = this.lastSender;
    if (!recipient) {
      return { success: false, timestamp: now(), error: 'No recipient available' };
    }

    try {
      const escapedContent = message.content.replace(/"/g, '\\"');
      await this.execSignalCli(
        `-u ${this.config.phoneNumber} send -m "${escapedContent}" ${recipient}`
      );
      return { success: true, timestamp: now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'signal-cli send failed';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Polling ────────────────────────────────────────────────

  private async pollMessages(): Promise<void> {
    try {
      const output = await this.execSignalCli(
        `-u ${this.config.phoneNumber} receive --json`
      );

      if (!output.trim()) return;

      // signal-cli outputs one JSON object per line
      const lines = output.trim().split('\n');
      for (const line of lines) {
        try {
          const envelope = JSON.parse(line) as SignalEnvelope;
          const dataMsg = envelope.envelope?.dataMessage;
          const sender = envelope.envelope?.source;

          if (dataMsg?.message && sender) {
            this.lastSender = sender;
            this.messageHandler?.({
              sender,
              content: dataMsg.message,
              timestamp: dataMsg.timestamp
                ? new Date(dataMsg.timestamp).toISOString()
                : now(),
              raw: envelope,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Non-fatal polling error — continue at next interval
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private execSignalCli(args: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(`${this.config.signalCliPath} ${args}`, { timeout: 30_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}

interface SignalEnvelope {
  envelope?: {
    source?: string;
    timestamp?: number;
    dataMessage?: {
      message?: string;
      timestamp?: number;
    };
  };
}
