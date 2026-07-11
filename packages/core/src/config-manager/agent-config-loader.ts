/**
 * Agent Config File Loader
 *
 * Parses `.agent.yaml`, `.agent.yml`, and `.agent.json` files into
 * AgentConfigFile objects. Supports:
 * - YAML and JSON parsing
 * - Schema validation (required fields: name, instructions)
 * - `extends` field for config inheritance (deep merge)
 * - Hot-reload via fs.watch()
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AgentConfigFile } from '@kernova/types';

/** File extensions recognized as agent config files */
const AGENT_CONFIG_EXTENSIONS = ['.agent.yaml', '.agent.yml', '.agent.json'];

export interface AgentConfigLoadResult {
  config: AgentConfigFile;
  filePath: string;
}

export interface AgentConfigLoaderOptions {
  /** Base directory for resolving relative `extends` paths */
  baseDir?: string;
}

/**
 * Validate that a parsed object has the required AgentConfigFile fields.
 * Throws a descriptive error if validation fails.
 */
export function validateAgentConfig(data: unknown, filePath: string): AgentConfigFile {
  if (!data || typeof data !== 'object') {
    throw new AgentConfigError(`Config file is not a valid object`, filePath);
  }

  const obj = data as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    throw new AgentConfigError(`Missing or invalid required field 'name' (must be a non-empty string)`, filePath);
  }

  if (!obj.instructions || typeof obj.instructions !== 'string') {
    throw new AgentConfigError(`Missing or invalid required field 'instructions' (must be a non-empty string)`, filePath);
  }

  // Validate optional fields
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new AgentConfigError(`Field 'description' must be a string`, filePath);
  }

  if (obj.model !== undefined && typeof obj.model !== 'string') {
    throw new AgentConfigError(`Field 'model' must be a string`, filePath);
  }

  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools) || !obj.tools.every((t: unknown) => typeof t === 'string')) {
      throw new AgentConfigError(`Field 'tools' must be an array of strings`, filePath);
    }
  }

  if (obj.schedules !== undefined) {
    if (!Array.isArray(obj.schedules)) {
      throw new AgentConfigError(`Field 'schedules' must be an array`, filePath);
    }
    for (let i = 0; i < obj.schedules.length; i++) {
      validateSchedule(obj.schedules[i], filePath, i);
    }
  }

  if (obj.triggers !== undefined) {
    if (!Array.isArray(obj.triggers)) {
      throw new AgentConfigError(`Field 'triggers' must be an array`, filePath);
    }
    for (let i = 0; i < obj.triggers.length; i++) {
      validateTrigger(obj.triggers[i], filePath, i);
    }
  }

  if (obj.extends !== undefined && typeof obj.extends !== 'string') {
    throw new AgentConfigError(`Field 'extends' must be a string`, filePath);
  }

  return data as AgentConfigFile;
}

function validateSchedule(schedule: unknown, filePath: string, index: number): void {
  if (!schedule || typeof schedule !== 'object') {
    throw new AgentConfigError(`schedules[${index}] must be an object`, filePath);
  }
  const s = schedule as Record<string, unknown>;
  if (!s.name || typeof s.name !== 'string') {
    throw new AgentConfigError(`schedules[${index}].name is required and must be a string`, filePath);
  }
  if (!s.goal || typeof s.goal !== 'string') {
    throw new AgentConfigError(`schedules[${index}].goal is required and must be a string`, filePath);
  }
  if (s.cron !== undefined && typeof s.cron !== 'string') {
    throw new AgentConfigError(`schedules[${index}].cron must be a string`, filePath);
  }
  if (s.delayMs !== undefined && typeof s.delayMs !== 'number') {
    throw new AgentConfigError(`schedules[${index}].delayMs must be a number`, filePath);
  }
}

function validateTrigger(trigger: unknown, filePath: string, index: number): void {
  if (!trigger || typeof trigger !== 'object') {
    throw new AgentConfigError(`triggers[${index}] must be an object`, filePath);
  }
  const t = trigger as Record<string, unknown>;
  if (!t.name || typeof t.name !== 'string') {
    throw new AgentConfigError(`triggers[${index}].name is required and must be a string`, filePath);
  }
  if (!t.event || typeof t.event !== 'string') {
    throw new AgentConfigError(`triggers[${index}].event is required and must be a string`, filePath);
  }
  if (!t.goal || typeof t.goal !== 'string') {
    throw new AgentConfigError(`triggers[${index}].goal is required and must be a string`, filePath);
  }
  if (t.condition !== undefined && typeof t.condition !== 'string') {
    throw new AgentConfigError(`triggers[${index}].condition must be a string`, filePath);
  }
}

/**
 * Parse a single agent config file (YAML or JSON) from a file path.
 */
export function parseAgentConfigFile(filePath: string): AgentConfigFile {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new AgentConfigError(`File not found`, absolutePath);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  return parseAgentConfigString(content, absolutePath);
}

/**
 * Parse agent config from a string (YAML or JSON), given the file path for error reporting.
 */
export function parseAgentConfigString(content: string, filePath: string): AgentConfigFile {
  let data: unknown;

  if (filePath.endsWith('.json')) {
    try {
      data = JSON.parse(content);
    } catch (err) {
      throw new AgentConfigError(
        `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
      );
    }
  } else {
    // YAML (.agent.yaml or .agent.yml)
    try {
      data = parseYaml(content);
    } catch (err) {
      throw new AgentConfigError(
        `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
      );
    }
  }

  return validateAgentConfig(data, filePath);
}

