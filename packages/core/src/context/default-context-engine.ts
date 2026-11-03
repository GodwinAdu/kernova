/**
 * Kernova Default Context Engine Plugin
 *
 * Built-in implementation that combines:
 * - Memory layer queries for relevant context
 * - Sliding-window conversation management
 * - Token-budget-aware assembly
 * - LLM-powered summarization for compaction
 *
 * This is the engine used when no custom plugin is registered.
 */

import type { KernovaId } from '@kernova/types';
import type { ModelRouter } from '../models/model-router.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import { generateId, now } from '../utils.js';
import type {
  ContextEnginePlugin,
  ContextEngineInfo,
  ContextMessage,
  AssembleResult,
  CompactResult,
  IngestResult,
  BootstrapResult,
  MaintenanceResult,
} from './context-engine-plugin.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface DefaultContextEngineConfig {
  /** Max tokens for assembled context */
  maxTokenBudget?: number;
  /** Messages to always preserve in full */
  preserveRecent?: number;
  /** Ratio of budget that triggers compaction */
  compactionThreshold?: number;
}

const DEFAULT_CONFIG: DefaultContextEngineConfig = {
  maxTokenBudget: 8000,
  preserveRecent: 10,
  compactionThreshold: 0.85,
};

export class DefaultContextEngine implements ContextEnginePlugin {
  readonly info: ContextEngineInfo = {
    id: 'kernova-default',
    name: 'Kernova Default Context Engine',
    version: '1.0.0',
    ownsCompaction: true,
  };

  private readonly modelRouter: ModelRouter;
  private readonly memory: MemoryEngine;
  private readonly config: Required<DefaultContextEngineConfig>;

  /** Per-session summaries */
  private summaries: Map<string, string[]> = new Map();

  constructor(
    modelRouter: ModelRouter,
    memory: MemoryEngine,
    config?: DefaultContextEngineConfig,
  ) {
    this.modelRouter = modelRouter;
    this.memory = memory;
    this.config = {
      maxTokenBudget: config?.maxTokenBudget ?? DEFAULT_CONFIG.maxTokenBudget!,
      preserveRecent: config?.preserveRecent ?? DEFAULT_CONFIG.preserveRecent!,
      compactionThreshold: config?.compactionThreshold ?? DEFAULT_CONFIG.compactionThreshold!,
    };
  }

  async bootstrap(params: {
    sessionId: string;
    existingMessages?: ContextMessage[];
  }): Promise<BootstrapResult> {
    const count = params.existingMessages?.length ?? 0;
    return { bootstrapped: true, importedMessages: count };
  }

  async ingest(params: {
    sessionId: string;
    message: ContextMessage;
  }): Promise<IngestResult> {
    // Store to memory if it's substantial
    if (params.message.content.length > 50) {
      await this.memory.store({
        content: params.message.content,
        layer: 'session',
        tags: [params.sessionId, params.message.role],
      });
    }
    return { ingested: true };
  }

  async assemble(params: {
    sessionId: string;
    messages: ContextMessage[];
    tokenBudget: number;
    prompt?: string;
    availableTools?: string[];
  }): Promise<AssembleResult> {
    const budget = Math.min(params.tokenBudget, this.config.maxTokenBudget);
    const messages: ContextMessage[] = [];
    let totalTokens = 0;

    // 1. Add session summaries as system context
    const sessionSummaries = this.summaries.get(params.sessionId) ?? [];
    if (sessionSummaries.length > 0) {
      const summaryContent = sessionSummaries.join('\n\n');
      const summaryTokens = estimateTokens(summaryContent);
      if (totalTokens + summaryTokens < budget * 0.3) {
        messages.push({
          id: generateId('ctx'),
          role: 'system',
          content: `Previous conversation context:\n${summaryContent}`,
          timestamp: now(),
        });
        totalTokens += summaryTokens;
      }
    }

    // 2. Add relevant memories from long-term store
    if (params.prompt) {
      const memories = await this.memory.query({
        query: params.prompt,
        layers: ['longterm', 'organizational'],
        limit: 5,
      });
      if (memories.length > 0) {
        const memContent = memories.map(m => m.content).join('\n');
        const memTokens = estimateTokens(memContent);
        if (totalTokens + memTokens < budget * 0.2) {
          messages.push({
            id: generateId('ctx'),
            role: 'system',
            content: `Relevant knowledge:\n${memContent}`,
            timestamp: now(),
          });
          totalTokens += memTokens;
        }
      }
    }

    // 3. Add recent messages (fill remaining budget)
    const recentMessages = params.messages.slice(-this.config.preserveRecent * 3);
    for (const msg of recentMessages) {
      const msgTokens = estimateTokens(msg.content);
      if (totalTokens + msgTokens > budget) break;
      messages.push(msg);
      totalTokens += msgTokens;
    }

    return { messages, estimatedTokens: totalTokens };
  }

  async compact(params: {
    sessionId: string;
    messages: ContextMessage[];
    tokenBudget: number;
    force?: boolean;
  }): Promise<CompactResult> {
    const totalTokens = params.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content), 0,
    );

    // Check if compaction is needed
    const threshold = params.tokenBudget * this.config.compactionThreshold;
    if (!params.force && totalTokens < threshold) {
      return {
        compacted: false,
        tokensBefore: totalTokens,
        reason: 'Below compaction threshold',
      };
    }

    // Messages to summarize (everything except recent)
    const toSummarize = params.messages.slice(0, -this.config.preserveRecent);
    if (toSummarize.length < 3) {
      return {
        compacted: false,
        tokensBefore: totalTokens,
        reason: 'Not enough messages to compact',
      };
    }

    // Generate summary via LLM
    const transcript = toSummarize
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `Summarize this conversation concisely. Preserve key facts, decisions, and active tasks.\n\n${transcript}\n\nSummary:`;

    try {
      const response = await this.modelRouter.complete({
        messages: [{ role: 'user', content: prompt }],
        model: '',
        temperature: 0.3,
        maxTokens: Math.floor(params.tokenBudget * 0.15),
      });

      const summary = response.content.trim();

      // Store summary for this session
      if (!this.summaries.has(params.sessionId)) {
        this.summaries.set(params.sessionId, []);
      }
      this.summaries.get(params.sessionId)!.push(summary);

      const afterTokens = estimateTokens(summary) +
        params.messages.slice(-this.config.preserveRecent)
          .reduce((sum, m) => sum + estimateTokens(m.content), 0);

      return {
        compacted: true,
        summary,
        tokensBefore: totalTokens,
        tokensAfter: afterTokens,
      };
    } catch {
      return {
        compacted: false,
        tokensBefore: totalTokens,
        reason: 'Summarization failed',
      };
    }
  }

  async maintain(params: {
    sessionId: string;
    messages: ContextMessage[];
  }): Promise<MaintenanceResult> {
    // Default: no-op maintenance
    return { changed: false };
  }

  async afterTurn(params: {
    sessionId: string;
    messages: ContextMessage[];
    newMessages: ContextMessage[];
  }): Promise<void> {
    // Check if we should auto-compact
    const totalTokens = params.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content), 0,
    );
    const threshold = this.config.maxTokenBudget * this.config.compactionThreshold;
    if (totalTokens > threshold) {
      await this.compact({
        sessionId: params.sessionId,
        messages: params.messages,
        tokenBudget: this.config.maxTokenBudget,
      });
    }
  }

  async dispose(): Promise<void> {
    this.summaries.clear();
  }
}
