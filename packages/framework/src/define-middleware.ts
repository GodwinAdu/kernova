/**
 * defineMiddleware — Agent pipeline middleware.
 *
 * Usage:
 *   // middleware/auth.ts
 *   import { defineMiddleware } from '@kernova/framework';
 *
 *   export default defineMiddleware({
 *     name: 'auth',
 *     stage: 'before',
 *     handler: async (ctx, next) => {
 *       if (!ctx.user) {
 *         throw new Error('Unauthorized');
 *       }
 *       await next();
 *     },
 *   });
 */

import type { MiddlewareDefinition } from './types/middleware.js';

/**
 * Define middleware that runs in the agent request pipeline.
 */
export function defineMiddleware(definition: MiddlewareDefinition): MiddlewareDefinition {
  if (!definition.name) {
    throw new Error('defineMiddleware: "name" is required');
  }
  if (!definition.handler) {
    throw new Error('defineMiddleware: "handler" is required');
  }

  return {
    stage: 'both',
    ...definition,
  };
}
