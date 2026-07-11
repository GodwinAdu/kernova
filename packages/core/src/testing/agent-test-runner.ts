/**
 * Kernova Agent Test Runner
 *
 * Framework for testing agents with scenarios:
 * - Define test scenarios with input messages and expected behavior
 * - Run scenarios against a real or mock kernel
 * - Assert on responses, tool calls, timing, and patterns
 *
 * Designed to work with Vitest or any other test runner.
 * Use MockModelProvider for deterministic tests.
 */

import type {
  NexusId,
  TestScenario,
  TestResult,
  AssertionResult,
  ExpectedBehavior,
  ExpectedToolCall,
  TestMessage,
} from '@kernova/types';
import type { KernovaKernel } from '../kernel.js';
import { ConversationSimulator } from './conversation-simulator.js';
import { generateId, now } from '../utils.js';

export interface AgentTestRunnerConfig {
  /** Default timeout for scenarios in ms */
  defaultTimeout?: number;  // default: 30_000
  /** Whether to log scenario execution */
  verbose?: boolean;         // default: false
}

const DEFAULT_CONFIG: AgentTestRunnerConfig = {
  defaultTimeout: 30_000,
  verbose: false,
};

export class AgentTestRunner {
  private readonly kernel: KernovaKernel;
  private readonly simulator: ConversationSimulator;
  private readonly config: AgentTestRunnerConfig;
  private results: TestResult[] = [];

  constructor(kernel: KernovaKernel, config?: Partial<AgentTestRunnerConfig>) {
    this.kernel = kernel;
    this.simulator = new ConversationSimulator(kernel);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a single test scenario.
   */
  async run(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const timeout = scenario.timeout ?? this.config.defaultTimeout ?? 30_000;

    if (this.config.verbose) {
      console.log(`[AgentTest] Running: ${scenario.name}`);
    }

    try {
      // Simulate the conversation
      const simulation = await this.simulator.simulate(scenario.messages, { timeout });

      // Get the final response
      const lastTurn = simulation.turns[simulation.turns.length - 1];
      const response = lastTurn?.response ?? '';

      // Run assertions
      const assertions = this.runAssertions(response, simulation, scenario.expectedBehavior);
      const passed = assertions.every(a => a.passed);

      const result: TestResult = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passed,
        duration: Date.now() - startTime,
        assertions,
        response,
      };

      if (this.config.verbose) {
        const status = passed ? '✓' : '✗';
        console.log(`[AgentTest] ${status} ${scenario.name} (${result.duration}ms)`);
        if (!passed) {
          for (const a of assertions.filter(a => !a.passed)) {
            console.log(`  - FAIL: ${a.description} (expected: ${a.expected}, got: ${a.actual})`);
          }
        }
      }

      this.results.push(result);
      return result;
    } catch (error) {
      const result: TestResult = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passed: false,
        duration: Date.now() - startTime,
        assertions: [{
          description: 'Scenario execution did not throw',
          passed: false,
          expected: 'no error',
          actual: error instanceof Error ? error.message : String(error),
        }],
        error: error instanceof Error ? error.message : String(error),
      };

      this.results.push(result);
      return result;
    }
  }

  /**
   * Run multiple scenarios sequentially.
   */
  async runAll(scenarios: TestScenario[]): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (const scenario of scenarios) {
      results.push(await this.run(scenario));
    }
    return results;
  }

  /**
   * Get a summary of all executed tests.
   */
  getSummary(): { total: number; passed: number; failed: number; results: TestResult[] } {
    const passed = this.results.filter(r => r.passed).length;
    return {
      total: this.results.length,
      passed,
      failed: this.results.length - passed,
      results: [...this.results],
    };
  }

  /**
   * Clear all previous results.
   */
  clearResults(): void {
    this.results = [];
  }

  /**
   * Helper: Create a test scenario from minimal input.
   */
  static scenario(
    name: string,
    messages: string | string[],
    expected: Partial<ExpectedBehavior>,
  ): TestScenario {
    const messageArray = Array.isArray(messages) ? messages : [messages];
    return {
      id: generateId('test'),
      name,
      description: name,
      messages: messageArray.map(content => ({ role: 'user' as const, content })),
      expectedBehavior: {
        shouldContain: expected.shouldContain,
        shouldNotContain: expected.shouldNotContain,
        toolCalls: expected.toolCalls,
        maxDurationMs: expected.maxDurationMs,
        validator: expected.validator,
      },
    };
  }

  // ─── Private ───────────────────────────────────────────────

  private runAssertions(
    response: string,
    simulation: { turns: Array<{ response?: string; durationMs: number; error?: string }> ; totalDurationMs: number },
    expected: ExpectedBehavior,
  ): AssertionResult[] {
    const assertions: AssertionResult[] = [];

    // shouldContain checks
    if (expected.shouldContain) {
      for (const pattern of expected.shouldContain) {
        const regex = this.patternToRegex(pattern);
        assertions.push({
          description: `Response should contain: "${pattern}"`,
          passed: regex.test(response),
          expected: pattern,
          actual: response.slice(0, 200),
        });
      }
    }

    // shouldNotContain checks
    if (expected.shouldNotContain) {
      for (const pattern of expected.shouldNotContain) {
        const regex = this.patternToRegex(pattern);
        assertions.push({
          description: `Response should NOT contain: "${pattern}"`,
          passed: !regex.test(response),
          expected: `not "${pattern}"`,
          actual: regex.test(response) ? `found "${pattern}"` : 'not found',
        });
      }
    }

    // maxDurationMs check
    if (expected.maxDurationMs) {
      assertions.push({
        description: `Response within time budget (${expected.maxDurationMs}ms)`,
        passed: simulation.totalDurationMs <= expected.maxDurationMs,
        expected: `≤ ${expected.maxDurationMs}ms`,
        actual: `${simulation.totalDurationMs}ms`,
      });
    }

    // If no specific assertions were configured, at least check the response isn't empty
    if (assertions.length === 0) {
      assertions.push({
        description: 'Response is non-empty',
        passed: response.length > 0,
        expected: 'non-empty response',
        actual: response.length > 0 ? `${response.length} chars` : 'empty',
      });
    }

    return assertions;
  }

  /**
   * Convert a pattern string to a regex.
   * Supports plain text (case-insensitive substring) or /regex/ syntax.
   */
  private patternToRegex(pattern: string): RegExp {
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      return new RegExp(pattern.slice(1, -1), 'i');
    }
    // Escape regex special chars for plain text matching
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }
}
