/**
 * defineLoop — Framework helper for agent loop configuration.
 *
 * Allows developers to enable looping behavior on agents:
 *   - Agent keeps working until goal is fully achieved
 *   - Configurable max iterations, timeout, and completion threshold
 *   - Step-by-step audit trail
 *   - Tool calling within the loop
 *
 * Usage in agent definition:
 *   import { defineAgent } from '@kernova/framework';
 *
 *   export default defineAgent({
 *     name: 'Task Runner',
 *     instructions: '...',
 *     tools: ['gmail', 'calendar'],
 *     loop: {
 *       enabled: true,
 *       maxIterations: 15,
 *       timeout: 180000,  // 3 minutes
 *       completionThreshold: 0.85,
 *     },
 *   });
 *
 * When loop.enabled is true, the agent will:
 *   1. Receive the user's goal
 *   2. Plan and execute steps iteratively
 *   3. Call tools as needed
 *   4. Self-evaluate after each step
 *   5. Continue until goal is achieved or limits hit
 *   6. Return final result with full execution trace
 */

export interface AgentLoopConfig {
  /** Enable loop mode (default: false — agent responds in a single pass) */
  enabled: boolean;
  /** Maximum iterations per goal (default: 10) */
  maxIterations?: number;
  /** Maximum total execution time in ms (default: 120000 = 2 min) */
  timeout?: number;
  /** Confidence threshold to consider goal complete (default: 0.8) */
  completionThreshold?: number;
  /** Whether to stream intermediate steps to the client (default: true) */
  streamSteps?: boolean;
  /** Whether the loop can delegate to other agents (default: true) */
  allowDelegation?: boolean;
}

/**
 * Default loop configuration.
 */
export const DEFAULT_AGENT_LOOP: Required<AgentLoopConfig> = {
  enabled: false,
  maxIterations: 10,
  timeout: 120000,
  completionThreshold: 0.8,
  streamSteps: true,
  allowDelegation: true,
};

/**
 * Helper to create a typed loop config.
 */
export function defineLoop(config: AgentLoopConfig): Required<AgentLoopConfig> {
  return { ...DEFAULT_AGENT_LOOP, ...config };
}
