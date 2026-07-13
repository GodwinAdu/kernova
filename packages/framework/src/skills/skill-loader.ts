/**
 * Skill Loader — Discovers and loads skills from the project.
 *
 * Skills can come from:
 * 1. Local directory: skills/coding/index.ts
 * 2. npm packages: @kernova/skill-nextjs
 * 3. Agent definition: skills: ['coding', '@kernova/skill-nextjs']
 */

import { resolve, join } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { SkillDefinition, LoadedSkill, SkillManifest } from './types.js';

/**
 * Load a single skill by name or path.
 */
export async function loadSkill(nameOrPath: string, projectRoot: string): Promise<LoadedSkill | null> {
  // Try as local skill directory
  const localSkillDir = resolve(projectRoot, 'skills', nameOrPath);
  if (existsSync(localSkillDir)) {
    return loadFromDirectory(localSkillDir, nameOrPath);
  }

  // Try as local file
  const localFile = resolve(projectRoot, 'skills', `${nameOrPath}.ts`);
  if (existsSync(localFile)) {
    return loadFromFile(localFile, nameOrPath);
  }

  // Try as npm package
  try {
    const pkgPath = resolve(projectRoot, 'node_modules', nameOrPath);
    if (existsSync(pkgPath)) {
      return loadFromPackage(pkgPath, nameOrPath);
    }
  } catch {}

  console.warn(`[Skills] Could not load skill: ${nameOrPath}`);
  return null;
}

/**
 * Discover all skills in the skills/ directory.
 */
export async function discoverSkills(projectRoot: string): Promise<LoadedSkill[]> {
  const skillsDir = resolve(projectRoot, 'skills');
  if (!existsSync(skillsDir)) return [];

  const skills: LoadedSkill[] = [];
  const entries = readdirSync(skillsDir);

  for (const entry of entries) {
    const fullPath = resolve(skillsDir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      const skill = await loadFromDirectory(fullPath, entry);
      if (skill) skills.push(skill);
    } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      const name = entry.replace(/\.(ts|js)$/, '');
      const skill = await loadFromFile(fullPath, name);
      if (skill) skills.push(skill);
    }
  }

  return skills;
}

async function loadFromDirectory(dir: string, name: string): Promise<LoadedSkill | null> {
  // Look for index.ts, index.js, or skill.ts
  const entryFiles = ['index.ts', 'index.js', 'skill.ts', 'skill.js'];

  for (const file of entryFiles) {
    const filePath = join(dir, file);
    if (existsSync(filePath)) {
      try {
        const module = await import(pathToFileURL(filePath).href);
        const definition = module.default || module;

        // Load manifest if exists
        const manifestPath = join(dir, 'manifest.json');
        let manifest: SkillManifest | undefined;
        if (existsSync(manifestPath)) {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        }

        return {
          name: definition.name || name,
          definition: { ...definition, manifest },
          filePath,
        };
      } catch (err) {
        console.error(`[Skills] Failed to load skill from ${filePath}:`, (err as Error).message);
      }
    }
  }

  return null;
}

async function loadFromFile(filePath: string, name: string): Promise<LoadedSkill | null> {
  try {
    const module = await import(pathToFileURL(filePath).href);
    const definition = module.default || module;

    return {
      name: definition.name || name,
      definition,
      filePath,
    };
  } catch (err) {
    console.error(`[Skills] Failed to load skill from ${filePath}:`, (err as Error).message);
    return null;
  }
}

async function loadFromPackage(pkgPath: string, name: string): Promise<LoadedSkill | null> {
  try {
    const pkgJsonPath = join(pkgPath, 'package.json');
    if (!existsSync(pkgJsonPath)) return null;

    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const mainFile = join(pkgPath, pkg.main || 'index.js');

    if (!existsSync(mainFile)) return null;

    const module = await import(pathToFileURL(mainFile).href);
    const definition = module.default || module;

    return {
      name: definition.name || name,
      definition,
      filePath: mainFile,
    };
  } catch (err) {
    console.error(`[Skills] Failed to load skill from package ${name}:`, (err as Error).message);
    return null;
  }
}
