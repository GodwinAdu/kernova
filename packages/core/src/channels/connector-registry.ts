/**
 * Kernova Connector Registry
 *
 * Manages channel connectors: registration, connection lifecycle,
 * inbound message normalization, outbound routing, and reconnection.
 */

import type {
  NexusId,
  NexusEvent,
  ChannelType,
  ConnectionState,
  ChannelConfig,
  ConnectorDef,
  ConnectorInput,
  ConnectorStatus,
  InboundMessage,
  OutboundMessage,
  OutboundMessageRequest,
  OutboundMessageResult,
  RawInboundMessage,
  SlackConfig,
  DiscordConfig,
  WhatsAppConfig,
  TelegramConfig,
  EmailConfig,
  TeamsConfig,
  SmsConfig,
  SignalConfig,
  MatrixConfig,
  IrcConfig,
  VoiceConfig,
  PushConfig,
  RssConfig,
} from '@kernova/types';
import type { ChannelAdapter } from './channel-adapter.js';
import type { EventBus } from '../events/event-bus.js';
import { ConnectorError } from '../errors.js';
import { generateId, now } from '../utils.js';
import { SlackAdapter } from './adapters/slack-adapter.js';
import { DiscordAdapter } from './adapters/discord-adapter.js';
import { WhatsAppAdapter } from './adapters/whatsapp-adapter.js';
import { TelegramAdapter } from './adapters/telegram-adapter.js';
import { EmailAdapter } from './adapters/email-adapter.js';
import { TeamsAdapter } from './adapters/teams-adapter.js';
import { SmsAdapter } from './adapters/sms-adapter.js';
import { SignalAdapter } from './adapters/signal-adapter.js';
import { MatrixAdapter } from './adapters/matrix-adapter.js';
import { IrcAdapter } from './adapters/irc-adapter.js';
import { VoiceAdapter } from './adapters/voice-adapter.js';
import { PushAdapter } from './adapters/push-adapter.js';
import { RssAdapter } from './adapters/rss-adapter.js';

export interface ConnectorRegistryConfig {
  dataDir: string;
  deliveryTimeout?: number; // default: 30_000 ms
  onInboundMessage?: (message: InboundMessage) => Promise<void>;
}

const DEFAULT_DELIVERY_TIMEOUT = 30_000;
const RECONNECT_INITIAL_DELAY = 1000;
const RECONNECT_MAX_DELAY = 60_000;

export class ConnectorRegistry {
  private definitions: Map<NexusId, ConnectorDef> = new Map();
  private adapters: Map<NexusId, ChannelAdapter> = new Map();
  private reconnectTimers: Map<NexusId, ReturnType<typeof setTimeout>> = new Map();
  private reconnectDelays: Map<NexusId, number> = new Map();
  private explicitDisconnects: Set<NexusId> = new Set();
  private running = false;

  private readonly deliveryTimeout: number;
  private readonly onInboundMessage?: (message: InboundMessage) => Promise<void>;

