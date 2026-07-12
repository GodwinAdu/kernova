/**
 * Middleware Pipeline — Executes middleware chain before/after agent calls.
 *
 * Discovers middleware from the middleware/ directory and runs them
 * in the request flow.
 */

import { resolve } from 'node:path';
import { readdirSync, existsSync, statSync } from 'node:fs';
import type { MiddlewareDefinition, MiddlewareContext, MiddlewareNext } from '../types/middleware.js';

export interface DiscoveredMiddleware {
  name: string;
  filePath: string;
  definition: MiddlewareDefinition;
}

/**
 * Discover middleware from the middleware/ directory.
 */
export async function discoverMiddleware(projectRoot: string): Promise<DiscoveredMiddleware[]> {
  const middlewareDir = resolve(projectRoot, 'middleware');
  const middlewares: DiscoveredMiddleware[] = [];

  if (!existsSync(middlewareDir)) return middlewares;

  const entries = readdirSync(middlewareDir);

  for (const entry of entries) {
    const fullPath = resolve(middlewareDir, entry);
    const stat = statSync(fullPath);
    if (!stat.isFile()) continue;
    if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
    if (entry.startsWith('_') || entry.startsWith('index.')) continue;

    try {
      const module = await import(fullPath);
      const definition = module.default || module;

      if (definition && definition.name && definition.handler) {
        middlewares.push({ name: definition.name, filePath: fullPath, definition });
      }
    } catch (err) {
      console.error(`Failed to load middleware at ${fullPath}: ${(err as Error).message}`);
    }
  }

  return middlewares;
}

/**
 * MiddlewarePipeline — Runs middleware in order around agent execution.
 */
export class MiddlewarePipeline {
  private before: MiddlewareDefinition[] = [];
  private after: MiddlewareDefinition[] = [];

  constructor(middlewares: DiscoveredMiddleware[]) {
    for (const mw of middlewares) {
      const stage = mw.definition.stage || 'both';
      if (stage === 'before' || stage === 'both') {
        this.before.push(mw.definition);
      }
      if (stage === 'after' || stage === 'both') {
        this.after.push(mw.definition);
      }
    }
  }

  /**
   * Run the before-middleware chain.
   * Returns false if any middleware aborted the request.
   */
  async runBefore(context: MiddlewareContext): Promise<boolean> {
    for (const mw of this.before) {
      let called = false;
      const next: MiddlewareNext = async () => { called = true; };

      try {
        await mw.handler(context, next);
        if (!called) {
          // Middleware didn't call next() — abort the chain
          return false;
        }
      } catch (err) {
        console.error(`Middleware "${mw.name}" threw:`, (err as Error).message);
        throw err;
      }
    }
    return true;
  }

  /**
   * Run the after-middleware chain.
   */
  async runAfter(context: MiddlewareContext): Promise<void> {
    for (const mw of this.after) {
      const next: MiddlewareNext = async () => {};

      try {
        await mw.handler(context, next);
      } catch (err) {
        console.error(`After-middleware "${mw.name}" threw:`, (err as Error).message);
      }
    }
  }
}
