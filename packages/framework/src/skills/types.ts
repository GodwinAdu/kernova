/**
 * Skill types.
 */

export interface SkillManifest {
  /** Skill name */
  name: string;
  /** Version */
  version: string;
  /** Description */
  description: string;
  /** Required tools (tool names) */
  requiredTools?: string[];
  /** Required MCP servers */
  requiredMcps?: string[];
  /** Recommended model */
  recommendedModel?: string;
  /** Permissions the skill needs */
  permissions?: string[];
  /** Knowledge files to load */
  knowledge?: string[];
  /** Author */
  author?: string;
}

export interface SkillDefinition {
  /** Skill name */
  name: string;
  /** Description */
  description: string;
  /** System prompt instructions to add to the agent */
  instructions: string;
  /** Tools provided by this skill */
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (params: any, ctx: any) => Promise<unknown>;
  }>;
  /** Workflows provided */
  workflows?: Array<{
    name: string;
    steps: Array<{ name: string; execute: (ctx: any) => Promise<unknown> }>;
  }>;
  /** MCP servers required */
  mcpServers?: string[];
  /** Recommended model for this skill */
  recommendedModel?: string;
  /** Knowledge base paths */
  knowledge?: string[];
  /** Manifest */
  manifest?: SkillManifest;
}

export interface LoadedSkill {
  name: string;
  definition: SkillDefinition;
  filePath?: string;
}
