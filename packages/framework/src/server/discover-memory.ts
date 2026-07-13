/**
 * discoverMemory — Scans the memory/ directory for schema definitions.
 */

import { resolve } from 'node:path';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { MemoryDefinition } from '../types/memory.js';

export interface DiscoveredMemory {
  name: string;
  filePath: string;
  definition: MemoryDefinition;
}

const MEMORY_EXTENSIONS = ['.ts', '.js', '.mjs'];

/**
 * Discover and load all memory schema definitions from memory/ directory.
 */
export async function discoverMemory(projectRoot: string): Promise<DiscoveredMemory[]> {
  const memoryDir = resolve(projectRoot, 'memory');
  const memories: DiscoveredMemory[] = [];

  if (!existsSync(memoryDir)) {
    return memories;
  }

  const entries = readdirSync(memoryDir);

  for (const entry of entries) {
    const fullPath = resolve(memoryDir, entry);
    const stat = statSync(fullPath);

    if (!stat.isFile()) continue;
    if (entry.startsWith('_') || entry.startsWith('index.')) continue;
    if (!MEMORY_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;

    try {
      const module = await import(pathToFileURL(fullPath).href);
      const definition = module.default || module;

      if (definition && definition.name && definition.schema) {
        memories.push({
          name: definition.name,
          filePath: fullPath,
          definition,
        });
      }
    } catch (err) {
      console.error(`Failed to load memory schema at ${fullPath}: ${(err as Error).message}`);
    }
  }

  return memories;
}
