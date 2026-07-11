/**
 * Kernova Autonomy Types
 *
 * Type definitions for the five autonomy modules:
 * Scheduler, BackgroundLoop, TaskQueue, ProactiveTriggerEngine, ConnectorRegistry
 */

import type { NexusId, Timestamp, Priority } from './base.js';
import type { IntentType } from './intent.js';
import type { NexusEvent } from './event.js';

// ─── Scheduler ───────────────────────────────────────────────

export interface ScheduledJob {
  id: NexusId;
  name: string;
  cronExpression: string;
  delayMs?: number;                // One-shot delay in ms
  oneShot?: boolean;               // Auto-disable after first execution
  target: ScheduleTarget;
  enabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastExecutionAt?: Timestamp;
  nextExecutionAt?: Timestamp;
}

export interface ScheduledJobInput {
  name: string;                    // max 128 chars
  cronExpression?: string;         // 5-field cron (mutually exclusive with delayMs for one-shot)
  delayMs?: number;                // One-shot delay in ms (used when oneShot is true)
  oneShot?: boolean;               // Auto-disable after first execution
  target: ScheduleTarget;
}

export interface ScheduleTarget {
  type: 'intent' | 'agent';
  id?: NexusId;                    // agent ID if type is 'agent'
  goal: string;                    // intent goal
  metadata?: Record<string, unknown>;
}

// ─── Background Loop ─────────────────────────────────────────

export interface BackgroundLoopDef {
  id: NexusId;
  name: string;
  intervalMs: number;              // 1000–86_400_000
  state: LoopState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type LoopState = 'active' | 'paused' | 'removed';

export type MonitorFunction = (context: unknown | null) => Promise<unknown | null | undefined> | unknown | null | undefined;

export interface BackgroundLoopInput {
  id?: NexusId;                    // optional caller-provided ID
  name: string;
  intervalMs: number;
  monitor: MonitorFunction;
  target?: ScheduleTarget;         // intent template for actions
}

// ─── Task Queue ──────────────────────────────────────────────

export interface TaskItem {
  id: NexusId;
  priority: Priority;
  status: QueueTaskStatus;
  payload: unknown;
  handler: string;                 // handler name for routing
  attempt: number;
  maxRetries: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  scheduledAt?: Timestamp;         // for retry backoff delay
}

export type QueueTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead-lettered';

export interface TaskItemInput {
  priority?: Priority;
  payload: unknown;
  handler: string;
  maxRetries?: number;
}

export interface QueueStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  deadLettered: number;
}

export interface DeadLetterItem {
  id: NexusId;
  taskId: NexusId;
  payload: unknown;
  handler: string;
  errorMessage: string;
  errorType: string;
  attempts: DeadLetterAttempt[];
  deadLetteredAt: Timestamp;
  status: 'active' | 'replayed';
}

export interface DeadLetterAttempt {
  attempt: number;
  executedAt: Timestamp;
  errorMessage: string;
}

export interface DeadLetterFilter {
  after?: Timestamp;
  before?: Timestamp;
  errorType?: string;
}

// ─── Proactive Triggers ──────────────────────────────────────

export type TriggerCondition = (event: NexusEvent) => boolean;

export interface TriggerRule {
  id: NexusId;
  name: string;
  eventPattern: string;            // EventBus wildcard pattern, max 256 chars
  condition?: string;              // serialized condition description
  action: TriggerActionDef;
  enabled: boolean;
  cooldownMs: number;              // min 100, default 1000
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastFiredAt?: Timestamp;
}

export interface TriggerRuleInput {
  name: string;
  eventPattern: string;
  condition?: TriggerCondition;    // runtime function (not serialized)
  conditionDescription?: string;   // human-readable, persisted
  action: TriggerActionDef;
  cooldownMs?: number;
  enabled?: boolean;               // default true
}

export interface TriggerActionDef {
  goal: string;
  intentType?: IntentType;
  priority?: Priority;
  cooldownMs?: number;
  metadata?: Record<string, unknown>;
}

// ─── Channel Connectors ──────────────────────────────────────

