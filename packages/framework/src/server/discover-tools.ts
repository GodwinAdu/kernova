/**
 * discoverTools — Scans for tool definitions in the project.
 *
 * Looks in:
 *   agents/tools/*.ts
 *   tools/*.ts
 */

import { resolve, relative } from 'node:path';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { ToolDefinition } from '../types/tool.js';

export interface DiscoveredTool {
  name: string;
  filePath: string;
  definition: ToolDefinition;
}

const TOOL_EXTENSIONS = ['.ts', '.js', '.mjs'];

function isToolFile(filename: string): boolean {
  // Skip index files and non-code files
  if (filename.startsWith('index.') || filename.startsWith('_')) return false;
  return TOOL_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function scanToolDir(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && isToolFile(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Discover and load all tool definitions.
 */
export async function discoverTools(projectRoot: string): Promise<DiscoveredTool[]> {
  const toolDirs = [
    resolve(projectRoot, 'agents', 'tools'),
    resolve(projectRoot, 'tools'),
  ];

  const tools: DiscoveredTool[] = [];
  const seen = new Set<string>();

  for (const dir of toolDirs) {
    const files = scanToolDir(dir);

    for (const filePath of files) {
      try {
        const module = await import(pathToFileURL(filePath).href);
        const definition = module.default || module;

        if (definition && definition.name && definition.execute) {
          if (!seen.has(definition.name)) {
            seen.add(definition.name);
            tools.push({ name: definition.name, filePath, definition });
          }
        }
      } catch (err) {
        console.error(`Failed to load tool at ${filePath}: ${(err as Error).message}`);
      }
    }
  }

  return tools;
}
