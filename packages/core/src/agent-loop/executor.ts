/**
 * Agent Loop Executor — The core loop engine.
 *
 * Runs an agent in a goal-oriented loop:
 *   Think → Act → Evaluate → Repeat until done
 *
 * The loop uses structured prompts to make the LLM:
 *   1. Analyze what's been done so far
 *   2. Decide the next action (tool call, reasoning, or delegation)
 *   3. Evaluate if the goal is complete
 *   4. Plan next steps if not
 *
 * Safeguards:
 *   - Max iterations (prevents infinite loops)
 *   - Timeout (prevents runaway execution)
 *   - Completion threshold (requires confidence before stopping)
 *   - Step-by-step audit trail
 */

import type {
  LoopConfig,
  LoopResult,
  LoopStep,
  LoopContext,
  LoopStatus,
} from './types.js';
import { DEFAULT_LOOP_CONFIG } from './types.js';

export interface LoopExecutorDeps {
  /** Call the LLM with a prompt, get a response */
  complete: (prompt: string) => Promise<string>;
  /** Execute a tool by name with params */
  executeTool?: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Delegate to another agent */
  delegate?: (agentName: string, input: string) => Promise<string>;
}

/**
 * Execute an agent loop — keeps running until the goal is achieved or limits are hit.
 */
