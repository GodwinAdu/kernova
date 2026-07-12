/**
 * defineMemory — Declarative memory schema.
 *
 * Usage:
 *   // memory/conversations.ts
 *   import { defineMemory } from '@kernova/framework';
 *
 *   export default defineMemory({
 *     name: 'conversations',
 *     schema: {
 *       summary: { type: 'text', indexed: true },
 *       embedding: { type: 'embedding' },
 *       sentiment: { type: 'text' },
 *       userId: { type: 'text', indexed: true, required: true },
 *     },
 *     ttl: '30d',
 *     autoSummarize: true,
 *   });
 */

import type { MemoryDefinition } from './types/memory.js';

/**
 * Define a memory namespace with a typed schema.
 */
export function defineMemory(definition: MemoryDefinition): MemoryDefinition {
  if (!definition.name) {
    throw new Error('defineMemory: "name" is required');
  }
  if (!definition.schema || Object.keys(definition.schema).length === 0) {
    throw new Error('defineMemory: "schema" must have at least one field');
  }

  return {
    autoSummarize: false,
    ...definition,
  };
}
