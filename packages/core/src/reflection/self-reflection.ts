/**
 * Kernova Self-Reflection Module
 *
 * Enables agents to evaluate their own output against criteria,
 * then optionally revise the output if quality is below threshold.
 *
 * Pattern inspired by OpenClaw's compaction-planning where the LLM
 * evaluates and iteratively improves its own work.
 *
 * Flow:
 * 1. Agent produces output
 * 2. Self-reflection evaluates output against criteria
 * 3. If score < threshold and iterations remain, ask LLM to revise
 * 4. Repeat until quality passes or max iterations reached
 *
 * Configuration:
 * - Per-agent: agent definition can include `reflection` config
 * - Global: KernelConfig gains `reflection` config
 * - Per-agent config overrides global config
 */

import type {
  KernovaId,
  KernovaEvent,
  ReflectionResult,
  ReflectionEvaluation,
  ReflectionCriterion,
  ReflectionConfig,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { ModelRouter } from '../models/model-router.js';
import { generateId, now } from '../utils.js';

/**
 * Configuration for enabling/disabling reflection at per-agent or global level.
 */
export interface ReflectionToggleConfig {
  /** Whether reflection is enabled */
  enabled: boolean;
  /** Minimum confidence score threshold (default: 0.7) */
  threshold?: number;
  /** Maximum regeneration attempts (default: 2) */
  maxAttempts?: number;
}

export interface SelfReflectionConfig {
  /** Confidence score threshold — regenerate if below (default: 0.7) */
  threshold: number;
  /** Maximum regeneration attempts to prevent infinite loops (default: 2) */
  maxAttempts: number;
  /** Maximum total iterations including initial evaluation (legacy compat) */
  maxIterations: number;
  /** Criteria to evaluate against */
  criteria: string[];
  /** Custom evaluation prompt */
  evaluationPrompt?: string;
  /** Model purpose key for reflection call */
  modelPurpose?: string;
  /** Whether reflection is enabled (default: true) */
  enabled: boolean;
}

const DEFAULT_CONFIG: SelfReflectionConfig = {
  threshold: 0.7,
  maxAttempts: 2,
  maxIterations: 3,
  criteria: ['accuracy', 'completeness', 'clarity'],
  enabled: true,
};

/**
 * Clamp a confidence score to the valid [0.0, 1.0] range.
 * Handles NaN, Infinity, and out-of-range values.
 */
export function clampConfidence(score: number): number {
  if (typeof score !== 'number' || isNaN(score)) {
    return 0.0;
  }
  return Math.max(0.0, Math.min(1.0, score));
}

/**
 * Resolve effective reflection config by merging global config with per-agent overrides.
 * Per-agent config takes precedence over global config.
 *
 * Resolution rules:
 * - If global `enabled` is false and agent doesn't specify, reflection is off.
 * - If agent specifies `enabled: true`, it overrides global disable.
 * - If agent specifies `enabled: false`, it overrides global enable.
 * - Threshold and maxAttempts from agent override global values when specified.
 */
export function resolveReflectionConfig(
  globalConfig?: ReflectionToggleConfig,
  agentConfig?: ReflectionToggleConfig,
): ReflectionToggleConfig {
  // Start with defaults
  const base: ReflectionToggleConfig = {
    enabled: true,
    threshold: DEFAULT_CONFIG.threshold,
    maxAttempts: DEFAULT_CONFIG.maxAttempts,
  };

  // Apply global config
  if (globalConfig) {
    base.enabled = globalConfig.enabled;
    if (globalConfig.threshold !== undefined) base.threshold = globalConfig.threshold;
    if (globalConfig.maxAttempts !== undefined) base.maxAttempts = globalConfig.maxAttempts;
  }

  // Apply per-agent overrides (takes precedence)
  if (agentConfig) {
    base.enabled = agentConfig.enabled;
    if (agentConfig.threshold !== undefined) base.threshold = agentConfig.threshold;
    if (agentConfig.maxAttempts !== undefined) base.maxAttempts = agentConfig.maxAttempts;
  }

  return base;
}

export class SelfReflection {
  private readonly eventBus: EventBus;
  private readonly modelRouter: ModelRouter;
  private readonly config: SelfReflectionConfig;

  constructor(eventBus: EventBus, modelRouter: ModelRouter, config?: Partial<ReflectionConfig & ReflectionToggleConfig>) {
    this.eventBus = eventBus;
    this.modelRouter = modelRouter;

    // Merge config with defaults, mapping maxAttempts to maxIterations for compat.
    // Undefined values are dropped so they can't erase a default (a missing threshold
    // would otherwise make every evaluation fail).
    config = config && Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
    const merged = { ...DEFAULT_CONFIG, ...config };
    if (config?.maxAttempts !== undefined && config?.maxIterations === undefined) {
      // maxAttempts = number of regeneration attempts (not counting initial eval)
      // maxIterations = total passes (initial eval + regeneration attempts)
      merged.maxIterations = config.maxAttempts + 1;
    } else if (config?.maxIterations !== undefined && config?.maxAttempts === undefined) {
      // Legacy: maxIterations specified → derive maxAttempts
      merged.maxAttempts = Math.max(0, config.maxIterations - 1);
    }
    this.config = merged;
  }

  /**
   * Whether reflection is enabled in this instance's configuration.
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the configured threshold.
   */
  get threshold(): number {
    return this.config.threshold;
  }

  /**
   * Get the maximum regeneration attempts (not counting initial evaluation).
   */
  get maxAttempts(): number {
    return this.config.maxAttempts;
  }

  /**
   * Create a new SelfReflection instance with per-agent overrides applied.
   * Per-agent config takes precedence over the current (global) config.
   */
  withAgentConfig(agentReflectionConfig?: ReflectionToggleConfig): SelfReflection {
    if (!agentReflectionConfig) return this;

    const overrides: Partial<ReflectionConfig & ReflectionToggleConfig> = {
      ...this.config,
      enabled: agentReflectionConfig.enabled,
    };
    if (agentReflectionConfig.threshold !== undefined) {
      overrides.threshold = agentReflectionConfig.threshold;
    }
    if (agentReflectionConfig.maxAttempts !== undefined) {
      overrides.maxAttempts = agentReflectionConfig.maxAttempts;
    }

    return new SelfReflection(this.eventBus, this.modelRouter, overrides);
  }

  /**
   * Reflect on an output: evaluate it, and optionally revise until quality passes.
   *
   * This method implements the full regeneration cycle:
   * 1. Evaluate the output against configured criteria
   * 2. If score < threshold, regenerate with context about deficiencies
   * 3. Repeat up to maxAttempts times
   * 4. Accept best response if still below threshold after maxAttempts
   *
   * Emits `reflection.regenerated` event on each regeneration with:
   * - originalScore: the score before regeneration
   * - newScore: the score after regeneration
   * - attempt: the regeneration attempt number (1-based)
   * - agentId: the agent that produced the output
   * - regenerated: true
   * - maxReached: true if this is the final attempt (maxAttempts reached)
   *
   * @param output - The agent's original output to evaluate
   * @param goal - The original goal/prompt that produced the output
   * @param context - Optional additional context
   * @param agentId - Optional agent identifier for event correlation
   * @returns ReflectionResult with evaluation and possible revision
   */
  async reflect(
    output: string,
    goal: string,
    context?: string,
    agentId?: string,
  ): Promise<ReflectionResult> {
    // If reflection is disabled, return pass-through result
    if (!this.config.enabled) {
      return {
        id: generateId('refl'),
        intentId: generateId('intent'),
        originalOutput: output,
        evaluation: {
          score: clampConfidence(1.0),
          passed: true,
          criteria: [],
          reasoning: 'Reflection disabled',
          suggestions: [],
        },
        revisedOutput: undefined,
        reflectedAt: now(),
        iterationCount: 0,
      };
    }

    const reflectionId = generateId('refl');
    const effectiveAgentId = agentId || 'unknown';
    let currentOutput = output;
    let regenerationCount = 0;
    let evaluation: ReflectionEvaluation | null = null;
    let bestOutput = output;
    let bestScore = -1;

    this.emitEvent('reflection.started', reflectionId, {
      goal,
      agentId: effectiveAgentId,
      outputLength: output.length,
      criteria: this.config.criteria,
      threshold: this.config.threshold,
      maxAttempts: this.config.maxAttempts,
    });

    // Initial evaluation
    evaluation = await this.evaluate(currentOutput, goal, context);

    this.emitEvent('reflection.evaluated', reflectionId, {
      iteration: 1,
      score: evaluation.score,
      passed: evaluation.passed,
      agentId: effectiveAgentId,
      criteria: evaluation.criteria.map(c => ({ name: c.name, score: c.score })),
    });

    // Track the best response seen so far
    bestScore = evaluation.score;
    bestOutput = currentOutput;

    // Regeneration loop: up to maxAttempts times
    while (!evaluation.passed && regenerationCount < this.config.maxAttempts) {
      // Regenerate: revise the output
      const scoreBeforeRegeneration = evaluation.score;
      currentOutput = await this.revise(currentOutput, goal, evaluation, context);
      regenerationCount++;

      // Re-evaluate the regenerated output
      evaluation = await this.evaluate(currentOutput, goal, context);
      const newScore = evaluation.score;

      this.emitEvent('reflection.evaluated', reflectionId, {
        iteration: regenerationCount + 1,
        score: evaluation.score,
        passed: evaluation.passed,
        agentId: effectiveAgentId,
        criteria: evaluation.criteria.map(c => ({ name: c.name, score: c.score })),
      });

      // Track the best response (use >= to prefer latest output on tie)
      if (newScore >= bestScore) {
        bestScore = newScore;
        bestOutput = currentOutput;
      }

      // Emit reflection.regenerated event with both scores
      const isMaxReached = regenerationCount >= this.config.maxAttempts;
      this.emitEvent('reflection.regenerated', reflectionId, {
        originalScore: scoreBeforeRegeneration,
        newScore,
        attempt: regenerationCount,
        agentId: effectiveAgentId,
        regenerated: true,
        maxReached: isMaxReached,
      });
    }

    // After all attempts, use the best output found
    if (!evaluation!.passed && bestOutput !== currentOutput) {
      currentOutput = bestOutput;
      // Re-evaluate the best output to get accurate final evaluation
      evaluation = await this.evaluate(currentOutput, goal, context);
    }

    const result: ReflectionResult = {
      id: reflectionId,
      intentId: generateId('intent'), // Caller can override
      originalOutput: output,
      evaluation: evaluation!,
      revisedOutput: currentOutput !== output ? currentOutput : undefined,
      reflectedAt: now(),
      iterationCount: regenerationCount + 1, // Total passes (1 initial + regenerations)
    };

    this.emitEvent('reflection.completed', reflectionId, {
      passed: evaluation!.passed,
      finalScore: evaluation!.score,
      iterations: regenerationCount + 1,
      wasRevised: currentOutput !== output,
      regenerationCount,
      agentId: effectiveAgentId,
      bestScore,
    });

    return result;
  }

  /**
   * Evaluate a single output without revision loop.
   * Useful for scoring/grading without modifying the output.
   * Confidence score is always clamped to [0.0, 1.0].
   */
  async evaluate(
    output: string,
    goal: string,
    context?: string,
  ): Promise<ReflectionEvaluation> {
    const criteriaList = this.config.criteria.join(', ');
    const contextBlock = context ? `\nContext: ${context}` : '';

    const prompt = this.config.evaluationPrompt || `You are a quality evaluator. Evaluate the following output against these criteria: ${criteriaList}.

Goal: ${goal}${contextBlock}

Output to evaluate:
"""
${output}
"""

Score each criterion from 0.0 to 1.0 and provide brief feedback.
Then provide an overall score (0.0–1.0), reasoning, and suggestions for improvement.

Respond in JSON format:
{
  "criteria": [
    { "name": "criterion_name", "score": 0.0, "feedback": "..." }
  ],
  "overallScore": 0.0,
  "reasoning": "...",
  "suggestions": ["suggestion 1", "suggestion 2"]
}

Respond ONLY with the JSON object.`;

    const response = await this.modelRouter.complete({
      messages: [{ role: 'user', content: prompt }],
      model: '',
      temperature: 0.2,
    }, this.config.modelPurpose as never);

    return this.parseEvaluation(response.content);
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Ask the LLM to revise the output based on evaluation feedback.
   */
  private async revise(
    output: string,
    goal: string,
    evaluation: ReflectionEvaluation,
    context?: string,
  ): Promise<string> {
    const feedbackLines = evaluation.criteria
      .filter((c: ReflectionCriterion) => c.score < this.config.threshold)
      .map((c: ReflectionCriterion) => `- ${c.name}: ${c.feedback} (score: ${c.score})`)
      .join('\n');

    const suggestions = evaluation.suggestions.join('\n- ');
    const contextBlock = context ? `\nContext: ${context}` : '';

    const prompt = `Revise the following output to address the feedback below.

Original goal: ${goal}${contextBlock}

Current output:
"""
${output}
"""

Feedback on issues:
${feedbackLines}

Suggestions:
- ${suggestions}

Provide the revised output only, no explanations or metadata.`;

    const response = await this.modelRouter.complete({
      messages: [{ role: 'user', content: prompt }],
      model: '',
      temperature: 0.4,
    }, this.config.modelPurpose as never);

    return response.content.trim();
  }

  /**
   * Parse LLM evaluation response into structured format.
   * All confidence scores are clamped to [0.0, 1.0] range.
   */
  private parseEvaluation(content: string): ReflectionEvaluation {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // The output could not be judged, so keep it: rewriting without feedback can only make it worse
      const fallbackScore = clampConfidence(0.5);
      return {
        score: fallbackScore,
        passed: true,
        criteria: this.config.criteria.map(name => ({
          name,
          score: fallbackScore,
          feedback: 'Could not parse evaluation',
        })),
        reasoning: 'Evaluation response could not be parsed',
        suggestions: ['Re-evaluate with clearer criteria'],
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      const criteria: ReflectionCriterion[] = (parsed.criteria || []).map((c: { name?: unknown; score?: unknown; feedback?: unknown }) => ({
        name: String(c.name || ''),
        score: clampConfidence(Number(c.score) || 0),
        feedback: String(c.feedback || ''),
      }));

      // Clamp the overall score to [0.0, 1.0]
      const overallScore = clampConfidence(Number(parsed.overallScore) || 0);

      return {
        score: overallScore,
        passed: overallScore >= this.config.threshold,
        criteria,
        reasoning: String(parsed.reasoning || ''),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
      };
    } catch {
      // Unparseable evaluation: keep the output (see above)
      const fallbackScore = clampConfidence(0.5);
      return {
        score: fallbackScore,
        passed: true,
        criteria: this.config.criteria.map(name => ({
          name,
          score: fallbackScore,
          feedback: 'Parse error',
        })),
        reasoning: 'Failed to parse evaluation JSON',
        suggestions: [],
      };
    }
  }

  /**
   * Emit a reflection event.
   */
  private emitEvent(eventType: string, subjectId: KernovaId, data: Record<string, unknown>): void {
    const event: KernovaEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'reflection',
      actorId: 'self-reflection',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'self-reflection',
        environment: 'runtime',
      },
    };
    this.eventBus.publish(event);
  }
}
