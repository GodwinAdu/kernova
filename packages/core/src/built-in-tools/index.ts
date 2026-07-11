/**
 * Built-In Tool Registry
 *
 * Manages the set of pre-packaged tools shipped with @kernova/core.
 * Tools are registered as an internal plugin via the PluginRegistry.
 *
 * Supports enable/disable configuration per tool and sandbox enforcement
 * for file-system and shell operations.
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

export { SandboxViolationError } from './sandbox-error.js';
export { createFileReadTool, validateSandboxPath } from './file-read.js';

export interface BuiltInToolConfig {
  /** Whitelist of enabled tool IDs. If set, only these tools are available. */
  enabled?: string[];

  /** Blacklist of disabled tool IDs. Disabled overrides enabled. */
  disabled?: string[];

  /** Root directory for file operations (sandbox boundary). */
  sandboxDir?: string;

  /** Timeout for shell-exec in milliseconds (default: 30000). */
  shellTimeout?: number;

  /** ModelRouter instance for vision-capable tools (image-describe). */
  modelRouter?: ModelRouter;

  /** Path to SQLite database file for database-query tool. */
  databasePath?: string;

  /** Default timeout for code-eval in milliseconds (default: 5000). */
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
      createHttpFetchTool(),
      createFileReadTool(sandboxDir),
      createFileWriteTool(sandboxDir),
      createShellExecTool(sandboxDir, shellTimeout),
      createDateTimeTool(),
      createWebSearchTool(),
      createJsonParseTool(),
      createMathEvalTool(),
      createRegexMatchTool(),
      createCodeEvalTool(config.codeEvalTimeout),
    ];

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
   * - Otherwise, all tools are enabled by default.
   */
  isEnabled(toolId: string): boolean {
    if (this.config.disabled?.includes(toolId)) {
      return false;
    }
    if (this.config.enabled && this.config.enabled.length > 0) {
      return this.config.enabled.includes(toolId);
    }
    return true;
  }
}
