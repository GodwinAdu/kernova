/**
 * loadConfig — Loads and resolves kernova.config.ts from the project root.
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { KernovaFrameworkConfig } from '../types/config.js';

const CONFIG_FILES = [
  'kernova.config.ts',
  'kernova.config.js',
  'kernova.config.mjs',
];

/**
 * Load the project's kernova.config.ts file.
 */
export async function loadConfig(projectRoot?: string): Promise<KernovaFrameworkConfig> {
  const root = projectRoot || process.cwd();

  for (const configFile of CONFIG_FILES) {
    const configPath = resolve(root, configFile);
    if (existsSync(configPath)) {
      try {
        const module = await import(configPath);
        const config = module.default || module;
        return config as KernovaFrameworkConfig;
      } catch (err) {
        throw new Error(`Failed to load ${configFile}: ${(err as Error).message}`);
      }
    }
  }

  // No config file found — return defaults
  const packageJsonPath = join(root, 'package.json');
  let name = 'kernova-app';

  if (existsSync(packageJsonPath)) {
    try {
      const { readFileSync } = await import('node:fs');
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      name = pkg.name || name;
    } catch {
      // ignore
    }
  }

  return {
    name,
    version: '0.1.0',
    model: { provider: 'openai', model: 'gpt-4o' },
    memory: { provider: 'local' },
    app: { framework: 'next', port: 3000 },
  };
}
