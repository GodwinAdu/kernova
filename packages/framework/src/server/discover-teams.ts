/**
 * discoverTeams — Discovers team definitions from the filesystem.
 *
 * Looks for team definitions in:
 *   - agents/teams/*.ts
 *   - teams/*.ts
 *
 * Each file should export a default defineTeam() result.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TeamDefinition } from '../define-team.js';

export interface DiscoveredTeam extends TeamDefinition {
  /** File path where the team was defined */
  filePath: string;
}

/**
 * Discover team definitions from the project directory.
 */
export async function discoverTeams(projectRoot: string): Promise<DiscoveredTeam[]> {
  const teams: DiscoveredTeam[] = [];

  // Look in common team directories
  const teamDirs = [
    join(projectRoot, 'agents', 'teams'),
    join(projectRoot, 'teams'),
    join(projectRoot, 'src', 'agents', 'teams'),
    join(projectRoot, 'src', 'teams'),
  ];

  for (const dir of teamDirs) {
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter(
      f => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mts') || f.endsWith('.mjs'),
    );

    for (const file of files) {
      const filePath = join(dir, file);

      try {
        const fileUrl = pathToFileURL(filePath).href;
        const module = await import(fileUrl);
        const teamDef = module.default || module;

        // Validate it looks like a team definition
        if (teamDef && teamDef.name && teamDef.strategy && Array.isArray(teamDef.members)) {
          teams.push({
            ...teamDef,
            filePath,
          });
        }
      } catch (err) {
        console.warn(`  ⚠️  Failed to load team: ${file}`, (err as Error).message);
      }
    }
  }

  return teams;
}
