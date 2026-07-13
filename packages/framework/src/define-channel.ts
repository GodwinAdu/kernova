/**
 * defineChannel — Inbound/outbound messaging channels.
 *
 * Channels let agents receive messages from external systems
 * (Slack, email, webhooks, WebSocket) and respond.
 *
 * Usage:
 *   // channels/slack.ts
 *   import { defineChannel } from '@kernova/framework';
 *
 *   export default defineChannel({
 *     name: 'slack',
 *     type: 'slack',
 *     config: {
 *       token: process.env.SLACK_BOT_TOKEN!,
 *       signingSecret: process.env.SLACK_SIGNING_SECRET!,
 *     },
 *     onMessage: async (msg) => {
 *       // Route to agent or handle directly
 *       return { agent: 'support', input: msg.content };
 *     },
 *   });
 */

export type ChannelType = 'webhook' | 'websocket' | 'slack' | 'email' | 'telegram' | 'discord' | 'custom';

export interface ChannelMessage {
  id: string;
  channel: string;
  sender: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface ChannelDefinition {
  /** Channel name */
  name: string;
  /** Channel type */
  type: ChannelType;
  /** Channel-specific configuration */
  config?: Record<string, unknown>;
  /** Port for webhook/websocket channels */
  port?: number;
  /** Path for webhook channels */
  path?: string;
  /** Handler for incoming messages */
  onMessage?: (msg: ChannelMessage) => Promise<{ agent?: string; input: string } | void>;
  /** Whether this channel is enabled */
  enabled?: boolean;
}

/**
 * Define a messaging channel.
 */
export function defineChannel(definition: ChannelDefinition): ChannelDefinition {
  if (!definition.name) {
    throw new Error('defineChannel: "name" is required');
  }
  if (!definition.type) {
    throw new Error('defineChannel: "type" is required');
  }

  return {
    enabled: true,
    ...definition,
  };
}
