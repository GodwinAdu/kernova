/**
 * @kernova/framework Skills System
 *
 * A Skill is a reusable package containing:
 * - Instructions (system prompt additions)
 * - Tools (custom tools the agent can use)
 * - Workflows (multi-step processes)
 * - Knowledge (documents/examples)
 * - MCP requirements (external service connections)
 * - Recommended models
 *
 * Usage:
 *   // In agent definition:
 *   export default defineAgent({
 *     name: 'Developer',
 *     skills: ['@kernova/skill-nextjs', './skills/coding'],
 *   });
 *
 *   // CLI:
 *   kernova add skill nextjs
 */

export { loadSkill, discoverSkills } from './skill-loader.js';
export { defineSkill } from './define-skill.js';
export type { SkillManifest, SkillDefinition, LoadedSkill } from './types.js';
