/**
 * discoverAgents — Scans the agents/ directory and loads agent definitions.
 *
 * File-based routing:
 *   agents/support.agent.ts   → route: "support"
 *   agents/research.agent.ts  → route: "research"
 *   agents/sales/qualify.agent.ts → route: "sales/qualify"
 */

import { resolve, relative } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AgentDefinition } from '../types/agent.js';

export interface DiscoveredAgent {
  /** Route name derived from file path */
  route: string;
  /** File path */
  filePath: string;
  /** The agent definition */
  definition: AgentDefinition;
}

const AGENT_EXTENSIONS = ['.agent.ts', '.agent.js', '.agent.mjs'];

function isAgentFile(filename: string): boolean {
  return AGENT_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function routeFromFile(filePath: string, agentsDir: string): string {
  const rel = relative(agentsDir, filePath);
  // Remove the .agent.ts extension
  let route = rel;
  for (const ext of AGENT_EXTENSIONS) {
    if (route.endsWith(ext)) {
      route = route.slice(0, -ext.length);
      break;
    }
  }
  // Normalize path separators to forward slashes
  return route.replace(/\\/g, '/');
}

function walkDir(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip tools/ and node_modules/
      if (entry === 'tools' || entry === 'node_modules') continue;
      files.push(...walkDir(fullPath));
    } else if (isAgentFile(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Discover all agent files in the agents/ directory.
 * Returns metadata without loading the modules (for fast startup scanning).
 */
export function discoverAgentFiles(projectRoot: string): Array<{ route: string; filePath: string }> {
  const agentsDir = resolve(projectRoot, 'agents');

  if (!existsSync(agentsDir)) {
    return [];
  }

  const files = walkDir(agentsDir);

  return files.map((filePath) => ({
    route: routeFromFile(filePath, agentsDir),
    filePath,
  }));
}

/**
 * Discover and load all agent definitions.
 */
export async function discoverAgents(projectRoot: string): Promise<DiscoveredAgent[]> {
  const agentFiles = discoverAgentFiles(projectRoot);
  const agents: DiscoveredAgent[] = [];

  for (const { route, filePath } of agentFiles) {
    try {
      const module = await import(pathToFileURL(filePath).href);
      const definition = module.default || module;

      agents.push({
        route,
        filePath,
        definition,
      });
    } catch (err) {
      console.error(`Failed to load agent at ${filePath}: ${(err as Error).message}`);
    }
  }

  return agents;
}
