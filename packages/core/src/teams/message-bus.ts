/**
 * Agent Message Bus — Inter-Agent Communication
 *
 * Handles message passing between agents within a team.
 * Supports direct messages, broadcasts, and request-reply patterns.
 */

import type { AgentId, AgentMessage, MessageId } from './types.js';

export type MessageHandler = (message: AgentMessage) => Promise<void> | void;
export type MessageFilter = (message: AgentMessage) => boolean;

export interface MessageBusOptions {
  /** Max messages to keep in history per conversation */
  maxHistory?: number;
  /** Message TTL in ms (auto-expire old messages) */
  messageTtl?: number;
}

export class MessageBus {
  private handlers: Map<AgentId, MessageHandler[]> = new Map();
  private history: AgentMessage[] = [];
  private pendingReplies: Map<MessageId, {
    resolve: (msg: AgentMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private options: Required<MessageBusOptions>;
  private idCounter = 0;

  constructor(options?: MessageBusOptions) {
    this.options = {
      maxHistory: options?.maxHistory ?? 1000,
      messageTtl: options?.messageTtl ?? 3600000, // 1 hour
    };
  }

  /** Generate a unique message ID */
  private generateId(): MessageId {
    return `msg_${Date.now()}_${++this.idCounter}`;
  }

  /** Subscribe an agent to receive messages */
  subscribe(agentId: AgentId, handler: MessageHandler): () => void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, []);
    }
    this.handlers.get(agentId)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(agentId);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  /** Send a message to a specific agent */
  async send(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentMessage> {
    const fullMessage: AgentMessage = {
      ...message,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
    };

    // Store in history
    this.history.push(fullMessage);
    this.trimHistory();

    // Deliver to target
    const handlers = this.handlers.get(message.to);
    if (handlers) {
      for (const handler of handlers) {
        await handler(fullMessage);
      }
    }

    // Check if this is a reply to a pending request
    if (fullMessage.type === 'result' && fullMessage.taskId) {
      const pending = this.pendingReplies.get(fullMessage.taskId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(fullMessage);
        this.pendingReplies.delete(fullMessage.taskId);
      }
    }

    return fullMessage;
  }

  /** Send a message and wait for a reply */
  async sendAndWait(
    message: Omit<AgentMessage, 'id' | 'timestamp'>,
    timeoutMs: number = 60000,
  ): Promise<AgentMessage> {
    const sentMessage = await this.send(message);

    return new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(sentMessage.id);
        reject(new Error(`Message reply timeout after ${timeoutMs}ms (from: ${message.from}, to: ${message.to})`));
      }, timeoutMs);

      this.pendingReplies.set(sentMessage.id, { resolve, reject, timer });
    });
  }

  /** Broadcast a message to all subscribed agents (except sender) */
  async broadcast(from: AgentId, content: string, payload?: Record<string, unknown>): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = [];

    for (const [agentId] of this.handlers) {
      if (agentId === from) continue;

      const msg = await this.send({
        from,
        to: agentId,
        type: 'broadcast',
        content,
        payload,
      });
      messages.push(msg);
    }

    return messages;
  }

  /** Get message history between two agents */
  getHistory(agentA: AgentId, agentB: AgentId, limit?: number): AgentMessage[] {
    const filtered = this.history.filter(
      m => (m.from === agentA && m.to === agentB) || (m.from === agentB && m.to === agentA),
    );
    return limit ? filtered.slice(-limit) : filtered;
  }

  /** Get all messages for an agent */
  getMessagesFor(agentId: AgentId, filter?: MessageFilter): AgentMessage[] {
    let messages = this.history.filter(m => m.to === agentId || m.from === agentId);
    if (filter) {
      messages = messages.filter(filter);
    }
    return messages;
  }

  /** Get all messages in the bus */
  getAllHistory(): AgentMessage[] {
    return [...this.history];
  }

  /** Clear history */
  clear(): void {
    this.history = [];
    for (const [, pending] of this.pendingReplies) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Message bus cleared'));
    }
    this.pendingReplies.clear();
  }

  /** Remove all subscriptions */
  reset(): void {
    this.clear();
    this.handlers.clear();
  }

  private trimHistory(): void {
    if (this.history.length > this.options.maxHistory) {
      this.history = this.history.slice(-this.options.maxHistory);
    }
  }
}
