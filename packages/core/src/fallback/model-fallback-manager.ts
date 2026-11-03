/**
 * Kernova Model Fallback Manager
 *
 * Multi-candidate model routing with:
 * - Ordered fallback chains (try primary, then secondary, etc.)
 * - Per-candidate cooldown tracking
 * - Failover reason classification
 * - Circuit-breaking when all candidates exhaust
 * - Total timeout enforcement
 *
 * Inspired by OpenClaw's model-fallback.ts system.
 */

import type {
  KernovaId,
  KernovaEvent,
  ModelCandidate,
  FallbackAttempt,
  FailoverReason,
  FallbackChainConfig,
  FallbackResult,
  CompletionRequest,
  CompletionResponse,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { ModelRouter } from '../models/model-router.js';
import { generateId, now } from '../utils.js';

export interface ModelFallbackManagerConfig {
  defaultCooldownMs: number;
  maxAttempts: number;
  retryOnRateLimit: boolean;
  totalTimeoutMs: number;
}

const DEFAULT_CONFIG: ModelFallbackManagerConfig = {
  defaultCooldownMs: 60_000,
  maxAttempts: 5,
  retryOnRateLimit: true,
  totalTimeoutMs: 120_000,
};

/** Tracks per-candidate cooldown state */
interface CooldownEntry {
  candidate: ModelCandidate;
  cooldownUntil: number;
  reason: FailoverReason;
  consecutiveFailures: number;
}

export class ModelFallbackManager {
  private readonly eventBus: EventBus;
  private readonly modelRouter: ModelRouter;
  private readonly config: ModelFallbackManagerConfig;

  /** Cooldown tracking: provider:model → CooldownEntry */
  private cooldowns: Map<string, CooldownEntry> = new Map();

  constructor(
    eventBus: EventBus,
    modelRouter: ModelRouter,
    config?: Partial<ModelFallbackManagerConfig>,
  ) {
    this.eventBus = eventBus;
    this.modelRouter = modelRouter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a completion request through a fallback chain.
   * Tries candidates in order, skipping those on cooldown.
   */
  async complete(
    request: CompletionRequest,
    chain: FallbackChainConfig,
  ): Promise<FallbackResult<CompletionResponse>> {
    const attempts: FallbackAttempt[] = [];
    const startTime = Date.now();
    const maxAttempts = chain.maxAttempts ?? this.config.maxAttempts;
    const totalTimeout = chain.totalTimeoutMs ?? this.config.totalTimeoutMs;
    const cooldownMs = chain.cooldownMs ?? this.config.defaultCooldownMs;

    for (const candidate of chain.candidates) {
      // Check total timeout
      if (Date.now() - startTime > totalTimeout) {
        break;
      }

      // Check max attempts
      if (attempts.length >= maxAttempts) {
        break;
      }

      // Check cooldown
      const key = this.candidateKey(candidate);
      const cooldown = this.cooldowns.get(key);
      if (cooldown && Date.now() < cooldown.cooldownUntil) {
        continue; // Skip candidate on cooldown
      }

      try {
        const response = await this.modelRouter.complete({
          ...request,
          model: candidate.model,
        });

        // Success — reset cooldown
        this.cooldowns.delete(key);

        this.emitEvent('fallback.success', generateId('fb'), {
          provider: candidate.provider,
          model: candidate.model,
          attemptsBeforeSuccess: attempts.length,
          totalLatencyMs: Date.now() - startTime,
        });

        return {
          success: true,
          result: response,
          usedCandidate: candidate,
          attempts,
          totalLatencyMs: Date.now() - startTime,
        };
      } catch (error) {
        const reason = this.classifyError(error);
        const attempt: FallbackAttempt = {
          provider: candidate.provider,
          model: candidate.model,
          error: error instanceof Error ? error.message : String(error),
          reason,
          timestamp: now(),
          latencyMs: Date.now() - startTime,
        };
        attempts.push(attempt);

        // Apply cooldown
        const entry = this.cooldowns.get(key);
        const consecutiveFailures = (entry?.consecutiveFailures ?? 0) + 1;
        const backoffMs = cooldownMs * Math.min(consecutiveFailures, 5);

        this.cooldowns.set(key, {
          candidate,
          cooldownUntil: Date.now() + backoffMs,
          reason,
          consecutiveFailures,
        });

        this.emitEvent('fallback.attempt.failed', generateId('fb'), {
          provider: candidate.provider,
          model: candidate.model,
          reason,
          error: attempt.error,
          consecutiveFailures,
          cooldownMs: backoffMs,
        });
      }
    }

    // All candidates exhausted
    this.emitEvent('fallback.exhausted', generateId('fb'), {
      attemptCount: attempts.length,
      candidates: chain.candidates.length,
      totalLatencyMs: Date.now() - startTime,
    });

    return {
      success: false,
      usedCandidate: chain.candidates[0],
      attempts,
      totalLatencyMs: Date.now() - startTime,
    };
  }

  /**
   * Check if a candidate is currently on cooldown.
   */
  isOnCooldown(candidate: ModelCandidate): boolean {
    const key = this.candidateKey(candidate);
    const entry = this.cooldowns.get(key);
    return entry !== undefined && Date.now() < entry.cooldownUntil;
  }

  /**
   * Get available (non-cooldown) candidates from a chain.
   */
  getAvailableCandidates(chain: FallbackChainConfig): ModelCandidate[] {
    return chain.candidates.filter(c => !this.isOnCooldown(c));
  }

  /**
   * Reset cooldown for a specific candidate.
   */
  resetCooldown(candidate: ModelCandidate): void {
    this.cooldowns.delete(this.candidateKey(candidate));
  }

  /**
   * Reset all cooldowns.
   */
  resetAllCooldowns(): void {
    this.cooldowns.clear();
  }

  /**
   * Get cooldown status for all tracked candidates.
   */
  getCooldownStatus(): Array<{
    candidate: ModelCandidate;
    cooldownUntil: number;
    reason: FailoverReason;
    consecutiveFailures: number;
  }> {
    const status: Array<{
      candidate: ModelCandidate;
      cooldownUntil: number;
      reason: FailoverReason;
      consecutiveFailures: number;
    }> = [];
    for (const entry of this.cooldowns.values()) {
      if (Date.now() < entry.cooldownUntil) {
        status.push(entry);
      }
    }
    return status;
  }

  // ─── Private ───────────────────────────────────────────────

  private candidateKey(candidate: ModelCandidate): string {
    return `${candidate.provider}:${candidate.model}`;
  }

  private classifyError(error: unknown): FailoverReason {
    if (!(error instanceof Error)) return 'unknown';
    const msg = error.message.toLowerCase();

    if (msg.includes('rate') || msg.includes('429')) return 'rate_limit';
    if (msg.includes('overloaded') || msg.includes('503')) return 'overloaded';
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('auth') || msg.includes('401') || msg.includes('403')) return 'auth';
    if (msg.includes('not found') || msg.includes('404')) return 'model_not_found';
    if (msg.includes('context') || msg.includes('token')) return 'context_overflow';
    if (msg.includes('billing') || msg.includes('payment')) return 'billing';
    if (msg.includes('network') || msg.includes('ECONNREFUSED')) return 'network';
    return 'unknown';
  }

  private emitEvent(eventType: string, subjectId: KernovaId, data: Record<string, unknown>): void {
    const event: KernovaEvent = {
      id: generateId('evt'),
      eventType,
      category: 'model',
      severity: eventType.includes('exhausted') ? 'error' : eventType.includes('failed') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'fallback',
      actorId: 'model-fallback',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'model-fallback-manager',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
