/**
 * Built-In Tool Registry
 *
 * Manages the set of pre-packaged tools shipped with @kernova/core.
 * Tools are registered as an internal plugin via the PluginRegistry.
 *
 * Supports enable/disable configuration per tool and sandbox enforcement
 * for file-system and shell operations.
 *
 * Tools that can run code or touch the file system or a database are off by default
 * (see UNSAFE_BUILT_IN_TOOLS). Enable them explicitly, and only for agents whose
 * input you trust: a prompt injection in any page or message the agent reads can
 * make the model call them.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';
import type { ModelRouter } from '../models/model-router.js';
import { createHttpFetchTool } from './http-fetch.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createShellExecTool } from './shell-exec.js';
import { createDateTimeTool } from './date-time.js';
import { createWebSearchTool } from './web-search.js';
import { createJsonParseTool } from './json-parse.js';
import { createMathEvalTool } from './math-eval.js';
import { createRegexMatchTool } from './regex-match.js';
import { createImageDescribeTool } from './image-describe.js';
import { createDatabaseQueryTool } from './database-query.js';
import { createCodeEvalTool } from './code-eval.js';
import type { HttpFetchOptions } from './http-fetch.js';
import type { ShellExecOptions } from './shell-exec.js';
import type { WebSearchProvider } from './web-search.js';

export { SandboxViolationError } from './sandbox-error.js';
export { createFileReadTool, validateSandboxPath } from './file-read.js';
export { isPrivateAddress } from './http-fetch.js';
export type { HttpFetchOptions } from './http-fetch.js';
export type { ShellExecOptions } from './shell-exec.js';

/** Tools that run code or touch the file system or a database. Off unless listed in `enabled`. */
export const UNSAFE_BUILT_IN_TOOLS: readonly string[] = [
  'file-read',
  'file-write',
  'shell-exec',
  'code-eval',
  'database-query',
];

/** Tools available when no `enabled` list is given. */
export const DEFAULT_BUILT_IN_TOOLS: readonly string[] = [
  'http-fetch',
  'date-time',
  'web-search',
  'json-parse',
  'math-eval',
  'regex-match',
  'image-describe',
];

export interface BuiltInToolConfig {
  /**
   * Whitelist of enabled tool IDs. If set, only these tools are available.
   * If not set, DEFAULT_BUILT_IN_TOOLS are available. To add an unsafe tool to the
   * defaults: `enabled: [...DEFAULT_BUILT_IN_TOOLS, 'shell-exec']`.
   */
  enabled?: string[];

  /** Blacklist of disabled tool IDs. Disabled overrides enabled. */
  disabled?: string[];

  /** Root directory for file operations (sandbox boundary). */
  sandboxDir?: string;

  /** Timeout for shell-exec in milliseconds; also the maximum the model can request (default: 30000). */
  shellTimeout?: number;

  /** Extra environment variables for shell-exec commands. The host environment is not passed through. */
  shellEnv?: ShellExecOptions['env'];

  /** http-fetch settings: private-network access, response size cap, timeout. */
  httpFetch?: HttpFetchOptions;

  /** Search backend for the web-search tool. Without one, web-search is not offered to agents. */
  webSearchProvider?: WebSearchProvider;

  /** ModelRouter instance for vision-capable tools (image-describe). */
  modelRouter?: ModelRouter;

  /** Path to the SQLite database for the database-query tool. Required for that tool; opened read-only. */
  databasePath?: string;

  /** Timeout for code-eval in milliseconds; also the maximum the model can request (default: 5000). */
  codeEvalTimeout?: number;
}

export class BuiltInToolRegistry {
  private readonly config: BuiltInToolConfig;
  private readonly allTools: ToolDefinition[];

  constructor(config: BuiltInToolConfig = {}) {
    this.config = config;

    const sandboxDir = config.sandboxDir || process.cwd();
    const shellTimeout = config.shellTimeout ?? 30000;

    this.allTools = [
      createHttpFetchTool(config.httpFetch),
      createFileReadTool(sandboxDir),
      createFileWriteTool(sandboxDir),
      createShellExecTool(sandboxDir, shellTimeout, { env: config.shellEnv }),
      createDateTimeTool(),
      createJsonParseTool(),
      createMathEvalTool(),
      createRegexMatchTool(),
      createCodeEvalTool(config.codeEvalTimeout),
    ];

    // Add web-search only when there is a provider to search with
    if (config.webSearchProvider) {
      this.allTools.push(createWebSearchTool(config.webSearchProvider));
    }

    // Add image-describe tool if ModelRouter is available
    if (config.modelRouter) {
      this.allTools.push(createImageDescribeTool(config.modelRouter));
    }

    // Add database-query tool if a database path is configured
    if (config.databasePath) {
      this.allTools.push(createDatabaseQueryTool(config.databasePath));
    }
  }

  /**
   * Returns tools that are enabled based on the current configuration.
   */
  getTools(): ToolDefinition[] {
    return this.allTools.filter((tool) => this.isEnabled(tool.id));
  }

  /**
   * Check if a specific tool is enabled.
   *
   * Logic:
   * - If `disabled` list includes the tool, it is disabled (takes priority).
   * - If `enabled` list is defined, only tools in that list are enabled.
   * - Otherwise, every tool except UNSAFE_BUILT_IN_TOOLS is enabled.
   */
  isEnabled(toolId: string): boolean {
    if (this.config.disabled?.includes(toolId)) {
      return false;
    }
    if (this.config.enabled && this.config.enabled.length > 0) {
      return this.config.enabled.includes(toolId);
    }
    return !UNSAFE_BUILT_IN_TOOLS.includes(toolId);
  }
}
