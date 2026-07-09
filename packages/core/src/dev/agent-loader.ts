/**
 * Nexus Agent Loader
 * 
 * Dynamically loads and reloads agent definitions from the filesystem.
 * Used by `nexus dev` for hot-reload during development.
 * 
 * Design:
 * - Dynamic import() with cache-busting to force fresh module load
 * - Error isolation: bad agent code doesn't crash the runtime
 * - Graceful swap: new definition replaces old without dropping intents
 */

import { resolve, basename, extname } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AgentDefinition } from '@kernova/types';
import type { AgentExecutor } from '../agents/agent-registry.js';
import type { DefinedAgent } from '../define-agent.js';

export interface AgentLoadResult {
  name: string;
  filePath: string;
  success: boolean;
  error?: string;
  definition?: AgentDefinition;
  executor?: AgentExecutor;
  durationMs: number;
}

export class AgentLoader {
  private loadedAgents: Map<string, { definition: AgentDefinition; executor: AgentExecutor }> = new Map();

  /**
   * Load all agents from a directory
   */
  async loadDirectory(dirPath: string): Promise<AgentLoadResult[]> {
    if (!existsSync(dirPath)) return [];

    const files = readdirSync(dirPath).filter(f =>
      ['.ts', '.js', '.mts', '.mjs'].includes(extname(f))
    );

    const results: AgentLoadResult[] = [];

    for (const file of files) {
      const fullPath = resolve(dirPath, file);
      const result = await this.loadAgent(fullPath);
      results.push(result);
    }

    return results;
  }

  /**
   * Load or reload a single agent from a file path
   */
  async loadAgent(filePath: string): Promise<AgentLoadResult> {
    const name = basename(filePath, extname(filePath));
    const startTime = Date.now();

    try {
      // Cache-bust: append timestamp to force fresh import
      const fileUrl = pathToFileURL(filePath).href;
      const bustUrl = `${fileUrl}?t=${Date.now()}`;

      // Dynamic import
      const module = await import(bustUrl);

      // Get the default export (should be a DefinedAgent from defineAgent())
      const agent: DefinedAgent = module.default || module;

      if (!agent || !agent.definition || !agent.executor) {
        throw new Error(
          `Agent file must export a defineAgent() result as default export.`
        );
      }

      // Store for tracking
      this.loadedAgents.set(name, {
        definition: agent.definition,
        executor: agent.executor,
      });

      return {
        name,
        filePath,
        success: true,
        definition: agent.definition,
        executor: agent.executor,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name,
        filePath,
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get all currently loaded agents
   */
  getLoadedAgents(): Map<string, { definition: AgentDefinition; executor: AgentExecutor }> {
    return this.loadedAgents;
  }

  /**
   * Check if an agent is loaded
   */
  isLoaded(name: string): boolean {
    return this.loadedAgents.has(name);
  }
}
