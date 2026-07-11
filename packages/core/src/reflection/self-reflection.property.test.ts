/**
 * Property-Based Tests for Self-Reflection Module
 *
 * Property 10: For all responses evaluated by the reflection module,
 * the assigned confidence score SHALL be in the range [0.0, 1.0].
 *
 * **Validates: Requirements 10.2**
 *
 * Uses fast-check to generate arbitrary score values (including out-of-range)
 * and verify the module always clamps to the valid range.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { SelfReflection, clampConfidence } from './self-reflection.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';

// ─── Arbitraries ────────────────────────────────────────────

/** Generate any number including edge cases (NaN, Infinity, negatives, >1) */
const anyScoreArb = fc.oneof(
  fc.double({ min: -1000, max: 1000, noNaN: false }),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.double({ min: 0, max: 1 }), // Valid range
  fc.double({ min: 1.001, max: 100 }), // Above valid range
  fc.double({ min: -100, max: -0.001 }), // Below valid range
);

/** Generate a valid criteria name */
const criterionNameArb = fc.stringMatching(/^[a-z]{3,15}$/);

/** Generate an array of criteria with arbitrary scores */
const criteriaArb = fc.array(
  fc.record({
    name: criterionNameArb,
    score: anyScoreArb,
    feedback: fc.string({ minLength: 1, maxLength: 50 }),
  }),
  { minLength: 1, maxLength: 5 },
);

/** Generate a complete evaluation JSON response with arbitrary scores */
const evaluationResponseArb = fc.record({
  criteria: criteriaArb,
  overallScore: anyScoreArb,
  reasoning: fc.string({ minLength: 1, maxLength: 100 }),
  suggestions: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
});

// ─── Property 10: Self-Reflection Confidence Score Range ────
// **Validates: Requirements 10.2**
//
// For all responses evaluated by the reflection module,
// the assigned confidence score SHALL be in the range [0.0, 1.0].

describe('Property 10: Self-Reflection Confidence Score Range', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;
  let mockProvider: MockModelProvider;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();

    mockProvider = new MockModelProvider({
      defaultResponse: JSON.stringify({
        criteria: [{ name: 'accuracy', score: 0.8, feedback: 'Good' }],
        overallScore: 0.8,
        reasoning: 'Fine',
        suggestions: [],
      }),
    });

    modelRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [mockProvider],
      eventBus,
    });
  });

  it('clampConfidence always returns a value in [0.0, 1.0] for any input', () => {
    fc.assert(
      fc.property(anyScoreArb, (score) => {
        const clamped = clampConfidence(score);
        expect(clamped).toBeGreaterThanOrEqual(0.0);
        expect(clamped).toBeLessThanOrEqual(1.0);
        expect(Number.isFinite(clamped)).toBe(true);
        expect(Number.isNaN(clamped)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('evaluate() always returns confidence score in [0.0, 1.0] regardless of model output', async () => {
    await fc.assert(
      fc.asyncProperty(evaluationResponseArb, async (evalResponse) => {
        // Set mock to return the arbitrary evaluation response
        mockProvider.setDefaultResponse(JSON.stringify(evalResponse));

        const reflection = new SelfReflection(eventBus, modelRouter);
        const result = await reflection.evaluate('Some output', 'Some goal');

        // Overall score must be in [0, 1]
        expect(result.score).toBeGreaterThanOrEqual(0.0);
        expect(result.score).toBeLessThanOrEqual(1.0);
        expect(Number.isFinite(result.score)).toBe(true);

        // Each criterion score must be in [0, 1]
        for (const criterion of result.criteria) {
          expect(criterion.score).toBeGreaterThanOrEqual(0.0);
          expect(criterion.score).toBeLessThanOrEqual(1.0);
          expect(Number.isFinite(criterion.score)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('evaluate() returns score in [0.0, 1.0] even for unparseable model responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 500 }),
        async (arbitraryResponse) => {
          mockProvider.setDefaultResponse(arbitraryResponse);

          const reflection = new SelfReflection(eventBus, modelRouter);
          const result = await reflection.evaluate('Output', 'Goal');

          // Regardless of what the model returns, score must be in [0, 1]
          expect(result.score).toBeGreaterThanOrEqual(0.0);
          expect(result.score).toBeLessThanOrEqual(1.0);
          expect(Number.isFinite(result.score)).toBe(true);

          for (const criterion of result.criteria) {
            expect(criterion.score).toBeGreaterThanOrEqual(0.0);
            expect(criterion.score).toBeLessThanOrEqual(1.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reflect() always yields a final score in [0.0, 1.0] regardless of model behavior', async () => {
    await fc.assert(
      fc.asyncProperty(evaluationResponseArb, async (evalResponse) => {
        mockProvider.setDefaultResponse(JSON.stringify(evalResponse));

        const reflection = new SelfReflection(eventBus, modelRouter, {
          threshold: 0.99, // High threshold to force regeneration attempts
          maxAttempts: 1,
        });

        const result = await reflection.reflect('Test output', 'Test goal');

        // Final evaluation score must be in [0, 1]
        expect(result.evaluation.score).toBeGreaterThanOrEqual(0.0);
        expect(result.evaluation.score).toBeLessThanOrEqual(1.0);
        expect(Number.isFinite(result.evaluation.score)).toBe(true);

        for (const criterion of result.evaluation.criteria) {
          expect(criterion.score).toBeGreaterThanOrEqual(0.0);
          expect(criterion.score).toBeLessThanOrEqual(1.0);
        }
      }),
      { numRuns: 50 },
    );
  });
});
