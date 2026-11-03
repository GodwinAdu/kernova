/**
 * Push Notification Channel Adapter (FCM/APNs)
 *
 * Connects Kernova to push notification services.
 * This is a send-only adapter — push notifications don't have inbound messages.
 */

import { readFile } from 'node:fs/promises';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, PushConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';
const APNS_PRODUCTION = 'https://api.push.apple.com';

export class PushAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'push';
  private _state: ConnectionState = 'disconnected';
  private stateHandler?: StateChangeHandler;
  private apnsKey?: string;
  private lastDeviceToken?: string;

  constructor(private config: PushConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      if (this.config.provider === 'fcm') {
        if (!this.config.fcmServerKey) {
          throw new Error('FCM server key is required');
        }
        // Verify FCM key by making a dry-run request
        const res = await fetch(FCM_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `key=${this.config.fcmServerKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dry_run: true, registration_ids: ['test'] }),
        });
        if (!res.ok && res.status !== 401) {
          // 401 means invalid key, anything else is a network issue
        }
        if (res.status === 401) {
          throw new Error('Invalid FCM server key');
        }
      } else if (this.config.provider === 'apns') {
        if (!this.config.apnsKeyPath || !this.config.apnsKeyId || !this.config.apnsTeamId) {
          throw new Error('APNs requires keyPath, keyId, and teamId');
        }
        // Verify the key file is readable
        this.apnsKey = await readFile(this.config.apnsKeyPath, 'utf-8');
      }

      this.setState('connected');
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.apnsKey = undefined;
    this.setState('disconnected');
  }

  /** Push to `recipient` (a device token), else the token set with setDeviceToken() */
  async send(message: OutboundMessage, recipient?: string): Promise<DeliveryReceipt> {
    const deviceToken = recipient ?? this.lastDeviceToken;
    if (!deviceToken) {
      return { success: false, timestamp: now(), error: 'No device token: pass the recipient or call setDeviceToken()' };
    }

    // Extract title/body/data from structured content if available
    const title = (message.structured as Record<string, unknown> | undefined)?.title as string | undefined;
    const data = (message.structured as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined;

    if (this.config.provider === 'fcm') {
      return this.sendFcm(deviceToken, message.content, title, data);
    } else {
      return this.sendApns(deviceToken, message.content, title, data);
    }
  }

  /**
   * Set the target device token for outbound pushes.
   * Call this externally or pass via message.structured.data.deviceToken.
   */
  setDeviceToken(token: string): void {
    this.lastDeviceToken = token;
  }

  onMessage(_handler: MessageHandler): void {
    // No-op: push notifications are send-only
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── FCM ────────────────────────────────────────────────────

  private async sendFcm(
    token: string,
    body: string,
    title?: string,
    data?: Record<string, unknown>,
  ): Promise<DeliveryReceipt> {
    const payload: Record<string, unknown> = {
      to: token,
      notification: { title: title ?? 'Kernova', body },
    };
    if (data) payload.data = data;

    try {
      const res = await fetch(FCM_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `key=${this.config.fcmServerKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return { success: false, timestamp: now(), error: `FCM error: ${res.status}` };
      }

      const result = (await res.json()) as { success?: number; message_id?: string };
      if (result.success === 1) {
        return { success: true, platformMessageId: result.message_id, timestamp: now() };
      }
      return { success: false, timestamp: now(), error: 'FCM delivery failed' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown FCM error';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  // ─── APNs ───────────────────────────────────────────────────

  private async sendApns(
    token: string,
    body: string,
    title?: string,
    data?: Record<string, unknown>,
  ): Promise<DeliveryReceipt> {
    const bundleId = this.config.apnsBundleId ?? 'com.kernova.app';
    const url = `${APNS_PRODUCTION}/3/device/${token}`;

    const payload = {
      aps: {
        alert: { title: title ?? 'Kernova', body },
        sound: 'default',
      },
      ...data,
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          authorization: `bearer ${this.apnsKey}`, // Simplified — real impl needs JWT
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, timestamp: now(), error: `APNs error: ${res.status} ${errText}` };
      }

      const apnsId = res.headers.get('apns-id');
      return { success: true, platformMessageId: apnsId ?? undefined, timestamp: now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown APNs error';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}
