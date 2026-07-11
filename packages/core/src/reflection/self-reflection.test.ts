/**
 * Self-Reflection Module Tests
 *
 * Unit tests covering:
 * - Confidence score clamping to [0.0, 1.0]
 * - Configurable threshold (default: 0.7) — regeneration triggered below threshold
 * - Max regeneration limit (default: 2) — stops at max limit
 * - reflection.regenerated event emission with agentId, regenerated, maxReached fields
 * - Per-agent and global configuration for enabling/disabling reflection
 * - resolveReflectionConfig utility
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SelfReflection, clampConfidence, resolveReflectionConfig } from './self-reflection.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';
import type { NexusEvent } from '@kernova/types';

describe('SelfReflection', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;
  let mockProvider: MockModelProvider;
  let reflection: SelfReflection;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();

    mockProvider = new MockModelProvider({
      defaultResponse: JSON.stringify({
        criteria: [
          { name: 'accuracy', score: 0.9, feedback: 'Accurate information' },
          { name: 'completeness', score: 0.85, feedback: 'Covers main points' },
          { name: 'clarity', score: 0.8, feedback: 'Clear and readable' },
        ],
        overallScore: 0.85,
        reasoning: 'The output is well-written and accurate.',
        suggestions: ['Add more examples', 'Include references'],
      }),
    });

    modelRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [mockProvider],
      eventBus,
    });

    reflection = new SelfReflection(eventBus, modelRouter);
  });

  describe('clampConfidence()', () => {
    it('should clamp values above 1.0 to 1.0', () => {
      expect(clampConfidence(1.5)).toBe(1.0);
      expect(clampConfidence(100)).toBe(1.0);
    });

    it('should clamp values below 0.0 to 0.0', () => {
      expect(clampConfidence(-0.5)).toBe(0.0);
      expect(clampConfidence(-100)).toBe(0.0);
    });

    it('should return 0.0 for NaN', () => {
      expect(clampConfidence(NaN)).toBe(0.0);
    });

    it('should clamp Infinity to 1.0', () => {
      expect(clampConfidence(Infinity)).toBe(1.0);
    });

    it('should clamp -Infinity to 0.0', () => {
      expect(clampConfidence(-Infinity)).toBe(0.0);
    });

    it('should pass through valid values unchanged', () => {
      expect(clampConfidence(0.0)).toBe(0.0);
      expect(clampConfidence(0.5)).toBe(0.5);
      expect(clampConfidence(1.0)).toBe(1.0);
      expect(clampConfidence(0.7)).toBe(0.7);
    });
  });

  describe('evaluate()', () => {
    it('should evaluate output against criteria', async () => {
      const result = await reflection.evaluate(
        'TypeScript is a typed superset of JavaScript.',
        'Explain TypeScript',
      );

      expect(result).toBeDefined();
      expect(result.score).toBe(0.85);
      expect(result.passed).toBe(true); // 0.85 >= 0.7 threshold
      expect(result.criteria.length).toBe(3);
      expect(result.reasoning).toContain('well-written');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should return passed=false when score is below threshold', async () => {
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [
          { name: 'accuracy', score: 0.4, feedback: 'Inaccurate' },
        ],
        overallScore: 0.4,
        reasoning: 'Low quality',
        suggestions: ['Improve accuracy'],
      }));

      const result = await reflection.evaluate('Bad output', 'Goal');
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.4);
    });

    it('should handle unparseable LLM responses gracefully', async () => {
      mockProvider.setDefaultResponse('This is not JSON at all.');

      const result = await reflection.evaluate('Some output', 'Goal');
      expect(result).toBeDefined();
      expect(result.score).toBe(0.5); // Fallback score
      expect(result.passed).toBe(false);
    });

    it('should clamp out-of-range scores to [0.0, 1.0]', async () => {
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [
          { name: 'accuracy', score: 1.5, feedback: 'Over 1.0' },
          { name: 'clarity', score: -0.3, feedback: 'Under 0.0' },
        ],
        overallScore: 2.0,
        reasoning: 'Out of range',
        suggestions: [],
      }));

      const result = await reflection.evaluate('Output', 'Goal');
      expect(result.score).toBe(1.0); // Clamped from 2.0
      expect(result.criteria[0].score).toBe(1.0); // Clamped from 1.5
      expect(result.criteria[1].score).toBe(0.0); // Clamped from -0.3
    });
  });

  describe('reflect()', () => {
    it('should pass without revision when quality is good', async () => {
      const result = await reflection.reflect(
        'Great output here.',
        'Write something great',
      );

      expect(result).toBeDefined();
      expect(result.evaluation.passed).toBe(true);
      expect(result.revisedOutput).toBeUndefined(); // No revision needed
      expect(result.iterationCount).toBe(1);
    });

    it('should revise when quality is below threshold', async () => {
      let callCount = 0;
      mockProvider.setDefaultResponse(''); // Clear

      // Override: 1st call = low score eval, 2nd = revision text, 3rd = re-eval high score
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          // First evaluation — low score
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.3, feedback: 'Wrong' }],
              overallScore: 0.3,
              reasoning: 'Needs improvement',
              suggestions: ['Fix facts'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          // Revision
          return {
            content: 'This is the revised and improved output.',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        // Post-revision evaluation — high score (passes threshold)
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.9, feedback: 'Good' }],
            overallScore: 0.9,
            reasoning: 'Much better',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };

      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const result = await reflection.reflect('Bad output', 'Goal');

      expect(result.iterationCount).toBeGreaterThan(1);
      expect(result.revisedOutput).toBeDefined();
    });

    it('should emit reflection events', async () => {
      const events: string[] = [];
      eventBus.subscribe(['reflection.*'], (evt) => {
        events.push(evt.eventType);
      });

      await reflection.reflect('Output', 'Goal');

      expect(events).toContain('reflection.started');
      expect(events).toContain('reflection.evaluated');
      expect(events).toContain('reflection.completed');
    });

    it('should respect maxIterations', async () => {
      // Always return low score so it keeps trying
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [{ name: 'accuracy', score: 0.1, feedback: 'Bad' }],
        overallScore: 0.1,
        reasoning: 'Very poor',
        suggestions: ['Redo everything'],
      }));

      const limitedReflection = new SelfReflection(eventBus, modelRouter, {
        maxIterations: 2,
        threshold: 0.9,
      });

      const result = await limitedReflection.reflect('Output', 'Goal');
      expect(result.iterationCount).toBeLessThanOrEqual(2);
    });
  });

  // ─── Task 10.2: Configurable Threshold (default: 0.7) ─────────

  describe('configurable threshold', () => {
    it('should use default threshold of 0.7', () => {
      const defaultReflection = new SelfReflection(eventBus, modelRouter);
      expect(defaultReflection.threshold).toBe(0.7);
    });

    it('should trigger regeneration when score is below threshold', async () => {
      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          // First evaluation — score below default threshold 0.7
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.5, feedback: 'Mediocre' }],
              overallScore: 0.5,
              reasoning: 'Below threshold',
              suggestions: ['Improve'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          // Revision attempt
          return {
            content: 'Improved output',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        // Post-revision evaluation — passes threshold
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.8, feedback: 'Good' }],
            overallScore: 0.8,
            reasoning: 'Passes',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const result = await reflection.reflect('Initial output', 'Goal');
      expect(result.revisedOutput).toBeDefined();
      expect(result.iterationCount).toBe(2);
    });

    it('should NOT trigger regeneration when score is at or above threshold', async () => {
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [{ name: 'accuracy', score: 0.7, feedback: 'Fine' }],
        overallScore: 0.7,
        reasoning: 'Exactly at threshold',
        suggestions: [],
      }));

      const result = await reflection.reflect('Good enough output', 'Goal');
      expect(result.revisedOutput).toBeUndefined();
      expect(result.iterationCount).toBe(1);
    });

    it('should respect custom threshold configuration', async () => {
      // High threshold: 0.9
      const strictReflection = new SelfReflection(eventBus, modelRouter, { threshold: 0.9 });
      expect(strictReflection.threshold).toBe(0.9);

      // score 0.85 is below 0.9 → should trigger regeneration
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [{ name: 'accuracy', score: 0.85, feedback: 'Good but not great' }],
        overallScore: 0.85,
        reasoning: 'Below strict threshold',
        suggestions: ['Polish more'],
      }));

      const result = await strictReflection.reflect('Output', 'Goal');
      // With maxAttempts=2 and never passing (always 0.85 < 0.9), it should regenerate
      expect(result.iterationCount).toBeGreaterThan(1);
    });
  });

  // ─── Task 10.3: Max Regeneration Limit (default: 2) ───────────

  describe('max regeneration limit', () => {
    it('should use default maxAttempts of 2', () => {
      const defaultReflection = new SelfReflection(eventBus, modelRouter);
      expect(defaultReflection.maxAttempts).toBe(2);
    });

    it('should stop at max regeneration limit even if score stays below threshold', async () => {
      // Always return low score
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [{ name: 'accuracy', score: 0.1, feedback: 'Bad' }],
        overallScore: 0.1,
        reasoning: 'Terrible',
        suggestions: ['Everything'],
      }));

      const result = await reflection.reflect('Bad output', 'Goal');

      // maxAttempts=2 means: 1 initial eval + 2 regenerations = 3 total passes max
      // iterationCount = regenerationCount + 1
      expect(result.iterationCount).toBeLessThanOrEqual(3);
      // It should have attempted to regenerate
      expect(result.revisedOutput).toBeDefined();
    });

    it('should respect custom maxAttempts configuration', async () => {
      const singleAttemptReflection = new SelfReflection(eventBus, modelRouter, {
        maxAttempts: 1,
        threshold: 0.9,
      });
      expect(singleAttemptReflection.maxAttempts).toBe(1);

      // Always return low score
      let evaluateCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        evaluateCount++;
        // Alternate: evaluation returns low score, revision returns text
        if (evaluateCount % 2 === 1) {
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.2, feedback: 'Bad' }],
              overallScore: 0.2,
              reasoning: 'Low',
              suggestions: ['Fix'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        return {
          content: 'Revised output',
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const result = await singleAttemptReflection.reflect('Bad', 'Goal');
      // maxAttempts=1 → only 1 regeneration allowed → iterationCount = 2 max
      expect(result.iterationCount).toBeLessThanOrEqual(2);
    });
  });

  // ─── Task 10.4: Emit reflection.regenerated Event ──────────────

  describe('reflection.regenerated event', () => {
    it('should emit reflection.regenerated when regeneration occurs', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.3, feedback: 'Bad' }],
              overallScore: 0.3,
              reasoning: 'Poor',
              suggestions: ['Fix'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          return {
            content: 'Revised output',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.9, feedback: 'Good' }],
            overallScore: 0.9,
            reasoning: 'Better',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      await reflection.reflect('Bad output', 'Goal');

      expect(regeneratedEvents.length).toBeGreaterThan(0);
      const evt = regeneratedEvents[0];
      expect(evt.data).toHaveProperty('originalScore');
      expect(evt.data).toHaveProperty('newScore');
      expect(evt.data).toHaveProperty('attempt');
      expect(evt.data).toHaveProperty('regenerated', true);
    });

    it('should include agentId in regenerated event when provided', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.4, feedback: 'Bad' }],
              overallScore: 0.4,
              reasoning: 'Low',
              suggestions: ['Fix'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          return {
            content: 'Better output',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.85, feedback: 'Good' }],
            overallScore: 0.85,
            reasoning: 'Better now',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      await reflection.reflect('Bad output', 'Goal', undefined, 'my-agent-123');

      expect(regeneratedEvents.length).toBeGreaterThan(0);
      const evt = regeneratedEvents[0];
      expect(evt.data!['agentId']).toBe('my-agent-123');
      expect(evt.data!['regenerated']).toBe(true);
    });

    it('should include original and new scores in regenerated event', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.4, feedback: 'Bad' }],
              overallScore: 0.4,
              reasoning: 'Low',
              suggestions: ['Fix'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          return {
            content: 'Better output',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.85, feedback: 'Good' }],
            overallScore: 0.85,
            reasoning: 'Better now',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      await reflection.reflect('Bad output', 'Goal');

      const evt = regeneratedEvents[0];
      expect(evt.data!['originalScore']).toBe(0.4);
      expect(evt.data!['newScore']).toBe(0.85);
    });

    it('should include maxReached=true when max regeneration limit is hit', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      // Always return low score so it exhausts maxAttempts
      const completeMock = async (..._args: unknown[]) => {
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.2, feedback: 'Bad' }],
            overallScore: 0.2,
            reasoning: 'Still bad',
            suggestions: ['Fix'],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const limitedReflection = new SelfReflection(eventBus, modelRouter, {
        maxAttempts: 1,
        threshold: 0.9,
      });

      await limitedReflection.reflect('Bad output', 'Goal', undefined, 'agent-x');

      // Last regenerated event should have maxReached=true
      const lastEvt = regeneratedEvents[regeneratedEvents.length - 1];
      expect(lastEvt.data!['maxReached']).toBe(true);
      expect(lastEvt.data!['agentId']).toBe('agent-x');
    });

    it('should NOT emit reflection.regenerated when no regeneration occurs', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      // Score above threshold → no regeneration
      mockProvider.setDefaultResponse(JSON.stringify({
        criteria: [{ name: 'accuracy', score: 0.9, feedback: 'Good' }],
        overallScore: 0.9,
        reasoning: 'Great',
        suggestions: [],
      }));

      await reflection.reflect('Good output', 'Goal');

      expect(regeneratedEvents.length).toBe(0);
    });
  });

  // ─── Task 10.5: Per-Agent and Global Configuration ─────────────

  describe('per-agent and global reflection config', () => {
    it('should respect enabled=false to disable reflection', async () => {
      const disabledReflection = new SelfReflection(eventBus, modelRouter, {
        enabled: false,
      });
      expect(disabledReflection.enabled).toBe(false);

      const result = await disabledReflection.reflect('Output', 'Goal');
      // When disabled, should pass through without evaluation
      expect(result.evaluation.passed).toBe(true);
      expect(result.evaluation.score).toBe(1.0);
      expect(result.iterationCount).toBe(0);
    });

    it('should default to enabled=true', () => {
      const defaultReflection = new SelfReflection(eventBus, modelRouter);
      expect(defaultReflection.enabled).toBe(true);
    });

    it('should apply per-agent config overrides via withAgentConfig', () => {
      const globalReflection = new SelfReflection(eventBus, modelRouter, {
        threshold: 0.7,
        maxAttempts: 2,
      });

      const agentReflection = globalReflection.withAgentConfig({
        enabled: true,
        threshold: 0.9,
        maxAttempts: 1,
      });

      expect(agentReflection.threshold).toBe(0.9);
      expect(agentReflection.maxAttempts).toBe(1);
      expect(agentReflection.enabled).toBe(true);
    });

    it('should disable reflection via per-agent config', async () => {
      const globalReflection = new SelfReflection(eventBus, modelRouter, {
        enabled: true,
        threshold: 0.7,
      });

      const agentReflection = globalReflection.withAgentConfig({
        enabled: false,
      });

      expect(agentReflection.enabled).toBe(false);

      const result = await agentReflection.reflect('Output', 'Goal');
      expect(result.evaluation.passed).toBe(true);
      expect(result.iterationCount).toBe(0);
    });

    it('should return same instance if no agent config provided', () => {
      const globalReflection = new SelfReflection(eventBus, modelRouter);
      const same = globalReflection.withAgentConfig(undefined);
      expect(same).toBe(globalReflection);
    });
  });

  // ─── Task 10.7: Regeneration Triggered Below Threshold, Stops at Max Limit ──

  describe('regeneration triggered below threshold', () => {
    it('should trigger regeneration when score is 0.3 (below 0.7 threshold)', async () => {
      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          // Initial evaluation — score 0.3 (below 0.7)
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.3, feedback: 'Very inaccurate' }],
              overallScore: 0.3,
              reasoning: 'Far below threshold',
              suggestions: ['Rewrite completely'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          // Revision call — model is called to produce improved output
          return {
            content: 'Significantly improved output after revision.',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        // Re-evaluation after revision — score 0.85 (passes)
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.85, feedback: 'Much better' }],
            overallScore: 0.85,
            reasoning: 'Now passes threshold',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const result = await reflection.reflect('Poor quality output', 'Write a clear explanation');

      // Verify regeneration was triggered (model was called for revision)
      expect(callCount).toBe(3); // 1 eval + 1 revision + 1 re-eval
      expect(result.revisedOutput).toBe('Significantly improved output after revision.');
      expect(result.iterationCount).toBe(2); // 1 initial + 1 regeneration
    });

    it('should emit reflection.regenerated event with originalScore and newScore', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.3, feedback: 'Bad' }],
              overallScore: 0.3,
              reasoning: 'Low quality',
              suggestions: ['Improve'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        if (callCount === 2) {
          return {
            content: 'Revised output after regeneration.',
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.8, feedback: 'Good now' }],
            overallScore: 0.8,
            reasoning: 'Improved',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      await reflection.reflect('Bad output', 'Goal', undefined, 'test-agent');

      expect(regeneratedEvents.length).toBe(1);
      const evt = regeneratedEvents[0];
      expect(evt.data!['originalScore']).toBe(0.3);
      expect(evt.data!['newScore']).toBe(0.8);
      expect(evt.data!['attempt']).toBe(1);
      expect(evt.data!['agentId']).toBe('test-agent');
      expect(evt.data!['regenerated']).toBe(true);
    });
  });

  describe('stops at max limit', () => {
    it('should make only 2 regeneration attempts when maxAttempts=2 and score stays low', async () => {
      const regeneratedEvents: NexusEvent[] = [];
      eventBus.subscribe(['reflection.regenerated'], (evt) => {
        regeneratedEvents.push(evt);
      });

      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        // Odd calls are evaluations (always return low score 0.3)
        // Even calls are revisions (return revised text)
        const isEvaluation = callCount === 1 || callCount === 3 || callCount === 5;
        if (isEvaluation) {
          return {
            content: JSON.stringify({
              criteria: [{ name: 'accuracy', score: 0.3, feedback: 'Still bad' }],
              overallScore: 0.3,
              reasoning: 'Cannot improve',
              suggestions: ['Try harder'],
            }),
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        return {
          content: `Revised output attempt ${Math.floor(callCount / 2)}`,
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const limitedReflection = new SelfReflection(eventBus, modelRouter, {
        maxAttempts: 2,
        threshold: 0.7,
      });

      const result = await limitedReflection.reflect('Bad output', 'Goal', undefined, 'agent-max');

      // Verify only 2 regeneration attempts (not infinite)
      expect(regeneratedEvents.length).toBe(2);

      // Verify iterationCount is 3 (1 initial evaluation + 2 regenerations)
      expect(result.iterationCount).toBe(3);

      // Verify maxReached=true in the last regenerated event
      const lastEvt = regeneratedEvents[regeneratedEvents.length - 1];
      expect(lastEvt.data!['maxReached']).toBe(true);
      expect(lastEvt.data!['attempt']).toBe(2);
    });

    it('should not exceed maxAttempts even with persistent low scores', async () => {
      // Use a simple counter to track revision calls specifically
      let revisionCalls = 0;
      const completeMock = async (..._args: unknown[]) => {
        // Parse message content to determine if this is an eval or revision call
        const args = _args as [{ messages: { role: string; content: string }[] }];
        const lastMsg = args[0].messages[args[0].messages.length - 1].content;
        const isRevision = lastMsg.includes('Revise the following');

        if (isRevision) {
          revisionCalls++;
          return {
            content: `Attempt ${revisionCalls} revision`,
            model: 'mock', provider: 'mock',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            metadata: { latencyMs: 1, finishReason: 'stop' as const },
          };
        }
        // All evaluations return low score
        return {
          content: JSON.stringify({
            criteria: [{ name: 'accuracy', score: 0.3, feedback: 'Terrible' }],
            overallScore: 0.3,
            reasoning: 'Never good enough',
            suggestions: ['Keep trying'],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const limitedReflection = new SelfReflection(eventBus, modelRouter, {
        maxAttempts: 2,
        threshold: 0.7,
      });

      await limitedReflection.reflect('Bad output', 'Goal');

      // Verify exactly 2 revision calls (not more)
      expect(revisionCalls).toBe(2);
    });
  });

  describe('passes without regeneration', () => {
    it('should not regenerate when score is 0.9 (above threshold)', async () => {
      let callCount = 0;
      const completeMock = async (..._args: unknown[]) => {
        callCount++;
        return {
          content: JSON.stringify({
            criteria: [
              { name: 'accuracy', score: 0.9, feedback: 'Excellent accuracy' },
              { name: 'completeness', score: 0.92, feedback: 'Very complete' },
              { name: 'clarity', score: 0.88, feedback: 'Clear and readable' },
            ],
            overallScore: 0.9,
            reasoning: 'High quality output that meets all criteria',
            suggestions: [],
          }),
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const result = await reflection.reflect('Excellent output', 'Write clearly');

      // Verify no regeneration occurred
      expect(result.revisedOutput).toBeUndefined();
      expect(result.iterationCount).toBe(1); // Only initial evaluation
      expect(callCount).toBe(1); // Only one model call (evaluation), no revision
      expect(result.evaluation.passed).toBe(true);
      expect(result.evaluation.score).toBe(0.9);
    });
  });

  describe('disabled reflection returns pass-through', () => {
    it('should return immediately with score 1.0 and no model calls when disabled', async () => {
      let modelCalls = 0;
      const completeMock = async (..._args: unknown[]) => {
        modelCalls++;
        return {
          content: 'Should not be called',
          model: 'mock', provider: 'mock',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          metadata: { latencyMs: 1, finishReason: 'stop' as const },
        };
      };
      modelRouter.complete = completeMock as typeof modelRouter.complete;

      const disabledReflection = new SelfReflection(eventBus, modelRouter, {
        enabled: false,
      });

      const result = await disabledReflection.reflect('Any output', 'Any goal', 'context', 'agent-1');

      // Verify no model calls were made
      expect(modelCalls).toBe(0);

      // Verify pass-through result
      expect(result.evaluation.score).toBe(1.0);
      expect(result.evaluation.passed).toBe(true);
      expect(result.revisedOutput).toBeUndefined();
      expect(result.iterationCount).toBe(0);
      expect(result.originalOutput).toBe('Any output');
      expect(result.evaluation.reasoning).toBe('Reflection disabled');
    });
  });

  // ─── resolveReflectionConfig utility ───────────────────────────

  describe('resolveReflectionConfig()', () => {
    it('should return defaults when no global or agent config provided', () => {
      const result = resolveReflectionConfig(undefined, undefined);
      expect(result.enabled).toBe(true);
      expect(result.threshold).toBe(0.7);
      expect(result.maxAttempts).toBe(2);
    });

    it('should apply global config over defaults', () => {
      const result = resolveReflectionConfig(
        { enabled: false, threshold: 0.8, maxAttempts: 3 },
        undefined,
      );
      expect(result.enabled).toBe(false);
      expect(result.threshold).toBe(0.8);
      expect(result.maxAttempts).toBe(3);
    });

    it('should apply per-agent config over global config', () => {
      const result = resolveReflectionConfig(
        { enabled: false, threshold: 0.7, maxAttempts: 2 },
        { enabled: true, threshold: 0.9, maxAttempts: 1 },
      );
      expect(result.enabled).toBe(true);  // agent overrides global
      expect(result.threshold).toBe(0.9);
      expect(result.maxAttempts).toBe(1);
    });

    it('should allow per-agent to enable reflection even when globally disabled', () => {
      const result = resolveReflectionConfig(
        { enabled: false },
        { enabled: true },
      );
      expect(result.enabled).toBe(true);
    });

    it('should allow per-agent to disable reflection even when globally enabled', () => {
      const result = resolveReflectionConfig(
        { enabled: true },
        { enabled: false },
      );
      expect(result.enabled).toBe(false);
    });
  });
});
