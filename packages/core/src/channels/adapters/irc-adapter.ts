/**
 * IRC Channel Adapter
 *
 * Connects Kernova to IRC servers via TCP/TLS.
 * Handles NICK, USER, JOIN, PRIVMSG, and PING/PONG.
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, IrcConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';

const CRLF = '\r\n';

export class IrcAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'irc';
  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private socket?: net.Socket | tls.TLSSocket;
  private buffer = '';
  private lastChannel?: string;
  private lastSender?: string;

  constructor(private config: IrcConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      this.socket = await this.openConnection();
      this.setupListeners();

      // Send registration commands
      if (this.config.password) {
        this.raw(`PASS ${this.config.password}`);
      }
      this.raw(`NICK ${this.config.nick}`);
      this.raw(`USER ${this.config.nick} 0 * :Kernova Bot`);

      // Wait briefly for welcome, then join channels
      await this.delay(2000);
      for (const channel of this.config.channels) {
        this.raw(`JOIN ${channel}`);
      }

      this.setState('connected');
    } catch (err) {
      this.setState('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.raw('QUIT :Kernova disconnecting');
      await this.delay(500);
      this.socket.destroy();
      this.socket = undefined;
    }
    this.setState('disconnected');
  }

  async send(message: OutboundMessage): Promise<DeliveryReceipt> {
    const target = this.lastChannel ?? this.config.channels[0];
    if (!target || !this.socket) {
      return { success: false, timestamp: now(), error: 'No IRC channel or socket available' };
    }

    try {
      // IRC messages are limited to ~512 bytes; split long messages
      const lines = message.content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.raw(`PRIVMSG ${target} :${line}`);
        }
      }
      return { success: true, timestamp: now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'IRC send failed';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── Connection ─────────────────────────────────────────────

  private openConnection(): Promise<net.Socket | tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const opts = { host: this.config.server, port: this.config.port };

      const socket = this.config.useTls
        ? tls.connect({ ...opts, rejectUnauthorized: false }, () => resolve(socket))
        : net.createConnection(opts, () => resolve(socket));

      socket.once('error', reject);
      socket.setTimeout(15_000, () => {
        socket.destroy();
        reject(new Error('IRC connection timeout'));
      });
    });
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      const lines = this.buffer.split(CRLF);
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim()) this.handleLine(line);
      }
    });

    this.socket.on('close', () => {
      if (this._state === 'connected') {
        this.setState('disconnected');
      }
    });

    this.socket.on('error', () => {
      this.setState('failed');
    });
  }

  private handleLine(line: string): void {
    // Handle PING/PONG keepalive
    if (line.startsWith('PING')) {
      const token = line.substring(5);
      this.raw(`PONG ${token}`);
      return;
    }

    // Parse PRIVMSG: :nick!user@host PRIVMSG #channel :message
    const privmsgMatch = line.match(/^:([^!]+)![^\s]+ PRIVMSG ([^\s]+) :(.+)$/);
    if (privmsgMatch) {
      const [, sender, channel, content] = privmsgMatch;
      if (sender === this.config.nick) return; // Ignore own messages

      this.lastChannel = channel;
      this.lastSender = sender;
      this.messageHandler?.({
        sender,
        content,
        timestamp: now(),
        raw: { line, channel },
      });
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private raw(command: string): void {
    this.socket?.write(command + CRLF);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.stateHandler?.(state);
  }
}