  constructor(
    private eventBus: EventBus,
    private config: ConnectorRegistryConfig,
  ) {
    this.deliveryTimeout = config.deliveryTimeout ?? DEFAULT_DELIVERY_TIMEOUT;
    this.onInboundMessage = config.onInboundMessage;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;

    // Clear all reconnection timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.reconnectDelays.clear();

    // Disconnect all connected adapters
    const disconnectPromises: Promise<void>[] = [];
    for (const [id, adapter] of this.adapters) {
      if (adapter.state === 'connected' || adapter.state === 'connecting' || adapter.state === 'reconnecting') {
        disconnectPromises.push(this.disconnectAdapter(id, adapter));
      }
    }
    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Register a new connector with config validation.
   */
  register(input: ConnectorInput): ConnectorDef {
    this.validateConfig(input.channelType, input.config);

    const adapter = this.createAdapter(input.channelType, input.config);
    const id = generateId('conn');
    const timestamp = now();

    const def: ConnectorDef = {
      id,
      channelType: input.channelType,
      name: input.name,
      state: 'disconnected',
      config: input.config,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.definitions.set(id, def);
    this.adapters.set(id, adapter);

    // Register inbound message handler
    adapter.onMessage((raw: RawInboundMessage) => {
      this.handleInboundMessage(id, input.channelType, raw);
    });

    // Register state change handler
    adapter.onStateChange((state: ConnectionState) => {
      this.handleStateChange(id, state);
    });

    return def;
  }

  /**
   * Connect a registered connector.
   */
  async connect(connectorId: NexusId): Promise<void> {
    const adapter = this.adapters.get(connectorId);
    const def = this.definitions.get(connectorId);
    if (!adapter || !def) {
      throw new ConnectorError(connectorId, 'Connector not found');
    }

    this.explicitDisconnects.delete(connectorId);

    try {
      await adapter.connect();
      def.state = 'connected';
      def.updatedAt = now();
      this.resetReconnect(connectorId);
      this.emitEvent('channel.connected', connectorId, def.channelType, {
        name: def.name,
      });
    } catch (error) {
      def.state = 'failed';
      def.updatedAt = now();
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.emitEvent('channel.connection.failed', connectorId, def.channelType, {
        name: def.name,
        reason,
      });
      this.scheduleReconnect(connectorId);
    }
  }

  /**
   * Disconnect a registered connector.
   */
  async disconnect(connectorId: NexusId): Promise<void> {
    const adapter = this.adapters.get(connectorId);
    const def = this.definitions.get(connectorId);
    if (!adapter || !def) {
      throw new ConnectorError(connectorId, 'Connector not found');
    }

    this.explicitDisconnects.add(connectorId);
    this.cancelReconnect(connectorId);

    await adapter.disconnect();
    def.state = 'disconnected';
    def.updatedAt = now();
    this.emitEvent('channel.disconnected', connectorId, def.channelType, {
      name: def.name,
    });
  }

  /**
   * Send a message through a connector.
   */
  async send(request: OutboundMessageRequest): Promise<OutboundMessageResult> {
    const { connectorId, message } = request;

    const adapter = this.adapters.get(connectorId);
    const def = this.definitions.get(connectorId);
    if (!adapter || !def) {
      throw new ConnectorError(connectorId, 'Connector not found');
    }

    if (adapter.state !== 'connected') {
      throw new ConnectorError(connectorId, 'Connector is not connected');
    }

    const messageId = generateId('msg');

    try {
      const receipt = await this.sendWithTimeout(adapter, message);

      if (receipt.success) {
        this.emitEvent('channel.message.sent', connectorId, def.channelType, {
          messageId,
          recipient: request.recipient,
        });
        return {
          messageId,
          connectorId,
          deliveredAt: receipt.timestamp,
          status: 'sent',
        };
      }

      // Send failed without timeout — check for structured content degradation
      throw new Error(receipt.error || 'Send failed');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';

      // Check if this is a timeout
      if (reason === 'DELIVERY_TIMEOUT') {
        this.emitEvent('channel.message.failed', connectorId, def.channelType, {
          messageId,
          reason: 'Delivery timeout exceeded',
          timeout: this.deliveryTimeout,
        });
        return {
          messageId,
          connectorId,
          status: 'failed',
        };
      }

      // Attempt structured content degradation if message has structured content
      if (message.structured) {
        try {
          const textOnlyMessage: OutboundMessage = { content: message.content };
          const fallbackReceipt = await this.sendWithTimeout(adapter, textOnlyMessage);

          if (fallbackReceipt.success) {
            this.emitEvent('channel.message.partial', connectorId, def.channelType, {
              messageId,
              reason: 'Structured content degraded to text-only',
            });
            return {
              messageId,
              connectorId,
              deliveredAt: fallbackReceipt.timestamp,
              status: 'partial',
            };
          }
        } catch {
          // Fallback also failed, fall through to failure
        }
      }

      this.emitEvent('channel.message.failed', connectorId, def.channelType, {
        messageId,
        reason,
      });
      return {
        messageId,
        connectorId,
        status: 'failed',
      };
    }
  }

  /**
   * Get status of all registered connectors.
   */
  status(): ConnectorStatus[] {
    const statuses: ConnectorStatus[] = [];
    for (const def of this.definitions.values()) {
      statuses.push({
        id: def.id,
        channelType: def.channelType,
        name: def.name,
        state: def.state,
      });
    }
    return statuses;
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private validateConfig(channelType: ChannelType, config: ChannelConfig): void {
    switch (channelType) {
      case 'slack': {
        const c = config as SlackConfig;
        if (!c.botToken || !c.signingSecret) {
          throw new ConnectorError('', 'Slack config requires botToken and signingSecret');
        }
        break;
      }
      case 'discord': {
        const c = config as DiscordConfig;
        if (!c.botToken || !c.applicationId) {
          throw new ConnectorError('', 'Discord config requires botToken and applicationId');
        }
        break;
      }
      case 'whatsapp': {
        const c = config as WhatsAppConfig;
        if (!c.accessToken || !c.phoneNumberId || !c.verifyToken) {
          throw new ConnectorError('', 'WhatsApp config requires accessToken, phoneNumberId, and verifyToken');
        }
        break;
      }
      case 'telegram': {
        const c = config as TelegramConfig;
        if (!c.botToken) {
          throw new ConnectorError('', 'Telegram config requires botToken');
        }
        break;
      }
      case 'email': {
        const c = config as EmailConfig;
        if (!c.smtpHost || !c.smtpPort || !c.imapHost || !c.imapPort || !c.username || !c.password) {
          throw new ConnectorError('', 'Email config requires smtpHost, smtpPort, imapHost, imapPort, username, and password');
        }
        break;
      }
      case 'teams': {
        const c = config as TeamsConfig;
        if (!c.appId || !c.appPassword) {
          throw new ConnectorError('', 'Teams config requires appId and appPassword');
        }
        break;
      }
      case 'sms': {
        const c = config as SmsConfig;
        if (!c.accountSid || !c.authToken || !c.fromNumber) {
          throw new ConnectorError('', 'SMS config requires accountSid, authToken, and fromNumber');
        }
        break;
      }
      case 'signal': {
        const c = config as SignalConfig;
        if (!c.signalCliPath || !c.phoneNumber) {
          throw new ConnectorError('', 'Signal config requires signalCliPath and phoneNumber');
        }
        break;
      }
      case 'matrix': {
        const c = config as MatrixConfig;
        if (!c.homeserverUrl || !c.accessToken || !c.userId) {
          throw new ConnectorError('', 'Matrix config requires homeserverUrl, accessToken, and userId');
        }
        break;
      }
      case 'irc': {
        const c = config as IrcConfig;
        if (!c.server || !c.port || !c.nick || !c.channels?.length) {
          throw new ConnectorError('', 'IRC config requires server, port, nick, and at least one channel');
        }
        break;
      }
      case 'voice': {
        const c = config as VoiceConfig;
        if (!c.accountSid || !c.authToken || !c.fromNumber) {
          throw new ConnectorError('', 'Voice config requires accountSid, authToken, and fromNumber');
        }
        break;
      }
      case 'push': {
        const c = config as PushConfig;
        if (!c.provider) {
          throw new ConnectorError('', 'Push config requires provider (fcm or apns)');
        }
        if (c.provider === 'fcm' && !c.fcmServerKey) {
          throw new ConnectorError('', 'FCM push config requires fcmServerKey');
        }
        if (c.provider === 'apns' && (!c.apnsKeyPath || !c.apnsKeyId || !c.apnsTeamId)) {
          throw new ConnectorError('', 'APNs push config requires apnsKeyPath, apnsKeyId, and apnsTeamId');
        }
        break;
      }
      case 'rss': {
        const c = config as RssConfig;
        if (!c.feeds?.length) {
          throw new ConnectorError('', 'RSS config requires at least one feed');
        }
        break;
      }
      default:
        throw new ConnectorError('', `Unsupported channel type: ${channelType}`);
    }
  }

  private createAdapter(channelType: ChannelType, config: ChannelConfig): ChannelAdapter {
    switch (channelType) {
      case 'slack':
        return new SlackAdapter(config as SlackConfig);
      case 'discord':
        return new DiscordAdapter(config as DiscordConfig);
      case 'whatsapp':
        return new WhatsAppAdapter(config as WhatsAppConfig);
      case 'telegram':
        return new TelegramAdapter(config as TelegramConfig);
      case 'email':
        return new EmailAdapter(config as EmailConfig);
      case 'teams':
        return new TeamsAdapter(config as TeamsConfig);
      case 'sms':
        return new SmsAdapter(config as SmsConfig);
      case 'signal':
        return new SignalAdapter(config as SignalConfig);
      case 'matrix':
        return new MatrixAdapter(config as MatrixConfig);
      case 'irc':
        return new IrcAdapter(config as IrcConfig);
      case 'voice':
        return new VoiceAdapter(config as VoiceConfig);
      case 'push':
        return new PushAdapter(config as PushConfig);
      case 'rss':
        return new RssAdapter(config as RssConfig);
      default:
        throw new ConnectorError('', `Unsupported channel type: ${channelType}`);
    }
  }

  private handleInboundMessage(connectorId: NexusId, channelType: ChannelType, raw: RawInboundMessage): void {
    // Validate inbound message
    if (!raw.sender || raw.sender.length > 256) {
      this.emitEvent('channel.message.invalid', connectorId, channelType, {
        reason: 'Invalid sender: must be non-empty and ≤256 characters',
      });
      return;
    }

    if (!raw.content || raw.content.length > 32_000) {
      this.emitEvent('channel.message.invalid', connectorId, channelType, {
        reason: 'Invalid content: must be non-empty and ≤32000 characters',
      });
      return;
    }

    if (!raw.timestamp || !this.isValidTimestamp(raw.timestamp)) {
      this.emitEvent('channel.message.invalid', connectorId, channelType, {
        reason: 'Invalid timestamp',
      });
      return;
    }

    // Normalize to InboundMessage
    const message: InboundMessage = {
      id: generateId('imsg'),
      sender: raw.sender,
      channel: channelType,
      content: raw.content,
      timestamp: raw.timestamp,
      connectorId,
      raw: raw.raw,
    };

    this.emitEvent('channel.message.received', connectorId, channelType, {
      messageId: message.id,
      sender: message.sender,
    });

    // Submit to intent callback if provided
    if (this.onInboundMessage) {
      this.onInboundMessage(message).catch(() => {
        // Intent submission failure is logged but does not affect message flow
      });
    }
  }

  private handleStateChange(connectorId: NexusId, state: ConnectionState): void {
    const def = this.definitions.get(connectorId);
    if (def) {
      def.state = state;
      def.updatedAt = now();
    }
  }

  private isValidTimestamp(timestamp: string): boolean {
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  }

  private async sendWithTimeout(adapter: ChannelAdapter, message: OutboundMessage): Promise<{ success: boolean; timestamp: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('DELIVERY_TIMEOUT'));
      }, this.deliveryTimeout);

      adapter.send(message)
        .then(receipt => {
          clearTimeout(timer);
          resolve({
            success: receipt.success,
            timestamp: receipt.timestamp,
            error: receipt.error,
          });
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private scheduleReconnect(connectorId: NexusId): void {
    if (!this.running) return;
    if (this.explicitDisconnects.has(connectorId)) return;

    const currentDelay = this.reconnectDelays.get(connectorId) ?? RECONNECT_INITIAL_DELAY;

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(connectorId);
      if (!this.running || this.explicitDisconnects.has(connectorId)) return;

      const adapter = this.adapters.get(connectorId);
      const def = this.definitions.get(connectorId);
      if (!adapter || !def) return;

      def.state = 'reconnecting';
      def.updatedAt = now();

      try {
        await adapter.connect();
        def.state = 'connected';
        def.updatedAt = now();
        this.resetReconnect(connectorId);
        this.emitEvent('channel.connected', connectorId, def.channelType, {
          name: def.name,
          reconnected: true,
        });
      } catch {
        def.state = 'failed';
        def.updatedAt = now();
        // Exponential backoff: double delay, cap at max
        const nextDelay = Math.min(currentDelay * 2, RECONNECT_MAX_DELAY);
        this.reconnectDelays.set(connectorId, nextDelay);
        this.scheduleReconnect(connectorId);
      }
    }, currentDelay);

    this.reconnectTimers.set(connectorId, timer);
  }

  private resetReconnect(connectorId: NexusId): void {
    this.reconnectDelays.delete(connectorId);
    this.cancelReconnect(connectorId);
  }

  private cancelReconnect(connectorId: NexusId): void {
    const timer = this.reconnectTimers.get(connectorId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(connectorId);
    }
  }

  private async disconnectAdapter(id: NexusId, adapter: ChannelAdapter): Promise<void> {
    try {
      await adapter.disconnect();
    } catch {
      // Best-effort disconnect during stop
    }
  }

  private emitEvent(
    eventType: string,
    connectorId: NexusId,
    channelType: ChannelType,
    data: Record<string, unknown>,
  ): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('failed') || eventType.includes('invalid') ? 'warn' : 'info',
      timestamp: now(),
      subjectId: connectorId,
      subjectType: 'connector',
      actorId: 'system',
      correlationId: connectorId,
      data: { ...data, channelType },
      metadata: {
        schemaVersion: '1.0.0',
        source: 'connector-registry',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
