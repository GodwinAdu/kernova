/**
 * Budget Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BudgetManager } from '../governance/budget-manager.js';
import { EventBus } from '../events/event-bus.js';

describe('BudgetManager', () => {
  let budget: BudgetManager;
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
    budget = new BudgetManager(eventBus);
  });

  afterEach(async () => {
    await eventBus.stop();
  });

  describe('Global Budget', () => {
    it('should allow requests within budget', () => {
      budget.setGlobalBudget({ maxTokens: 100_000 });
      const result = budget.check('user-1', 1000);
      expect(result.allowed).toBe(true);
    });

    it('should deny requests exceeding global token budget', () => {
      budget.setGlobalBudget({ maxTokens: 5000 });
      budget.record('user-1', 4500);
      const result = budget.check('user-1', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global token budget');
    });

    it('should deny requests exceeding global cost budget', () => {
      budget.setGlobalBudget({ maxCostUsd: 0.01 });
      budget.record('user-1', 50_000); // ~$0.15 at $3/1M
      const result = budget.check('user-1', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cost budget');
    });

    it('should enforce max tokens per intent', () => {
      budget.setGlobalBudget({ maxTokensPerIntent: 5000 });
      const result = budget.check('user-1', 10_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('max token limit');
    });
  });

  describe('Per-Identity Budget', () => {
    it('should enforce daily token limits per identity', () => {
      budget.setIdentityBudget('user-1', { maxTokensPerDay: 10_000 });
      budget.record('user-1', 9500);
      const result = budget.check('user-1', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily token budget');
    });

    it('should enforce hourly token limits', () => {
      budget.setIdentityBudget('user-1', { maxTokensPerHour: 5000 });
      budget.record('user-1', 4800);
      const result = budget.check('user-1', 500);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hourly token budget');
    });

    it('should not affect other identities', () => {
      budget.setIdentityBudget('user-1', { maxTokensPerDay: 1000 });
      budget.record('user-1', 999);

      // user-2 has no budget set, should be allowed
      const result = budget.check('user-2', 50000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce global rate limit', () => {
      budget.setGlobalBudget({ requestsPerMinute: 3 });
      budget.record('user-1', 100);
      budget.record('user-1', 100);
      budget.record('user-1', 100);

      const result = budget.check('user-1', 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rate limit');
    });

    it('should enforce per-identity rate limit', () => {
      budget.setIdentityBudget('user-1', { requestsPerMinute: 2 });
      budget.record('user-1', 100);
      budget.record('user-1', 100);

      const result = budget.check('user-1', 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit');
    });
  });

  describe('Usage Tracking', () => {
    it('should track usage per identity', () => {
      budget.record('user-1', 500);
      budget.record('user-1', 300);
      budget.record('user-2', 200);

      const usage1 = budget.getUsage('user-1');
      expect(usage1.totalTokens).toBe(800);
      expect(usage1.totalRequests).toBe(2);

      const usage2 = budget.getUsage('user-2');
      expect(usage2.totalTokens).toBe(200);
    });

    it('should track global usage', () => {
      budget.record('user-1', 500);
      budget.record('user-2', 300);

      const global = budget.getGlobalUsage();
      expect(global.totalTokens).toBe(800);
      expect(global.totalRequests).toBe(2);
      expect(global.estimatedCostUsd).toBeGreaterThan(0);
    });

    it('should reset hourly counters', () => {
      budget.record('user-1', 1000);
      expect(budget.getUsage('user-1').tokensThisHour).toBe(1000);

      budget.resetHourly();
      expect(budget.getUsage('user-1').tokensThisHour).toBe(0);
      expect(budget.getUsage('user-1').totalTokens).toBe(1000); // Total preserved
    });

    it('should reset daily counters', () => {
      budget.record('user-1', 5000);
      budget.resetDaily();
      expect(budget.getUsage('user-1').tokensToday).toBe(0);
      expect(budget.getUsage('user-1').totalTokens).toBe(5000); // Total preserved
    });
  });
});
