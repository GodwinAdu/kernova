/**
 * Nexus Budget Manager
 * 
 * Pillar 7: Governance — "Who is accountable?"
 * 
 * Enforces token budgets, rate limits, and cost caps to prevent
 * runaway spending and abuse.
 * 
 * Enforcement levels:
 * - Global: total budget for the entire runtime instance
 * - Per-identity: budget per user or agent
 * - Per-intent: maximum tokens for a single intent execution
 * - Rate: requests per time window (sliding window)
 */

import type { NexusId } from '@nexus/types';
import { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface BudgetConfig {
  /** Maximum total tokens (all identities combined) */
  maxTokens?: number;

  /** Maximum cost in USD (estimated) */
  maxCostUsd?: number;

  /** Maximum tokens per single intent */
  maxTokensPerIntent?: number;

  /** Maximum requests per minute (global) */
  requestsPerMinute?: number;
}

export interface IdentityBudget {
  /** Maximum tokens per day for this identity */
  maxTokensPerDay?: number;

  /** Maximum tokens per hour */
  maxTokensPerHour?: number;

  /** Maximum requests per minute */
  requestsPerMinute?: number;

  /** Maximum cost per day in USD */
  maxCostPerDayUsd?: number;
}

export interface UsageRecord {
  /** Total tokens consumed */
  totalTokens: number;

  /** Tokens consumed in current hour */
  tokensThisHour: number;

  /** Tokens consumed today */
  tokensToday: number;

  /** Estimated cost in USD */
  estimatedCostUsd: number;

  /** Requests in current minute */
  requestsThisMinute: number;

  /** Total requests */
  totalRequests: number;

  /** When the last request was made */
  lastRequestAt?: string;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingTokens?: number;
  remainingCostUsd?: number;
}

/** Average cost per 1M tokens (rough estimate for budgeting) */
const DEFAULT_COST_PER_MILLION_TOKENS = 3.00; // $3/1M tokens average

export class BudgetManager {
  private globalConfig: BudgetConfig = {};
  private identityBudgets: Map<NexusId, IdentityBudget> = new Map();
  private usage: Map<NexusId, UsageRecord> = new Map(); // identity → usage
  private globalUsage: UsageRecord;
  private requestTimestamps: Map<NexusId, number[]> = new Map(); // identity → timestamps
  private globalRequestTimestamps: number[] = [];
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.globalUsage = this.createEmptyUsage();
  }

  /**
   * Set the global budget for the runtime
   */
  setGlobalBudget(config: BudgetConfig): void {
    this.globalConfig = config;
  }

  /**
   * Set budget for a specific identity
   */
  setIdentityBudget(identityId: NexusId, budget: IdentityBudget): void {
    this.identityBudgets.set(identityId, budget);
  }

  /**
   * Check if a request is allowed within budget constraints.
   * Call this BEFORE making an LLM call.
   */
  check(identityId: NexusId, estimatedTokens = 0): BudgetCheckResult {
    // 1. Check global token budget
    if (this.globalConfig.maxTokens) {
      if (this.globalUsage.totalTokens + estimatedTokens > this.globalConfig.maxTokens) {
        return this.deny('Global token budget exceeded', identityId);
      }
    }

    // 2. Check global cost budget
    if (this.globalConfig.maxCostUsd) {
      const estimatedAdditionalCost = (estimatedTokens / 1_000_000) * DEFAULT_COST_PER_MILLION_TOKENS;
      if (this.globalUsage.estimatedCostUsd + estimatedAdditionalCost > this.globalConfig.maxCostUsd) {
        return this.deny('Global cost budget exceeded', identityId);
      }
    }

    // 3. Check global rate limit
    if (this.globalConfig.requestsPerMinute) {
      const recentGlobal = this.getRecentRequests(this.globalRequestTimestamps);
      if (recentGlobal >= this.globalConfig.requestsPerMinute) {
        return this.deny('Global rate limit exceeded (requests per minute)', identityId);
      }
    }

    // 4. Check per-intent token limit
    if (this.globalConfig.maxTokensPerIntent && estimatedTokens > this.globalConfig.maxTokensPerIntent) {
      return this.deny(`Intent exceeds max token limit (${this.globalConfig.maxTokensPerIntent})`, identityId);
    }

    // 5. Check identity-specific budgets
    const identityBudget = this.identityBudgets.get(identityId);
    if (identityBudget) {
      const identityUsage = this.getUsage(identityId);

      if (identityBudget.maxTokensPerDay && identityUsage.tokensToday + estimatedTokens > identityBudget.maxTokensPerDay) {
        return this.deny(`Daily token budget exceeded for "${identityId}"`, identityId);
      }

      if (identityBudget.maxTokensPerHour && identityUsage.tokensThisHour + estimatedTokens > identityBudget.maxTokensPerHour) {
        return this.deny(`Hourly token budget exceeded for "${identityId}"`, identityId);
      }

      if (identityBudget.requestsPerMinute) {
        const timestamps = this.requestTimestamps.get(identityId) || [];
        const recentCount = this.getRecentRequests(timestamps);
        if (recentCount >= identityBudget.requestsPerMinute) {
          return this.deny(`Rate limit exceeded for "${identityId}"`, identityId);
        }
      }

      if (identityBudget.maxCostPerDayUsd) {
        const estimatedAdditionalCost = (estimatedTokens / 1_000_000) * DEFAULT_COST_PER_MILLION_TOKENS;
        if (identityUsage.estimatedCostUsd + estimatedAdditionalCost > identityBudget.maxCostPerDayUsd) {
          return this.deny(`Daily cost budget exceeded for "${identityId}"`, identityId);
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Record usage after an LLM call completes.
   * Call this AFTER the model responds.
   */
  record(identityId: NexusId, tokens: number): void {
    const timestamp = Date.now();
    const cost = (tokens / 1_000_000) * DEFAULT_COST_PER_MILLION_TOKENS;

    // Update global usage
    this.globalUsage.totalTokens += tokens;
    this.globalUsage.tokensThisHour += tokens;
    this.globalUsage.tokensToday += tokens;
    this.globalUsage.estimatedCostUsd += cost;
    this.globalUsage.totalRequests++;
    this.globalUsage.requestsThisMinute++;
    this.globalUsage.lastRequestAt = now();
    this.globalRequestTimestamps.push(timestamp);

    // Update identity usage
    const identityUsage = this.getOrCreateUsage(identityId);
    identityUsage.totalTokens += tokens;
    identityUsage.tokensThisHour += tokens;
    identityUsage.tokensToday += tokens;
    identityUsage.estimatedCostUsd += cost;
    identityUsage.totalRequests++;
    identityUsage.requestsThisMinute++;
    identityUsage.lastRequestAt = now();

    // Record timestamp for rate limiting
    const timestamps = this.requestTimestamps.get(identityId) || [];
    timestamps.push(timestamp);
    this.requestTimestamps.set(identityId, timestamps);

    // Clean old timestamps (keep last 5 minutes)
    this.cleanTimestamps();
  }

  /**
   * Get usage for a specific identity
   */
  getUsage(identityId: NexusId): UsageRecord {
    return this.usage.get(identityId) || this.createEmptyUsage();
  }

  /**
   * Get global usage
   */
  getGlobalUsage(): UsageRecord {
    return { ...this.globalUsage };
  }

  /**
   * Get the current budget configuration
   */
  getConfig(): BudgetConfig {
    return { ...this.globalConfig };
  }

  /**
   * Reset usage counters (typically called on a schedule)
   */
  resetHourly(): void {
    for (const usage of this.usage.values()) {
      usage.tokensThisHour = 0;
      usage.requestsThisMinute = 0;
    }
    this.globalUsage.tokensThisHour = 0;
    this.globalUsage.requestsThisMinute = 0;
  }

  resetDaily(): void {
    for (const usage of this.usage.values()) {
      usage.tokensToday = 0;
      usage.estimatedCostUsd = 0;
    }
    this.globalUsage.tokensToday = 0;
  }

  private deny(reason: string, identityId: NexusId): BudgetCheckResult {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType: 'governance.budget.exceeded',
      category: 'governance',
      severity: 'warn',
      timestamp: now(),
      subjectId: identityId,
      subjectType: 'identity',
      actorId: 'budget-manager',
      correlationId: generateId('cor'),
      data: { identityId, reason },
      metadata: { schemaVersion: '1.0.0', source: 'budget-manager', environment: 'development' },
    });

    return { allowed: false, reason };
  }

  private getOrCreateUsage(identityId: NexusId): UsageRecord {
    let record = this.usage.get(identityId);
    if (!record) {
      record = this.createEmptyUsage();
      this.usage.set(identityId, record);
    }
    return record;
  }

  private createEmptyUsage(): UsageRecord {
    return {
      totalTokens: 0,
      tokensThisHour: 0,
      tokensToday: 0,
      estimatedCostUsd: 0,
      requestsThisMinute: 0,
      totalRequests: 0,
    };
  }

  /**
   * Count requests in the last 60 seconds (sliding window)
   */
  private getRecentRequests(timestamps: number[]): number {
    const oneMinuteAgo = Date.now() - 60_000;
    return timestamps.filter(t => t > oneMinuteAgo).length;
  }

  /**
   * Clean up old timestamps to prevent memory growth
   */
  private cleanTimestamps(): void {
    const fiveMinutesAgo = Date.now() - 300_000;

    // Clean global
    this.globalRequestTimestamps = this.globalRequestTimestamps.filter(t => t > fiveMinutesAgo);

    // Clean per-identity
    for (const [id, timestamps] of this.requestTimestamps.entries()) {
      this.requestTimestamps.set(id, timestamps.filter(t => t > fiveMinutesAgo));
    }
  }
}
