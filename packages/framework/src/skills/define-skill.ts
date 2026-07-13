/**
 * defineSkill — Create a reusable skill package.
 *
 * Usage:
 *   // skills/coding/index.ts
 *   import { defineSkill } from '@kernova/framework';
 *
 *   export default defineSkill({
 *     name: 'coding',
 *     description: 'Expert coding assistant',
 *     instructions: `
 *       You are an expert programmer.
 *       Follow best practices, write clean code, and explain your reasoning.
 *       Always write tests for new code.
 *     `,
 *     tools: [lintTool, formatTool],
 *     mcpServers: ['github', 'filesystem'],
 *     recommendedModel: 'gpt-4o',
 *   });
 */

import type { SkillDefinition } from './types.js';

export function defineSkill(definition: SkillDefinition): SkillDefinition {
  if (!definition.name) {
    throw new Error('defineSkill: "name" is required');
  }
  if (!definition.instructions) {
    throw new Error('defineSkill: "instructions" is required');
  }

  return {
    tools: [],
    workflows: [],
    mcpServers: [],
    knowledge: [],
    ...definition,
  };
}
