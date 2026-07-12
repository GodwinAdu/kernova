/**
 * defineAgent — File-based agent definition.
 *
 * Usage:
 *   // agents/support.agent.ts
 *   import { defineAgent } from '@kernova/framework';
 *
 *   export default defineAgent({
 *     name: 'Support Agent',
 *     model: 'gpt-4o',
 *     instructions: 'You help customers with their issues...',
 *     tools: ['./tools/search-kb', './tools/create-ticket'],
 *     memory: { type: 'conversational', ttl: '7d' },
 *   });
 */

import type { AgentDefinition } from './types/agent.js';

/**
 * Define an agent. The file name determines the route:
 *   agents/support.agent.ts → POST /v1/agents/support
 *   agents/research.agent.ts → POST /v1/agents/research
 */
export function defineAgent(definition: AgentDefinition): AgentDefinition {
  // Validate required fields
  if (!definition.name) {
    throw new Error('defineAgent: "name" is required');
  }
  if (!definition.instructions) {
    throw new Error('defineAgent: "instructions" is required');
  }

  // Apply defaults
  return {
    memory: { type: 'conversational' },
    maxTokens: 4096,
    temperature: 0.7,
    capabilities: [],
    tools: [],
    middleware: [],
    ...definition,
  };
}
