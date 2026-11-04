/**
 * discoverTriggers — Discovers trigger definitions from the filesystem.
 *
 * Looks in:
 *   - agents/triggers/*.ts
 *   - triggers/*.ts
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface DiscoveredTrigger {
  name: string;
  event: string;
  agent: string;
  goal: string;
  priority?: string;
  cooldown?: number;
  enabled?: boolean;
  when?: () => boolean | Promise<boolean>;
  filePath: string;
}

export async function discoverTriggers(projectRoot: string): Promise<DiscoveredTrigger[]> {
  const triggers: DiscoveredTrigger[] = [];

  const dirs = [
    join(projectRoot, 'agents', 'triggers'),
    join(projectRoot, 'triggers'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter(
      f => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mts') || f.endsWith('.mjs'),
    );

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const fileUrl = pathToFileURL(filePath).href;
        const module = await import(fileUrl);
        const def = module.default || module;

        if (def && def.name && def.event && def.goal) {
          triggers.push({
            name: def.name,
            event: def.event,
            agent: def.agent || 'assistant',
            goal: def.goal,
            priority: def.priority,
            cooldown: def.cooldown,
            enabled: def.enabled,
            ...(typeof def.when === 'function' && { when: def.when }),
            filePath,
          });
        }
      } catch (err) {
        console.warn(`  ⚠️  Failed to load trigger: ${file}`, (err as Error).message);
      }
    }
  }

  return triggers;
}
