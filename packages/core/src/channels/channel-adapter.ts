/**
 * Kernova Channel Adapter Interface
 *
 * Defines the contract that all channel adapters must implement
 * to connect Nexus to external messaging platforms.
 */

import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, RawInboundMessage } from '@kernova/types';

export type MessageHandler = (msg: RawInboundMessage) => void;
export type StateChangeHandler = (state: ConnectionState) => void;

export interface ChannelAdapter {
  /** Channel type identifier */
  readonly channelType: ChannelType;

  /** Current connection state */
  readonly state: ConnectionState;

  /** Connect to the external platform */
  connect(): Promise<void>;

  /** Disconnect gracefully */
  disconnect(): Promise<void>;

  /** Send a message to the platform */
  send(message: OutboundMessage): Promise<DeliveryReceipt>;

  /** Register callback for inbound messages */
  onMessage(handler: MessageHandler): void;

  /** Register callback for connection state changes */
  onStateChange(handler: StateChangeHandler): void;
}
