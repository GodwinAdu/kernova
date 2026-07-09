/**
 * Tool helper — shorthand for defining tools.
 * 
 * Usage:
 *   import { tool } from '@kernova/sdk';
 *   
 *   export default tool('search', {
 *     description: 'Search the web',
 *     parameters: { query: { type: 'string' } },
 *     execute: async ({ query }) => { ... },
 *   });
 */

import type { ToolDefinition } from '@kernova/core';

export function tool(name: string, spec: {
  description: string;
  parameters?: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}): ToolDefinition {
  return {
    id: name,
    name,
    description: spec.description,
    parameters: spec.parameters || { type: 'object', properties: {} },
    execute: spec.execute,
  };
}
