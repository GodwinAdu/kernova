/**
 * Kernova Conversation History Manager
 *
 * Manages conversation threads with named IDs and a configurable sliding window.
 * 
 * Features:
 * - Named thread IDs: create(threadId), retrieve(threadId), archive(threadId)
 * - Sliding window: configurable windowSize (default: 50).
 *   When messages exceed windowSize, use model to summarize oldest messages,
 *   or truncate if no model available.
 * - SQLite persistence for threads and messages
 * - Backward-compatible in-memory mode (ephemeral)
 */

import type {
  NexusId,
  NexusEvent,
  ConversationMessage,
  ConversationSummary,
  ConversationWindow,
  ConversationConfig,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { ModelRouter } from '../models/model-router.js';
import { ConversationStore, type MessageRow } from './conversation-store.js';
import { generateId, now } from '../utils.js';

export interface ConversationManagerConfig {
  maxTokens: number;
  preserveRecent: number;
  autoSummarize: boolean;
  summarizeThreshold: number;
  modelPurpose?: string;
  /** Sliding window size (max active messages per thread). Default: 50 */
  windowSize?: number;
  /** Data directory for SQLite persistence. If omitted, operates in-memory only. */
  dataDir?: string;
}

const DEFAULT_CONFIG: ConversationManagerConfig = {
  maxTokens: 4000,
  preserveRecent: 10,
  autoSummarize: true,
  summarizeThreshold: 0.8,
  windowSize: 50,
};

/**
 * In-memory thread state. Used for both ephemeral mode and as cache.
 */
interface ThreadState {
  id: string;
  messages: ConversationMessage[];
  summaries: ConversationSummary[];
  windowStart: number;
  windowSize: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

/**
 * Rough token estimation: ~4 characters per token for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ConversationManager {
  private readonly eventBus: EventBus;
  private readonly modelRouter: ModelRouter;
  private readonly config: ConversationManagerConfig;
  private readonly store: ConversationStore | null;

  /** In-memory thread registry */
  private threads: Map<string, ThreadState> = new Map();

  /** Default thread for backward-compatible single-conversation usage */
  private static readonly DEFAULT_THREAD = '__default__';

  constructor(eventBus: EventBus, modelRouter: ModelRouter, config?: Partial<ConversationConfig & { windowSize?: number; dataDir?: string }>) {
    this.eventBus = eventBus;
    this.modelRouter = modelRouter;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize SQLite store if dataDir is provided
    if (this.config.dataDir) {
      this.store = new ConversationStore({ dataDir: this.config.dataDir });
    } else {
      this.store = null;
    }
  }

  // ─── Named Thread Operations ─────────────────────────────────

  /**
   * Create a named conversation thread. If it already exists, returns existing.
   */
  create(threadId: string, windowSize?: number): ThreadState {
    const ws = windowSize ?? this.config.windowSize ?? 50;

    // Check if already in memory
    if (this.threads.has(threadId)) {
      return this.threads.get(threadId)!;
    }

    // Check if persisted
    if (this.store) {
      const existing = this.store.getThread(threadId);
      if (existing) {
        // Load from store
        return this.loadThreadFromStore(threadId);
      }
      // Create in store
      this.store.createThread(threadId, ws);
    }

    const thread: ThreadState = {
      id: threadId,
      messages: [],
      summaries: [],
      windowStart: 0,
      windowSize: ws,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    };

    this.threads.set(threadId, thread);
    return thread;
  }

  /**
   * Retrieve a thread by ID. Returns undefined if not found.
   */
  retrieve(threadId: string): ThreadState | undefined {
    // Check memory first
    if (this.threads.has(threadId)) {
      return this.threads.get(threadId)!;
    }

    // Check store
    if (this.store) {
      const row = this.store.getThread(threadId);
      if (row) {
        return this.loadThreadFromStore(threadId);
      }
    }

    return undefined;
  }

  /**
   * Archive a thread (marks as archived, retains data).
   */
  archive(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.status = 'archived';
      thread.updatedAt = now();
    }

    if (this.store) {
      this.store.archiveThread(threadId);
    }

    this.emitEvent('conversation.archived', threadId, { threadId });
  }

  /**
   * List all active thread IDs.
   */
  listThreads(): string[] {
    const ids = new Set<string>();

    // From memory
    for (const [id, thread] of this.threads) {
      if (thread.status === 'active' && id !== ConversationManager.DEFAULT_THREAD) {
        ids.add(id);
      }
    }

    // From store
    if (this.store) {
      for (const row of this.store.listActiveThreads()) {
        if (row.id !== ConversationManager.DEFAULT_THREAD) {
          ids.add(row.id);
        }
      }
    }

    return [...ids];
  }

  // ─── Message Operations (thread-aware) ───────────────────────

  /**
   * Add a message to a specific thread.
   * If the thread doesn't exist, it is auto-created.
   * After adding, the sliding window is enforced.
   */
  async addMessageToThread(
    threadId: string,
    role: ConversationMessage['role'],
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<ConversationMessage> {
    let thread = this.threads.get(threadId);
    if (!thread) {
      thread = this.create(threadId);
    }

    const message: ConversationMessage = {
      id: generateId('msg'),
      role,
      content,
      timestamp: now(),
      tokenEstimate: estimateTokens(content),
      metadata,
    };

    thread.messages.push(message);
    thread.updatedAt = now();

    // Persist message
    if (this.store) {
      const position = thread.messages.length - 1;
      this.store.addMessage({
        id: message.id,
        thread_id: threadId,
        role: message.role,
        content: message.content,
        position,
        created_at: message.timestamp,
      });
    }

    // Enforce sliding window
    await this.enforceWindow(thread);

    return message;
  }

  /**
   * Get the active context for a thread: summary + active messages within window.
   */
  getThreadContext(threadId: string): { summary: string | null; messages: ConversationMessage[] } {
    const thread = this.threads.get(threadId);
    if (!thread) {
      // Try loading from store
      if (this.store) {
        const row = this.store.getThread(threadId);
        if (row) {
          const loaded = this.loadThreadFromStore(threadId);
          const activeMessages = loaded.messages.slice(loaded.windowStart);
          const summaryText = loaded.summaries.length > 0
            ? loaded.summaries.map(s => s.content).join('\n\n')
            : (row.summary || null);
          return { summary: summaryText, messages: activeMessages };
        }
      }
      return { summary: null, messages: [] };
    }

    const activeMessages = thread.messages.slice(thread.windowStart);
    const summaryText = thread.summaries.length > 0
      ? thread.summaries.map(s => s.content).join('\n\n')
      : null;

    return { summary: summaryText, messages: activeMessages };
  }

  /**
   * Get the count of active (non-summarized) messages in a thread.
   */
  getActiveMessageCount(threadId: string): number {
    const thread = this.threads.get(threadId);
    if (!thread) return 0;
    return thread.messages.length - thread.windowStart;
  }

  // ─── Backward-Compatible API (single-conversation) ──────────

  /**
   * Add a message to the default conversation (backward-compatible).
   * If token budget is exceeded and autoSummarize is enabled, triggers compaction.
   */
  async addMessage(role: ConversationMessage['role'], content: string, metadata?: Record<string, unknown>): Promise<ConversationMessage> {
    return this.addMessageToThread(ConversationManager.DEFAULT_THREAD, role, content, metadata);
  }

  /**
   * Get the effective conversation window for prompt construction (default thread).
   * Returns summaries + recent messages within token budget.
   */
  getWindow(): ConversationWindow {
    const thread = this.getOrCreateDefaultThread();
    const activeMessages = thread.messages.slice(thread.windowStart);
    const tokenCount = this.getWindowTokenCountForThread(thread);

    return {
      messages: activeMessages,
      summaries: [...thread.summaries],
      totalMessages: thread.messages.length,
      windowStart: thread.windowStart,
      tokenCount,
    };
  }

  /**
   * Get messages formatted for LLM prompt construction (default thread).
   */
  getPromptMessages(): Array<{ role: string; content: string }> {
    const thread = this.getOrCreateDefaultThread();
    const result: Array<{ role: string; content: string }> = [];

    // Add summaries as system context
    if (thread.summaries.length > 0) {
      const summaryText = thread.summaries
        .map(s => s.content)
        .join('\n\n');
      result.push({
        role: 'system',
        content: `Previous conversation summary:\n${summaryText}`,
      });
    }

    // Add active window messages
    const activeMessages = thread.messages.slice(thread.windowStart);
    for (const msg of activeMessages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  /**
   * Force compaction on default thread.
   */
  async compact(): Promise<ConversationSummary | null> {
    const thread = this.getOrCreateDefaultThread();
    return this.compactThread(thread);
  }

  /**
   * Get total token count of the current active window (default thread).
   */
  getWindowTokenCount(): number {
    const thread = this.getOrCreateDefaultThread();
    return this.getWindowTokenCountForThread(thread);
  }

  /**
   * Get the total number of messages (including summarized) in default thread.
   */
  get totalMessages(): number {
    const thread = this.getOrCreateDefaultThread();
    return thread.messages.length;
  }

  /**
   * Get the number of active (unsummarized) messages in default thread.
   */
  get activeMessageCount(): number {
    const thread = this.getOrCreateDefaultThread();
    return thread.messages.length - thread.windowStart;
  }

  /**
   * Clear all conversation history (default thread).
   */
  clear(): void {
    const thread = this.getOrCreateDefaultThread();
    thread.messages = [];
    thread.summaries = [];
    thread.windowStart = 0;

    this.emitEvent('conversation.cleared', generateId('conv'), {});
  }

  /**
   * Export the full conversation (all messages + summaries) from default thread.
   */
  export(): { messages: ConversationMessage[]; summaries: ConversationSummary[] } {
    const thread = this.getOrCreateDefaultThread();
    return {
      messages: [...thread.messages],
      summaries: [...thread.summaries],
    };
  }

  /**
   * Import a previously exported conversation into default thread.
   */
  import(data: { messages: ConversationMessage[]; summaries: ConversationSummary[] }): void {
    const thread = this.getOrCreateDefaultThread();
    thread.messages = [...data.messages];
    thread.summaries = [...data.summaries];

    if (thread.summaries.length > 0) {
      const lastSummary = thread.summaries[thread.summaries.length - 1];
      thread.windowStart = lastSummary.messagesEnd + 1;
    } else {
      thread.windowStart = 0;
    }
  }

  /**
   * Close the store (cleanup resources).
   */
  close(): void {
    if (this.store) {
      this.store.close();
    }
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Enforce sliding window on a thread.
   * When active messages exceed windowSize, summarize oldest using model (fallback: truncate).
   */
  private async enforceWindow(thread: ThreadState): Promise<void> {
    const activeCount = thread.messages.length - thread.windowStart;

    // Count-based window enforcement
    if (activeCount > thread.windowSize) {
      const excess = activeCount - thread.windowSize;
      const messagesToSummarize = thread.messages.slice(thread.windowStart, thread.windowStart + excess);

      let summaryContent: string | null = null;

      // Try model-based summarization
      try {
        summaryContent = await this.summarizeMessages(messagesToSummarize);
      } catch {
        // Fallback: truncate (just discard oldest messages from active window)
        summaryContent = null;
      }

      if (summaryContent) {
        const summary: ConversationSummary = {
          id: generateId('sum'),
          content: summaryContent,
          messagesStart: thread.windowStart,
          messagesEnd: thread.windowStart + excess - 1,
          messageCount: excess,
          createdAt: now(),
          tokenEstimate: estimateTokens(summaryContent),
        };

        thread.summaries.push(summary);

        // Update store with summary
        if (this.store) {
          const fullSummary = thread.summaries.map(s => s.content).join('\n\n');
          this.store.updateSummary(thread.id, fullSummary);
        }
      }

      // Advance the window
      thread.windowStart += excess;

      this.emitEvent('conversation.window.shifted', thread.id, {
        threadId: thread.id,
        newWindowStart: thread.windowStart,
        summarized: summaryContent !== null,
        messagesDropped: excess,
      });

      return;
    }

    // Token-based auto-summarization (backward-compatible behavior)
    if (this.config.autoSummarize) {
      const windowTokens = this.getWindowTokenCountForThread(thread);
      const threshold = this.config.maxTokens * this.config.summarizeThreshold;

      if (windowTokens > threshold) {
        await this.compactThread(thread);
      }
    }
  }

  /**
   * Compact a thread using the token-based approach (original behavior).
   */
  private async compactThread(thread: ThreadState): Promise<ConversationSummary | null> {
    const activeMessages = thread.messages.slice(thread.windowStart);

    if (activeMessages.length <= this.config.preserveRecent) {
      return null;
    }

    const messagesToSummarize = activeMessages.slice(0, -this.config.preserveRecent);
    if (messagesToSummarize.length === 0) {
      return null;
    }

    const summaryStartIndex = thread.windowStart;
    const summaryEndIndex = thread.windowStart + messagesToSummarize.length - 1;

    this.emitEvent('conversation.compacting', generateId('conv'), {
      messageCount: messagesToSummarize.length,
      startIndex: summaryStartIndex,
      endIndex: summaryEndIndex,
    });

    const summaryContent = await this.summarizeMessages(messagesToSummarize);

    const summary: ConversationSummary = {
      id: generateId('sum'),
      content: summaryContent,
      messagesStart: summaryStartIndex,
      messagesEnd: summaryEndIndex,
      messageCount: messagesToSummarize.length,
      createdAt: now(),
      tokenEstimate: estimateTokens(summaryContent),
    };

    thread.summaries.push(summary);
    thread.windowStart = summaryEndIndex + 1;

    this.emitEvent('conversation.compacted', summary.id, {
      summarizedMessages: messagesToSummarize.length,
      summaryTokens: summary.tokenEstimate,
      newWindowStart: thread.windowStart,
    });

    return summary;
  }

  /**
   * Get or create the default thread for backward-compatible API.
   */
  private getOrCreateDefaultThread(): ThreadState {
    if (!this.threads.has(ConversationManager.DEFAULT_THREAD)) {
      this.threads.set(ConversationManager.DEFAULT_THREAD, {
        id: ConversationManager.DEFAULT_THREAD,
        messages: [],
        summaries: [],
        windowStart: 0,
        windowSize: this.config.windowSize ?? 50,
        status: 'active',
        createdAt: now(),
        updatedAt: now(),
      });
    }
    return this.threads.get(ConversationManager.DEFAULT_THREAD)!;
  }

  /**
   * Load a thread from the SQLite store into memory.
   */
  private loadThreadFromStore(threadId: string): ThreadState {
    const row = this.store!.getThread(threadId)!;
    const messageRows = this.store!.getMessages(threadId);

    const messages: ConversationMessage[] = messageRows.map((m: MessageRow) => ({
      id: m.id,
      role: m.role as ConversationMessage['role'],
      content: m.content,
      timestamp: m.created_at,
      tokenEstimate: estimateTokens(m.content),
    }));

    const thread: ThreadState = {
      id: threadId,
      messages,
      summaries: row.summary ? [{
        id: generateId('sum'),
        content: row.summary,
        messagesStart: 0,
        messagesEnd: 0,
        messageCount: 0,
        createdAt: row.created_at,
        tokenEstimate: estimateTokens(row.summary),
      }] : [],
      windowStart: 0, // All persisted messages are active
      windowSize: row.window_size,
      status: row.status as 'active' | 'archived',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    this.threads.set(threadId, thread);
    return thread;
  }

  /**
   * Get token count for a thread's active window.
   */
  private getWindowTokenCountForThread(thread: ThreadState): number {
    const summaryTokens = thread.summaries.reduce((sum, s) => sum + s.tokenEstimate, 0);
    const messageTokens = thread.messages
      .slice(thread.windowStart)
      .reduce((sum, m) => sum + m.tokenEstimate, 0);
    return summaryTokens + messageTokens;
  }

  /**
   * Summarize a batch of messages using the LLM.
   */
  private async summarizeMessages(messages: ConversationMessage[]): Promise<string> {
    const transcript = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `Summarize the following conversation concisely. Preserve key facts, decisions, and context that would be important for continuing the conversation. Do not include meta-commentary about the summary itself.

Conversation:
${transcript}

Summary:`;

    const response = await this.modelRouter.complete({
      messages: [{ role: 'user', content: prompt }],
      model: '',
      temperature: 0.3,
      maxTokens: Math.floor(this.config.maxTokens * 0.2),
    }, this.config.modelPurpose as never);

    return response.content.trim();
  }

  /**
   * Emit a conversation event.
   */
  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'conversation',
      actorId: 'conversation-manager',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'conversation-manager',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
