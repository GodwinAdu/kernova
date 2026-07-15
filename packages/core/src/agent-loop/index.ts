/**
 * Agent Loop — Persistent goal-oriented execution.
 *
 * Keeps an agent running in a Think → Act → Evaluate loop
 * until the goal is fully achieved or limits are hit.
 *
 * Usage:
 *   import { executeLoop } from '@kernova/core';
 *
 *   const result = await executeLoop(
 *     "Reply to all unread emails with contextual responses",
 *     {
 *       agentName: 'Assistant',
 *       agentInstructions: '...',
 *       availableTools: [{ name: 'gmail', description: '...' }],
 *       maxIterations: 10,
 *       goal: '...',
 *     },
 *     {
 *       complete: (prompt) => openai.chat(prompt),
 *       executeTool: (name, params) => toolRegistry.execute(name, params),
 *     },
 *   );
 *
 *   console.log(result.status); // 'completed'
 *   console.log(result.steps);  // [{ thought, action, result, evaluation }, ...]
 *   console.log(result.toolsUsed); // ['gmail']
 */

export { executeLoop } from './executor.js';
export type { LoopExecutorDeps } from './executor.js';

export type {
  LoopConfig,
  LoopResult,
  LoopStep,
  LoopContext,
  LoopStatus,
} from './types.js';

export { DEFAULT_LOOP_CONFIG } from './types.js';
