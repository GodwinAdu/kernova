/**
 * Email Channel Adapter
 *
 * Connects Kernova to email via raw SMTP (sending) and IMAP (receiving).
 * Uses Node.js native net/tls modules — no external dependencies.
 *
 * NOTE: This is a minimal implementation for basic email connectivity.
 * Production deployments should use a proper library like nodemailer/imapflow.
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import type { ChannelType, ConnectionState, OutboundMessage, DeliveryReceipt, EmailConfig } from '@kernova/types';
import type { ChannelAdapter, MessageHandler, StateChangeHandler } from '../channel-adapter.js';
import { now } from '../../utils.js';
import { ReplyTargets } from '../inbound.js';

const CRLF = '\r\n';
const DEFAULT_POLL_INTERVAL = 60_000;

export class EmailAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'email';

  private _state: ConnectionState = 'disconnected';
  private messageHandler?: MessageHandler;
  private stateHandler?: StateChangeHandler;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly targets = new ReplyTargets();

  constructor(private config: EmailConfig) {}

  get state(): ConnectionState {
    return this._state;
  }

  // ─── Public API ───────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState('connecting');

    try {
      // Verify SMTP connectivity with an EHLO handshake
      await this.smtpHandshake();
      this.setState('connected');

      // Start IMAP polling loop for inbound messages
      const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
      this.pollTimer = setInterval(() => this.pollImap(), interval);

      // Run first poll immediately
      this.pollImap();
    } catch (err) {
      this.setState('disconnected');
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

  /** Send to `to` (an address, e.g. an inbound message's replyTo), else defaultRecipient */
  async send(message: OutboundMessage, to?: string): Promise<DeliveryReceipt> {
    const resolved = this.targets.resolve(to, this.config.defaultRecipient);
    if ('error' in resolved) {
      return { success: false, timestamp: now(), error: resolved.error };
    }
    const recipient = resolved.target;
    // A plain address only: anything else could inject SMTP commands or headers
    if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(recipient)) {
      return { success: false, timestamp: now(), error: `Invalid recipient address: ${recipient}` };
    }

    try {
      await this.smtpSend(recipient, message.content);
      return { success: true, timestamp: now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SMTP send failed';
      return { success: false, timestamp: now(), error: msg };
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandler = handler;
  }

  // ─── SMTP Client ─────────────────────────────────────────────

  /** Quick EHLO to verify SMTP connectivity */
  private async smtpHandshake(): Promise<void> {
    const socket = await this.openSmtpConnection();
    try {
      await this.smtpReadLine(socket, 220);
      await this.smtpCommand(socket, `EHLO kernova`, 250);
      await this.smtpCommand(socket, 'QUIT', 221);
    } finally {
      socket.destroy();
    }
  }

  /** Send an email over SMTP */
  private async smtpSend(to: string, body: string): Promise<void> {
    const socket = await this.openSmtpConnection();
    try {
      await this.smtpReadLine(socket, 220);
      await this.smtpCommand(socket, `EHLO kernova`, 250);

      // STARTTLS upgrade if configured and not already using TLS
      if (this.config.useTls && !('encrypted' in socket)) {
        await this.smtpCommand(socket, 'STARTTLS', 220);
        // After STARTTLS, upgrade handled by initial TLS connect — skip for simplicity
      }

      // AUTH LOGIN
      await this.smtpCommand(socket, 'AUTH LOGIN', 334);
      await this.smtpCommand(socket, Buffer.from(this.config.username).toString('base64'), 334);
      await this.smtpCommand(socket, Buffer.from(this.config.password).toString('base64'), 235);

      // Envelope
      await this.smtpCommand(socket, `MAIL FROM:<${this.config.username}>`, 250);
      await this.smtpCommand(socket, `RCPT TO:<${to}>`, 250);
      await this.smtpCommand(socket, 'DATA', 354);

      // Message body (RFC 5321/5322): CRLF line endings, and lines starting with "." doubled
      // so the text can't end the message early and inject SMTP commands
      const safeBody = body
        .replace(/\r\n|\r|\n/g, CRLF)
        .split(CRLF)
        .map(line => (line.startsWith('.') ? `.${line}` : line))
        .join(CRLF);
      const emailContent = [
        `From: ${this.config.username}`,
        `To: ${to}`,
        `Subject: Kernova Message`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=UTF-8`,
        '',
        safeBody,
        '.',
      ].join(CRLF);

      await this.smtpCommand(socket, emailContent, 250);
      await this.smtpCommand(socket, 'QUIT', 221);
    } finally {
      socket.destroy();
    }
  }

  /** Open a TCP/TLS connection to the SMTP server */
  private openSmtpConnection(): Promise<net.Socket | tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const opts = { host: this.config.smtpHost, port: this.config.smtpPort };

      const socket = this.config.useTls
        ? tls.connect({ ...opts, rejectUnauthorized: false }, () => resolve(socket))
        : net.createConnection(opts, () => resolve(socket));

      socket.once('error', reject);
      socket.setTimeout(10_000, () => {
        socket.destroy();
        reject(new Error('SMTP connection timeout'));
      });
    });
  }

  /** Send a command and wait for the expected status code */
  private smtpCommand(socket: net.Socket, cmd: string, expectedCode: number): Promise<string> {
    return new Promise((resolve, reject) => {
      socket.write(cmd + CRLF, () => {
        this.smtpReadLine(socket, expectedCode).then(resolve).catch(reject);
      });
    });
  }

  /** Read a line from SMTP and validate the status code */
  private smtpReadLine(socket: net.Socket, expectedCode: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        // SMTP responses can be multiline (code-SP... or code-DASH...)
        // We wait for a final line matching "code SP"
        const lines = buffer.split(CRLF);
        for (const line of lines) {
          if (line.length >= 3 && line[3] === ' ') {
            cleanup();
            const code = parseInt(line.substring(0, 3), 10);
            if (code === expectedCode) {
              resolve(buffer);
            } else {
              reject(new Error(`SMTP unexpected response: ${buffer.trim()}`));
            }
            return;
          }
        }
      };

      const onError = (err: Error) => { cleanup(); reject(err); };
      const cleanup = () => {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
      };

      socket.on('data', onData);
      socket.once('error', onError);
    });
  }

  // ─── IMAP Client ─────────────────────────────────────────────

  /** Poll IMAP for unseen messages */
  private async pollImap(): Promise<void> {
    let socket: net.Socket | tls.TLSSocket | null = null;
    try {
      socket = await this.openImapConnection();
      let tag = 0;
      const nextTag = () => `A${++tag}`;

      // Wait for server greeting
      await this.imapReadResponse(socket, '*');

      // LOGIN
      await this.imapCommand(socket, nextTag(), `LOGIN ${this.config.username} ${this.config.password}`);

      // SELECT INBOX
      await this.imapCommand(socket, nextTag(), 'SELECT INBOX');

      // SEARCH UNSEEN
      const searchTag = nextTag();
      const searchResult = await this.imapCommand(socket, searchTag, 'SEARCH UNSEEN');
      const uids = this.parseSearchResult(searchResult);

      // FETCH each unseen message
      for (const uid of uids.slice(0, 10)) { // Cap at 10 per poll to avoid overload
        const fetchTag = nextTag();
        const fetchResult = await this.imapCommand(
          socket, fetchTag, `FETCH ${uid} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT])`
        );

        const parsed = this.parseImapMessage(fetchResult);
        if (parsed && this.messageHandler) {
          this.targets.remember(parsed.from);
          this.messageHandler({
            sender: parsed.from,
            content: parsed.body,
            timestamp: parsed.date ?? new Date().toISOString(),
            raw: { subject: parsed.subject, uid },
            replyTo: parsed.from,
          });
        }

        // Mark as SEEN
        const storeTag = nextTag();
        await this.imapCommand(socket, storeTag, `STORE ${uid} +FLAGS (\\Seen)`);
      }

      // LOGOUT
      const logoutTag = nextTag();
      socket.write(`${logoutTag} LOGOUT${CRLF}`);
    } catch (err) {
      // Non-fatal — log and continue polling
      if (this._state === 'connected') {
        // Connection may be degraded but we don't transition to disconnected
        // unless the error is persistent (handled by next poll attempt)
      }
    } finally {
      socket?.destroy();
    }
  }

  /** Open a TCP/TLS connection to the IMAP server */
  private openImapConnection(): Promise<net.Socket | tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const opts = { host: this.config.imapHost, port: this.config.imapPort };

      const socket = this.config.useTls
        ? tls.connect({ ...opts, rejectUnauthorized: false }, () => resolve(socket))
        : net.createConnection(opts, () => resolve(socket));

      socket.once('error', reject);
      socket.setTimeout(15_000, () => {
        socket.destroy();
        reject(new Error('IMAP connection timeout'));
      });
    });
  }

  /** Send an IMAP command and collect the tagged response */
  private imapCommand(socket: net.Socket, tag: string, cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      socket.write(`${tag} ${cmd}${CRLF}`);
      this.imapReadResponse(socket, tag).then(resolve).catch(reject);
    });
  }

  /** Read IMAP response lines until we see the tagged completion line */
  private imapReadResponse(socket: net.Socket, tag: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => { cleanup(); reject(new Error('IMAP response timeout')); }, 10_000);

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(CRLF);

        for (const line of lines) {
          // Tagged response: "A1 OK ..." or "* OK ..." (for greeting)
          if (tag === '*' && line.startsWith('* ')) {
            cleanup();
            resolve(buffer);
            return;
          }
          if (line.startsWith(`${tag} `)) {
            cleanup();
            if (line.includes('OK')) {
              resolve(buffer);
            } else {
              reject(new Error(`IMAP error: ${line}`));
            }
            return;
          }
        }
      };

      const onError = (err: Error) => { cleanup(); reject(err); };
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
      };

      socket.on('data', onData);
      socket.once('error', onError);
    });
  }

  /** Parse SEARCH response to extract message sequence numbers */
  private parseSearchResult(response: string): string[] {
    // Response format: "* SEARCH 1 2 3 4\r\n"
    const match = response.match(/\* SEARCH (.+)/);
    if (!match) return [];
    return match[1].trim().split(/\s+/).filter(Boolean);
  }

  /** Extract basic email fields from a FETCH response */
  private parseImapMessage(response: string): { from: string; subject: string; body: string; date?: string } | null {
    try {
      // Extract From header
      const fromMatch = response.match(/From:\s*(.+)/i);
      const from = fromMatch?.[1]?.trim() ?? 'unknown';

      // Extract email address from "Name <email>" format
      const emailMatch = from.match(/<([^>]+)>/) ?? [null, from];
      const fromEmail = emailMatch[1] ?? from;

      // Extract Subject
      const subjectMatch = response.match(/Subject:\s*(.+)/i);
      const subject = subjectMatch?.[1]?.trim() ?? '(no subject)';

      // Extract Date
      const dateMatch = response.match(/Date:\s*(.+)/i);
      const date = dateMatch?.[1]?.trim();

      // Extract body text (content after the blank line in BODY[TEXT])
      // IMAP FETCH wraps body in literal: {size}\r\n<content>
      const bodyParts = response.split(/\r\n\r\n/);
      const body = bodyParts.length > 1
        ? bodyParts.slice(1).join('\n\n').replace(/\)\r\n.*$/s, '').trim()
        : '';

      if (!body && !subject) return null;

      return { from: fromEmail, subject, body: body || subject, date };
    } catch {
      return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.stateHandler?.(state);
  }
}
