/**
 * Agent helper — shorthand for defining agents outside the Kernova class.
 * 
 * Usage:
 *   import { agent } from '@kernova/sdk';
 *   
 *   export default agent('assistant', {
 *     instructions: 'You are helpful.',
 *   });
 */

import { defineAgent, type AgentSpec, type DefinedAgent } from '@kernova/core';

export function agent(name: string, spec: Partial<AgentSpec> & { instructions: string }): DefinedAgent {
  return defineAgent({
    name,
    description: spec.description || name,
    capabilities: spec.capabilities || [
      { id: name, name, description: spec.description || name, confidence: 0.8 },
    ],
    tools: spec.tools || [],
    instructions: spec.instructions,
    execute: spec.execute,
    reflection: spec.reflection,
    toolPolicy: spec.toolPolicy,
    model: spec.model,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
    reasoning: spec.reasoning,
    responseFormat: spec.responseFormat,
    promptCache: spec.promptCache,
  });
}
