/**
 * defineMCP — Declare an MCP server configuration.
 *
 * Usage:
 *   // mcp/github.ts
 *   import { defineMCP } from '@kernova/framework';
 *
 *   export default defineMCP({
 *     name: 'github',
 *     command: 'uvx',
 *     args: ['mcp-server-github'],
 *     env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
 *     autoApprove: ['list_repos', 'get_file'],
 *   });
 */

import type { MCPServerConfig } from './types.js';

export function defineMCP(config: MCPServerConfig): MCPServerConfig {
  if (!config.name) {
    throw new Error('defineMCP: "name" is required');
  }
  if (!config.command) {
    throw new Error('defineMCP: "command" is required');
  }

  return {
    autoStart: true,
    autoApprove: [],
    args: [],
    env: {},
    ...config,
  };
}
