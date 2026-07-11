/**
 * defineAgent
 * 
 * The developer-facing API for creating agents.
 * This is the equivalent of Express's `app.get()` or React's `defineComponent()`.
 * 
 * Usage:
 *   import { defineAgent } from '@kernova/core';
 *   
 *   export default defineAgent({
 *     name: 'my-agent',
 *     description: 'Does cool things',
 *     capabilities: [...],
 *     tools: [],
 *     instructions: '...',
 *     async execute(intent, context, tools) {
 *       // Your logic here
 *       return { success: true, summary: '...', evidence: {...}, durationMs: 0 };
 *     }
 *   });
 */

import type {
  AgentDefinition,
  Intent,
  IntentResult,
  ComputedContext,
  Capability,
  ToolReference,
} from '@kernova/types';
import type { AgentExecutor, AgentTools } from './agents/agent-registry.js';
import { generateId, now } from './utils.js';

export interface AgentSpec {
  /** Agent name */
  name: string;

  /** What the agent does */
  description: string;

  /** What the agent is capable of */
  capabilities: Capability[];

  /** Tools the agent can use */
  tools: ToolReference[];

  /** System instructions */
  instructions: string;

  /**
   * The execution function.
   * If not provided, the agent will use the default LLM-backed executor:
   * it sends the intent goal + context to the model and returns the response.
   */
  execute?: (
    intent: Intent,
    context: ComputedContext,
    tools: AgentTools,
  ) => Promise<IntentResult>;

  /** Per-agent self-reflection configuration */
  reflection?: {
    /** Whether reflection is enabled for this agent */
    enabled: boolean;
    /** Confidence score threshold (overrides global, default: 0.7) */
    threshold?: number;
    /** Maximum regeneration attempts (overrides global, default: 2) */
    maxAttempts?: number;
  };
}

export interface DefinedAgent {
  definition: AgentDefinition;
  executor: AgentExecutor;
}

/**
 * Define a new Kernova agent
 */
export function defineAgent(spec: AgentSpec): DefinedAgent {
  const definition: AgentDefinition = {
    id: generateId('agent'),
    type: 'agent_definition',
    version: '1.0.0',
    owner: 'system',
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    metadata: {},
    name: spec.name,
    description: spec.description,
    capabilities: spec.capabilities,
    tools: spec.tools,
    models: [],
    instructions: spec.instructions,
    memoryConfig: {
      workingMemory: true,
      sessionMemory: true,
      longTermMemory: false,
      workingMemoryLimit: 50,
      sessionMemoryTtl: 3600,
    },
    permissions: [],
    concurrency: 1,
    config: {
      retries: { maxAttempts: 3, backoffMs: 1000 },
      timeoutMs: 30000,
    },
  };

  // Default executor: sends the intent to the LLM via the tools.complete() helper
  const executor: AgentExecutor = spec.execute || defaultLLMExecutor;

  return {
    definition,
    executor,
  };
}

/**
 * Default LLM-backed executor.
 * Used when a developer defines an agent without a custom execute function.
 * 
 * It assembles the agent's instructions + context memories + intent goal,
 * sends it to the model router, and returns the result with evidence.
 */
const defaultLLMExecutor: AgentExecutor = async (intent, context, tools) => {
  const startTime = Date.now();

  tools.log(`Processing intent: ${intent.goal}`);

  // Build prompt from context memories
  let contextBlock = '';
  if (context.memories.length > 0) {
    contextBlock = '\n\nRelevant context:\n' +
      context.memories.map(m => `- ${m.content}`).join('\n');
  }

  const prompt = `${intent.goal}${contextBlock}`;

  try {
    // If tools are available, use tool-calling mode (LLM decides which tools to use)
    // Otherwise fall back to plain text completion
    const availableTools = tools.listTools();
    tools.log(`Available tools: ${availableTools.length} [${availableTools.map(t => t.id).join(', ')}]`);
    const response = availableTools.length > 0
      ? await tools.completeWithTools(prompt)
      : await tools.complete(prompt);

    const durationMs = Date.now() - startTime;

    tools.emit('completed', {
      intentId: intent.id,
      durationMs,
      responseLength: response.length,
    });

    return {
      success: true,
      data: response,
      summary: response,
      evidence: {
        sources: [{
          type: 'memory' as const,
          ref: 'llm-response',
          label: 'LLM completion',
          consultedAt: now(),
        }],
        confidence: 0.85,
        reasoning: `Processed by LLM in ${durationMs}ms`,
      },
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    tools.log(`Error: ${(error as Error).message}`);

    return {
      success: false,
      summary: `Failed to process: ${(error as Error).message}`,
      evidence: {
        sources: [],
        confidence: 0,
        reasoning: `LLM call failed: ${(error as Error).message}`,
      },
      durationMs,
    };
  }
};