export async function executeLoop(
  goal: string,
  context: Omit<LoopContext, 'previousSteps' | 'currentIteration'>,
  deps: LoopExecutorDeps,
  config: Partial<LoopConfig> = {},
): Promise<LoopResult> {
  const cfg: LoopConfig = { ...DEFAULT_LOOP_CONFIG, ...config };
  const startTime = Date.now();
  const loopId = `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const steps: LoopStep[] = [];
  const toolsUsed = new Set<string>();
  const agentsDelegated = new Set<string>();
  let status: LoopStatus = 'running';
  let finalResult = '';
  let goalAchieved = false;
  let confidence = 0;
  let stopReason: string | undefined;

  for (let iteration = 1; iteration <= cfg.maxIterations; iteration++) {
    // Check timeout
    if (Date.now() - startTime > cfg.timeout) {
      status = 'timeout';
      stopReason = `Exceeded timeout of ${cfg.timeout}ms`;
      break;
    }

    // Report progress
    if (cfg.onProgress) {
      cfg.onProgress({ step: iteration, total: cfg.maxIterations, status: `Iteration ${iteration}/${cfg.maxIterations}` });
    }

    const stepStart = Date.now();

    // ─── THINK: Ask the LLM what to do next ──────────────────────────
    const thinkPrompt = buildThinkPrompt({
      ...context,
      goal,
      previousSteps: steps,
      currentIteration: iteration,
      maxIterations: cfg.maxIterations,
    });

    let thinkResponse: string;
    try {
      thinkResponse = await deps.complete(thinkPrompt);
    } catch (err: any) {
      status = 'failed';
      stopReason = `LLM call failed: ${err.message}`;
      break;
    }

    // ─── PARSE: Extract structured action from response ──────────────
    const parsed = parseLoopResponse(thinkResponse);

    // ─── ACT: Execute the decided action ─────────────────────────────
    let actionResult: unknown;

    if (parsed.action.type === 'tool_call' && parsed.action.tool && cfg.allowTools && deps.executeTool) {
      try {
        actionResult = await deps.executeTool(parsed.action.tool, parsed.action.params || {});
        toolsUsed.add(parsed.action.tool);
      } catch (err: any) {
        actionResult = { error: err.message };
      }
    } else if (parsed.action.type === 'delegate' && parsed.action.agent && cfg.allowDelegation && deps.delegate) {
      try {
        actionResult = await deps.delegate(parsed.action.agent, parsed.action.input || goal);
        agentsDelegated.add(parsed.action.agent);
      } catch (err: any) {
        actionResult = { error: err.message };
      }
    } else if (parsed.action.type === 'reason') {
      // Pure reasoning step — the thought IS the result
      actionResult = parsed.thought;
    } else if (parsed.action.type === 'evaluate') {
      // Evaluation-only step
      actionResult = parsed.thought;
    } else {
      actionResult = parsed.thought;
    }

    // ─── EVALUATE: Is the goal complete? ─────────────────────────────
    const step: LoopStep = {
      index: iteration,
      thought: parsed.thought,
      action: parsed.action,
      result: actionResult,
      evaluation: parsed.evaluation,
      durationMs: Date.now() - stepStart,
      timestamp: new Date().toISOString(),
    };

    steps.push(step);

    // Notify step callback
    if (cfg.onStep) {
      cfg.onStep(step);
    }

    // Check if goal is achieved
    if (parsed.evaluation.goalComplete && parsed.evaluation.confidence >= cfg.completionThreshold) {
      status = 'completed';
      goalAchieved = true;
      confidence = parsed.evaluation.confidence;
      finalResult = typeof actionResult === 'string' ? actionResult : parsed.thought;
      break;
    }

    confidence = parsed.evaluation.confidence;

    // If it's the last iteration, get a final summary
    if (iteration === cfg.maxIterations) {
      status = 'max_iterations';
      stopReason = `Reached maximum iterations (${cfg.maxIterations})`;
      finalResult = parsed.evaluation.remaining || parsed.thought;
    }
  }

  // If completed but no final result, generate one
  if (status === 'completed' && !finalResult) {
    try {
      const summaryPrompt = buildSummaryPrompt(goal, steps);
      finalResult = await deps.complete(summaryPrompt);
    } catch {
      finalResult = steps[steps.length - 1]?.thought || 'Goal completed.';
    }
  }

  return {
    id: loopId,
    goal,
    status,
    result: finalResult,
    steps,
    iterations: steps.length,
    totalDurationMs: Date.now() - startTime,
    toolsUsed: Array.from(toolsUsed),
    agentsDelegated: Array.from(agentsDelegated),
    goalAchieved,
    confidence,
    stopReason,
  };
}

// ─── Prompt Builders ─────────────────────────────────────────────────────────

function buildThinkPrompt(ctx: LoopContext): string {
  let prompt = `You are "${ctx.agentName}" working on a goal. You operate in a LOOP until the goal is fully achieved.

GOAL: ${ctx.goal}

AGENT INSTRUCTIONS:
${ctx.agentInstructions.slice(0, 2000)}

`;

  // Add available tools
  if (ctx.availableTools.length > 0) {
    prompt += `AVAILABLE TOOLS:\n`;
    for (const tool of ctx.availableTools.slice(0, 20)) {
      prompt += `  - ${tool.name}: ${tool.description.slice(0, 100)}\n`;
    }
    prompt += '\n';
  }

  // Add step history
  if (ctx.previousSteps.length > 0) {
    prompt += `STEPS COMPLETED SO FAR:\n`;
    for (const step of ctx.previousSteps.slice(-5)) { // Last 5 steps for context window
      prompt += `  Step ${step.index}: ${step.thought.slice(0, 200)}\n`;
      prompt += `    Action: ${step.action.type}${step.action.tool ? ` → ${step.action.tool}` : ''}\n`;
      const resultStr = typeof step.result === 'string' ? step.result.slice(0, 200) : JSON.stringify(step.result).slice(0, 200);
      prompt += `    Result: ${resultStr}\n`;
      prompt += `    Complete: ${step.evaluation.goalComplete} (${Math.round(step.evaluation.confidence * 100)}%)\n\n`;
    }
  }

  prompt += `ITERATION: ${ctx.currentIteration}/${ctx.maxIterations}

RESPOND IN THIS EXACT JSON FORMAT:
{
  "thought": "What I'm thinking / analyzing about the current state",
  "action": {
    "type": "tool_call" | "delegate" | "reason" | "evaluate",
    "tool": "tool-name (only if type is tool_call)",
    "params": { "param1": "value1" },
    "agent": "agent-name (only if type is delegate)",
    "input": "input for delegation"
  },
  "evaluation": {
    "goalComplete": true/false,
    "confidence": 0.0-1.0,
    "remaining": "what still needs to be done (if not complete)",
    "nextAction": "what I plan to do next (if not complete)"
  }
}

RULES:
- If the goal requires tool calls, use them. Don't just reason about what you WOULD do.
- Evaluate honestly: is the goal FULLY achieved?
- If you need multiple tool calls, do one per iteration. The loop will continue.
- If a tool fails, try an alternative approach.
- Set goalComplete=true ONLY when you've actually accomplished the full goal.
- confidence should reflect how sure you are (0.8+ means done).

Respond with ONLY the JSON (no markdown, no explanation outside the JSON):`;

  return prompt;
}

function buildSummaryPrompt(goal: string, steps: LoopStep[]): string {
  const stepSummary = steps.map(s =>
    `Step ${s.index}: ${s.thought.slice(0, 100)} → ${s.action.type}${s.action.tool ? `:${s.action.tool}` : ''}`
  ).join('\n');

  return `Goal: ${goal}

Steps taken:
${stepSummary}

Provide a brief final summary of what was accomplished. Be concise.`;
}

// ─── Response Parser ─────────────────────────────────────────────────────────

interface ParsedLoopResponse {
  thought: string;
  action: {
    type: 'tool_call' | 'delegate' | 'reason' | 'evaluate';
    tool?: string;
    params?: Record<string, unknown>;
    agent?: string;
    input?: string;
  };
  evaluation: {
    goalComplete: boolean;
    confidence: number;
    remaining?: string;
    nextAction?: string;
  };
}

function parseLoopResponse(response: string): ParsedLoopResponse {
  // Try to extract JSON from the response
  try {
    // Handle markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || response.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    const parsed = JSON.parse(jsonStr);

    return {
      thought: parsed.thought || response.slice(0, 200),
      action: {
        type: parsed.action?.type || 'reason',
        tool: parsed.action?.tool,
        params: parsed.action?.params,
        agent: parsed.action?.agent,
        input: parsed.action?.input,
      },
      evaluation: {
        goalComplete: parsed.evaluation?.goalComplete ?? false,
        confidence: parsed.evaluation?.confidence ?? 0.3,
        remaining: parsed.evaluation?.remaining,
        nextAction: parsed.evaluation?.nextAction,
      },
    };
  } catch {
    // Failed to parse — treat as reasoning step
    return {
      thought: response.slice(0, 500),
      action: { type: 'reason' },
      evaluation: {
        goalComplete: false,
        confidence: 0.2,
        remaining: 'Could not parse response. Will retry.',
      },
    };
  }
}
