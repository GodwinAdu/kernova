/**
 * defineTool — Custom tool definition.
 *
 * Usage:
 *   // agents/tools/search-kb.ts
 *   import { defineTool } from '@kernova/framework';
 *
 *   export default defineTool({
 *     name: 'search-knowledge-base',
 *     description: 'Search the company knowledge base',
 *     parameters: {
 *       query: { type: 'string', description: 'Search query', required: true },
 *     },
 *     execute: async ({ query }, ctx) => {
 *       const results = await searchDB(query);
 *       return results;
 *     },
 *   });
 */

import type { ToolDefinition } from './types/tool.js';

/**
 * Define a custom tool that agents can use.
 */
export function defineTool<TParams extends Record<string, unknown> = Record<string, unknown>>(
  definition: ToolDefinition<TParams>
): ToolDefinition<TParams> {
  // Validate required fields
  if (!definition.name) {
    throw new Error('defineTool: "name" is required');
  }
  if (!definition.description) {
    throw new Error('defineTool: "description" is required');
  }
  if (!definition.execute) {
    throw new Error('defineTool: "execute" function is required');
  }

  return {
    requiresConfirmation: false,
    ...definition,
  };
}