export type ChannelType = 'slack' | 'discord' | 'whatsapp' | 'telegram' | 'email' | 'teams' | 'sms' | 'signal' | 'matrix' | 'irc' | 'voice' | 'push' | 'rss';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ConnectorDef {
  id: NexusId;
  channelType: ChannelType;
  name: string;
  state: ConnectionState;
  config: ChannelConfig;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConnectorInput {
  channelType: ChannelType;
  name: string;
  config: ChannelConfig;
}

export type ChannelConfig =
  | SlackConfig
  | DiscordConfig
  | WhatsAppConfig
  | TelegramConfig
  | EmailConfig
  | TeamsConfig
  | SmsConfig
  | SignalConfig
  | MatrixConfig
  | IrcConfig
  | VoiceConfig
  | PushConfig
  | RssConfig;

export interface SlackConfig {
  type: 'slack';
  botToken: string;
  signingSecret: string;
  appId?: string;
}

export interface DiscordConfig {
  type: 'discord';
  botToken: string;
  applicationId: string;
}

export interface WhatsAppConfig {
  type: 'whatsapp';
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
}

export interface TelegramConfig {
  type: 'telegram';
  botToken: string;
  webhookUrl?: string;
}

export interface EmailConfig {
  type: 'email';
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  username: string;
  password: string;
  useTls?: boolean;
  pollIntervalMs?: number;   // IMAP poll interval (default: 60000)
  defaultRecipient?: string; // Default reply-to address
}

export interface TeamsConfig {
  type: 'teams';
  appId: string;
  appPassword: string;
  tenantId?: string;
}

export interface SmsConfig {
  type: 'sms';
  accountSid: string;       // Twilio Account SID
  authToken: string;        // Twilio Auth Token
  fromNumber: string;       // Twilio phone number (e.g., +1234567890)
  webhookPort?: number;     // Port for receiving incoming SMS (default: 3500)
}

export interface SignalConfig {
  type: 'signal';
  signalCliPath: string;    // Path to signal-cli binary
  phoneNumber: string;      // Registered Signal phone number
  pollIntervalMs?: number;  // Poll interval for incoming messages (default: 5000)
}

export interface MatrixConfig {
  type: 'matrix';
  homeserverUrl: string;    // e.g., https://matrix.org
  accessToken: string;      // Bot access token
  userId: string;           // e.g., @bot:matrix.org
  roomIds?: string[];       // Rooms to join and listen in
}

export interface IrcConfig {
  type: 'irc';
  server: string;           // IRC server hostname
  port: number;             // Default: 6667 (plain) or 6697 (TLS)
  nick: string;             // Bot nickname
  channels: string[];       // Channels to join (e.g., ['#kernova', '#support'])
  password?: string;        // Server/NickServ password
  useTls?: boolean;
}

export interface VoiceConfig {
  type: 'voice';
  accountSid: string;       // Twilio Account SID
  authToken: string;        // Twilio Auth Token
  fromNumber: string;       // Twilio phone number
  webhookPort?: number;     // Port for TwiML webhooks (default: 3600)
  ttsVoice?: string;        // Text-to-speech voice (default: 'alice')
}

export interface PushConfig {
  type: 'push';
  provider: 'fcm' | 'apns';
  fcmServerKey?: string;    // Firebase Cloud Messaging server key
  apnsKeyPath?: string;     // Path to APNs .p8 key file
  apnsKeyId?: string;
  apnsTeamId?: string;
  apnsBundleId?: string;
}

export interface RssConfig {
  type: 'rss';
  feeds: Array<{ url: string; name: string }>;
  pollIntervalMs?: number;  // How often to check feeds (default: 300000 = 5 min)
}

export interface ConnectorStatus {
  id: NexusId;
  channelType: ChannelType;
  name: string;
  state: ConnectionState;
}

export interface InboundMessage {
  id: NexusId;
  sender: string;              // max 256 chars
  channel: ChannelType;
  content: string;             // max 32_000 chars
  timestamp: Timestamp;
  connectorId: NexusId;
  raw?: unknown;               // original platform payload
}

export interface OutboundMessage {
  content: string;
  structured?: StructuredContent;
}

export interface StructuredContent {
  attachments?: Attachment[];
  buttons?: Button[];
  embeds?: Embed[];
}

export interface Attachment {
  type: 'file' | 'image' | 'video';
  url: string;
  name?: string;
}

export interface Button {
  label: string;
  action: string;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface Embed {
  title?: string;
  description?: string;
  color?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface OutboundMessageRequest {
  connectorId: NexusId;
  recipient?: string;
  message: OutboundMessage;
}

export interface OutboundMessageResult {
  messageId: NexusId;
  connectorId: NexusId;
  deliveredAt?: Timestamp;
  status: 'sent' | 'failed' | 'partial';
}

export interface DeliveryReceipt {
  success: boolean;
  platformMessageId?: string;
  timestamp: Timestamp;
  error?: string;
}

export interface RawInboundMessage {
  sender: string;
  content: string;
  timestamp: string;
  raw?: unknown;
}

// ─── Agent Config File Schema ─────────────────────────────────

/**
 * Declarative agent configuration file schema.
 * Supports `.agent.yaml`, `.agent.yml`, and `.agent.json` files.
 */
export interface AgentConfigFile {
  /** Agent name (required) */
  name: string;

  /** Human-readable description */
  description?: string;

  /** System instructions for the agent (required) */
  instructions: string;

  /** Model identifier to use (e.g., 'gpt-4o') */
  model?: string;

  /** List of tool IDs the agent can use */
  tools?: string[];

  /** Scheduled jobs for this agent */
  schedules?: AgentConfigSchedule[];

  /** Event-driven triggers for this agent */
  triggers?: AgentConfigTrigger[];

  /** Path to a base config file to inherit from */
  extends?: string;
}

export interface AgentConfigSchedule {
  /** Schedule name */
  name: string;

  /** 5-field cron expression (mutually exclusive with delayMs) */
  cron?: string;

  /** One-shot delay in milliseconds */
  delayMs?: number;

  /** Goal/intent to submit when the schedule fires */
  goal: string;
}

export interface AgentConfigTrigger {
  /** Trigger name */
  name: string;

  /** Event pattern to match (glob-style) */
  event: string;

  /** Optional condition expression */
  condition?: string;

  /** Goal/intent to submit when the trigger fires */
  goal: string;
}

// ─── SDK Channel Adapter Interface ───────────────────────────

/**
 * SDK-level ChannelAdapter interface.
 * Defines the contract for adapters that can be registered via `app.channel(name, adapter)`.
 * This is a simplified, SDK-facing abstraction compared to the internal core ChannelAdapter.
 */
export interface SDKChannelAdapter {
  /** Unique adapter identifier */
  readonly id: string;

  /** Adapter type (e.g., 'webhook', 'websocket', 'slack') */
  readonly type: string;

  /** Connect the adapter (start listening) */
  connect(): Promise<void>;

  /** Disconnect the adapter (stop listening, clean up) */
  disconnect(): Promise<void>;

  /** Send a message through the adapter */
  send(message: OutboundMessage): Promise<DeliveryReceipt>;

  /** Register a handler for inbound messages */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}
