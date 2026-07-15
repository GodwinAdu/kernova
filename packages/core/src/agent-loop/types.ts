/**
 * Agent Loop Types — Persistent goal-oriented execution.
 *
 * An agent loop is a cycle where:
 *   1. Agent receives a goal
 *   2. Plans steps to achieve it
 *   3. Executes steps (calls tools, delegates, reasons)
 *   4. Evaluates: "Is the goal complete?"
 *   5. If NO → plan next steps, loop back to 3
 *   6. If YES → return final result
 *
 * Features:
 *   - Max iterations (prevent infinite loops)
 *   - Step-by-step reasoning trail
 *   - Tool call tracking
 *   - Self-evaluation after each step
 *   - Pause/resume capability
 *   - Timeout protection
 */

/** Status of a loop execution */
export type LoopStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'timeout' | 'max_iterations';

/** A single step in the agent loop */
export interface LoopStep {
  /** Step number (1-based) */
  index: number;
  /** What the agent decided to do */
  thought: string;
  /** Action taken (tool call, delegation, reasoning) */
  action: {
    type: 'tool_call' | 'delegate' | 'reason' | 'evaluate';
    tool?: string;
    params?: Record<string, unknown>;
    agent?: string;
    input?: string;
  };
  /** Result of the action */
  result: unknown;
  /** Agent's evaluation after this step */
  evaluation: {
    /** Is the overall goal complete? */
    goalComplete: boolean;
    /** Confidence in completion (0-1) */
    confidence: number;
    /** What remains to be done */
    remaining?: string;
    /** Next planned action */
    nextAction?: string;
  };
  /** Duration of this step in ms */
  durationMs: number;
  /** Timestamp */
  timestamp: string;
}

/** Configuration for an agent loop */
export interface LoopConfig {
  /** Maximum iterations before stopping (default: 10) */
  maxIterations: number;
  /** Maximum total duration in ms (default: 120000 = 2 min) */
  timeout: number;
  /** Minimum confidence required to consider goal complete (default: 0.8) */
  completionThreshold: number;
  /** Whether to stream intermediate steps (default: true) */
  streamSteps: boolean;
  /** Whether the loop can call tools (default: true) */
  allowTools: boolean;
  /** Whether the loop can delegate to other agents (default: true) */
  allowDelegation: boolean;
  /** Callback when a step completes */
  onStep?: (step: LoopStep) => void;
  /** Callback for progress updates */
  onProgress?: (progress: { step: number; total: number; status: string }) => void;
}

/** Default loop configuration */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterations: 10,
  timeout: 120000,
  completionThreshold: 0.8,
  streamSteps: true,
  allowTools: true,
  allowDelegation: true,
};

/** Result of a completed loop */
export interface LoopResult {
  /** Unique loop execution ID */
  id: string;
  /** The original goal */
  goal: string;
  /** Final status */
  status: LoopStatus;
  /** Final answer/output */
  result: string;
  /** All steps taken */
  steps: LoopStep[];
  /** Total iterations performed */
  iterations: number;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Tools used across all steps */
  toolsUsed: string[];
  /** Agents delegated to */
  agentsDelegated: string[];
  /** Whether the goal was achieved */
  goalAchieved: boolean;
  /** Final confidence */
  confidence: number;
  /** Reason for stopping (if not completed) */
  stopReason?: string;
}

/** Context passed to the loop's LLM for each iteration */
export interface LoopContext {
  /** The original goal */
  goal: string;
  /** Agent's name and instructions */
  agentName: string;
  agentInstructions: string;
  /** Available tools */
  availableTools: Array<{ name: string; description: string }>;
  /** Steps taken so far */
  previousSteps: LoopStep[];
  /** Current iteration number */
  currentIteration: number;
  /** Max iterations allowed */
  maxIterations: number;
  /** Working memory context */
  workingMemory?: Record<string, unknown>;
}
