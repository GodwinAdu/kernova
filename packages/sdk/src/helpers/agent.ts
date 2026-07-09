/**
 * Agent helper — shorthand for defining agents outside the Nexus class.
 * 
 * Usage:
 *   import { agent } from '@nexus/sdk';
 *   
 *   export default agent('assistant', {
 *     instructions: 'You are helpful.',
 *   });
 */

import { defineAgent, type AgentSpec, type DefinedAgent } from '@nexus/core';

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
  });
}
