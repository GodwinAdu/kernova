/**
 * Kernova Pluggable Context Engine Interface
 *
 * Defines the contract for context management plugins.
 * Developers can replace the default context engine with
 * custom implementations (vector DB, external services, etc.)
 *
 * Lifecycle: bootstrap → assemble → ingest → compact → maintain
 *
 * Inspired by OpenClaw's context-engine/types.ts interface.
 */

import type { KernovaId, Timestamp } from '@kernova/types';

// ─── Messages ────────────────────────────────────────────────

export interface ContextMessage {
  id: KernovaId;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Timestamp;
  metadata?: Record<string, unknown>;
}

// ─── Results ─────────────────────────────────────────────────

export interface AssembleResult {
  /** Ordered messages for the model prompt */
  messages: ContextMessage[];
  /** Estimated total tokens */
  estimatedTokens: number;
  /** Optional system prompt addition from the engine */
  systemPromptAddition?: string;
}

export interface CompactResult {
  /** Whether compaction occurred */
  compacted: boolean;
  /** Summary generated (if any) */
  summary?: string;
  /** Tokens before compaction */
  tokensBefore: number;
  /** Tokens after compaction */
  tokensAfter?: number;
  /** Reason if not compacted */
  reason?: string;
}

export interface IngestResult {
  ingested: boolean;
}

export interface BootstrapResult {
  bootstrapped: boolean;
  importedMessages?: number;
  reason?: string;
}

export interface MaintenanceResult {
  changed: boolean;
  entriesRewritten?: number;
  reason?: string;
}

// ─── Engine Info ─────────────────────────────────────────────

export interface ContextEngineInfo {
  id: string;
  name: string;
  version?: string;
  /** True when the engine manages its own compaction */
  ownsCompaction?: boolean;
}

// ─── Context Engine Plugin Interface ─────────────────────────

/**
 * Pluggable context engine interface.
 * Implement this to provide custom context management.
 *
 * Required: assemble, compact
 * Optional: bootstrap, ingest, maintain, afterTurn, dispose
 */
/** Input to ContextEnginePlugin.assemble() */
export interface AssembleParams {
  sessionId: string;
  messages: ContextMessage[];
  tokenBudget: number;
  prompt?: string;
  availableTools?: string[];
}

/** Input to ContextEnginePlugin.compact() */
export interface CompactParams {
  sessionId: string;
  messages: ContextMessage[];
  tokenBudget: number;
  force?: boolean;
}

export interface ContextEnginePlugin {
  /** Engine metadata */
  readonly info: ContextEngineInfo;

  /**
   * Initialize engine state for a session.
   * Called once when a session starts or resumes.
   */
  bootstrap?(params: {
    sessionId: string;
    existingMessages?: ContextMessage[];
  }): Promise<BootstrapResult>;

  /**
   * Ingest a new message into the engine's store.
   * Called after each user/assistant message.
   */
  ingest?(params: {
    sessionId: string;
    message: ContextMessage;
  }): Promise<IngestResult>;

  /**
   * Assemble model context under a token budget.
   * Returns ordered messages ready for the model.
   */
  assemble(params: AssembleParams): Promise<AssembleResult>;

  /**
   * Compact context to reduce token usage.
   * May create summaries, prune old turns, etc.
   */
  compact(params: CompactParams): Promise<CompactResult>;

  /**
   * Run maintenance after a successful turn.
   * Can rewrite transcript entries, prune caches, etc.
   */
  maintain?(params: {
    sessionId: string;
    messages: ContextMessage[];
  }): Promise<MaintenanceResult>;

  /**
   * Post-turn lifecycle hook.
   */
  afterTurn?(params: {
    sessionId: string;
    messages: ContextMessage[];
    newMessages: ContextMessage[];
  }): Promise<void>;

  /**
   * Clean up resources.
   */
  dispose?(): Promise<void>;
}