/**
 * Serialize an AgentConfigFile back to YAML string.
 */
export function serializeAgentConfigToYaml(config: AgentConfigFile): string {
  // Create a clean copy without undefined values
  const clean: Record<string, unknown> = { name: config.name };

  if (config.description !== undefined) clean.description = config.description;
  clean.instructions = config.instructions;
  if (config.model !== undefined) clean.model = config.model;
  if (config.tools !== undefined && config.tools.length > 0) clean.tools = config.tools;
  if (config.schedules !== undefined && config.schedules.length > 0) clean.schedules = config.schedules;
  if (config.triggers !== undefined && config.triggers.length > 0) clean.triggers = config.triggers;
  if (config.extends !== undefined) clean.extends = config.extends;

  return stringifyYaml(clean);
}

/**
 * Serialize an AgentConfigFile back to JSON string.
 */
export function serializeAgentConfigToJson(config: AgentConfigFile): string {
  // Create a clean copy without undefined values
  const clean: Record<string, unknown> = { name: config.name };

  if (config.description !== undefined) clean.description = config.description;
  clean.instructions = config.instructions;
  if (config.model !== undefined) clean.model = config.model;
  if (config.tools !== undefined && config.tools.length > 0) clean.tools = config.tools;
  if (config.schedules !== undefined && config.schedules.length > 0) clean.schedules = config.schedules;
  if (config.triggers !== undefined && config.triggers.length > 0) clean.triggers = config.triggers;
  if (config.extends !== undefined) clean.extends = config.extends;

  return JSON.stringify(clean, null, 2);
}

/**
 * Deep merge two AgentConfigFile objects.
 * Child values override base values. Arrays are replaced (not concatenated).
 */
export function mergeAgentConfigs(base: AgentConfigFile, child: AgentConfigFile): AgentConfigFile {
  const merged: AgentConfigFile = {
    name: child.name,
    instructions: child.instructions,
  };

  // Use child value if defined, otherwise fall back to base
  merged.description = child.description ?? base.description;
  merged.model = child.model ?? base.model;
  merged.tools = child.tools ?? base.tools;
  merged.schedules = child.schedules ?? base.schedules;
  merged.triggers = child.triggers ?? base.triggers;
  // `extends` is consumed during loading, not propagated
  // merged.extends is intentionally omitted

  return merged;
}

/**
 * Load an agent config file with `extends` resolution.
 * Recursively loads base configs and merges them.
 */
export function loadAgentConfigWithExtends(
  filePath: string,
  visited: Set<string> = new Set(),
): AgentConfigFile {
  const absolutePath = path.resolve(filePath);

  if (visited.has(absolutePath)) {
    throw new AgentConfigError(
      `Circular extends dependency detected`,
      absolutePath,
    );
  }
  visited.add(absolutePath);

  const config = parseAgentConfigFile(absolutePath);

  if (!config.extends) {
    return config;
  }

  // Resolve the base path relative to the current config's directory
  const baseDir = path.dirname(absolutePath);
  const basePath = path.resolve(baseDir, config.extends);

  const baseConfig = loadAgentConfigWithExtends(basePath, visited);
  return mergeAgentConfigs(baseConfig, config);
}

/**
 * Discover all agent config files in a directory (non-recursive).
 */
export function discoverAgentConfigFiles(dirPath: string): string[] {
  const absoluteDir = path.resolve(dirPath);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const stat = fs.statSync(absoluteDir);
  if (!stat.isDirectory()) {
    // If it's a single file, return it if it's a valid extension
    if (isAgentConfigFile(absoluteDir)) {
      return [absoluteDir];
    }
    return [];
  }

  const entries = fs.readdirSync(absoluteDir);
  const configFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(absoluteDir, entry);
    if (isAgentConfigFile(fullPath)) {
      configFiles.push(fullPath);
    }
  }

  return configFiles;
}

/**
 * Check if a file path has a recognized agent config extension.
 */
export function isAgentConfigFile(filePath: string): boolean {
  return AGENT_CONFIG_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/**
 * Watch agent config files for changes.
 * Calls the callback whenever a config file is created, modified, or deleted.
 */
export function watchAgentConfigFiles(
  paths: string[],
  onChange: (filePath: string, event: 'change' | 'rename') => void,
): () => void {
  const watchers: fs.FSWatcher[] = [];

  for (const filePath of paths) {
    try {
      const watcher = fs.watch(filePath, (eventType) => {
        onChange(filePath, eventType as 'change' | 'rename');
      });
      watchers.push(watcher);
    } catch {
      // File may not exist yet; skip
    }
  }

  // Also watch directories for new files
  const directories = new Set(paths.map((p) => path.dirname(p)));
  for (const dir of directories) {
    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename && isAgentConfigFile(filename)) {
          const fullPath = path.join(dir, filename);
          onChange(fullPath, eventType as 'change' | 'rename');
        }
      });
      watchers.push(watcher);
    } catch {
      // Directory may not exist; skip
    }
  }

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

/**
 * Custom error class for agent config file errors.
 */
export class AgentConfigError extends Error {
  public readonly filePath: string;

  constructor(message: string, filePath: string) {
    super(`[AgentConfig] ${filePath}: ${message}`);
    this.name = 'AgentConfigError';
    this.filePath = filePath;
  }
}
