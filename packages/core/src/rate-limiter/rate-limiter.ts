/**
 * Kernova Rate Limiter
 *
 * Token-bucket rate limiting with:
 * - Per-identity limits (user budgets)
 * - Per-provider limits (API quotas)
 * - Global limits (system protection)
 * - Sliding window tracking
 * - Burst allowance
 *
 * Inspired by OpenClaw's gateway rate limiting.
 */

import type { KernovaId, KernovaEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface RateLimitRule {
  /** Rule identifier */
  id: string;
  /** What to limit: identity, provider, or global */
  scope: 'identity' | 'provider' | 'global';
  /** Scope key (identity ID, provider name, or '*') */
  key: string;
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in ms */
  windowMs: number;
  /** Burst allowance above maxRequests (consumed, then refilled) */
  burstAllowance?: number;
}

export interface RateLimiterConfig {
  rules?: RateLimitRule[];
  /** Default global limit if no rules match */
  defaultMaxRequests?: number;
  defaultWindowMs?: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  windowStart: number;
  requestCount: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
  rule?: RateLimitRule;
}

export class RateLimiter {
  private readonly eventBus: EventBus;
  private rules: RateLimitRule[] = [];
  private buckets: Map<string, BucketState> = new Map();
  private defaultMaxRequests: number;
  private defaultWindowMs: number;

  constructor(eventBus: EventBus, config?: RateLimiterConfig) {
    this.eventBus = eventBus;
    this.rules = config?.rules ?? [];
    this.defaultMaxRequests = config?.defaultMaxRequests ?? 100;
    this.defaultWindowMs = config?.defaultWindowMs ?? 60_000;
  }

  /**
   * Check if a request is allowed under rate limits.
   */
  check(scope: 'identity' | 'provider' | 'global', key: string): RateLimitCheck {
    const rule = this.findRule(scope, key);
    const maxRequests = rule?.maxRequests ?? this.defaultMaxRequests;
    const windowMs = rule?.windowMs ?? this.defaultWindowMs;
    const burst = rule?.burstAllowance ?? 0;
    const effectiveMax = maxRequests + burst;

    const bucketKey = `${scope}:${key}`;
    const bucket = this.getOrCreateBucket(bucketKey, effectiveMax, windowMs);

    if (bucket.tokens > 0) {
      return {
        allowed: true,
        remaining: bucket.tokens,
        resetAt: bucket.windowStart + windowMs,
        rule,
      };
    }

    const retryAfterMs = (bucket.windowStart + windowMs) - Date.now();
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.windowStart + windowMs,
      retryAfterMs: Math.max(0, retryAfterMs),
      rule,
    };
  }

  /**
   * Consume one token from the rate limit bucket.
   * Returns false if rate limited.
   */
  consume(scope: 'identity' | 'provider' | 'global', key: string): boolean {
    const checkResult = this.check(scope, key);
    if (!checkResult.allowed) {
      this.emitEvent('ratelimit.exceeded', `${scope}:${key}`, {
        scope,
        key,
        retryAfterMs: checkResult.retryAfterMs,
      });
      return false;
    }

    const bucketKey = `${scope}:${key}`;
    const bucket = this.buckets.get(bucketKey)!;
    bucket.tokens--;
    bucket.requestCount++;
    return true;
  }

  /**
   * Add a rate limit rule.
   */
  addRule(rule: RateLimitRule): void {
    this.rules.push(rule);
  }

  /** Whether a rule (rather than the default limit) covers this scope and key */
  hasRule(scope: 'identity' | 'provider' | 'global', key: string): boolean {
    return this.findRule(scope, key) !== undefined;
  }

  /**
   * Remove a rule by ID.
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  /**
   * Get current stats for a bucket.
   */
  getStats(scope: 'identity' | 'provider' | 'global', key: string): {
    requestCount: number;
    remaining: number;
    windowMs: number;
  } | null {
    const bucketKey = `${scope}:${key}`;
    const bucket = this.buckets.get(bucketKey);
    if (!bucket) return null;
    const rule = this.findRule(scope, key);
    return {
      requestCount: bucket.requestCount,
      remaining: bucket.tokens,
      windowMs: rule?.windowMs ?? this.defaultWindowMs,
    };
  }

  /**
   * Reset a specific bucket (e.g., after quota increase).
   */
  reset(scope: 'identity' | 'provider' | 'global', key: string): void {
    this.buckets.delete(`${scope}:${key}`);
  }

  /**
   * Reset all buckets.
   */
  resetAll(): void {
    this.buckets.clear();
  }

  // ─── Private ───────────────────────────────────────────────

  private findRule(scope: string, key: string): RateLimitRule | undefined {
    return this.rules.find(r => r.scope === scope && (r.key === key || r.key === '*'));
  }

  private getOrCreateBucket(bucketKey: string, maxTokens: number, windowMs: number): BucketState {
    const existing = this.buckets.get(bucketKey);
    const currentTime = Date.now();

    if (existing) {
      // Check if window has elapsed — refill
      if (currentTime - existing.windowStart >= windowMs) {
        existing.tokens = maxTokens;
        existing.windowStart = currentTime;
        existing.requestCount = 0;
      }
      return existing;
    }

    const bucket: BucketState = {
      tokens: maxTokens,
      lastRefill: currentTime,
      windowStart: currentTime,
      requestCount: 0,
    };
    this.buckets.set(bucketKey, bucket);
    return bucket;
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'warn',
      timestamp: now(),
      subjectId,
      subjectType: 'rate_limit',
      actorId: 'rate-limiter',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'rate-limiter', environment: 'runtime' },
    });
  }
}
