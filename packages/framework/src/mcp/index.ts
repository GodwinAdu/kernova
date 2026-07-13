/**
 * @kernova/framework MCP Integration
 *
 * Makes MCP (Model Context Protocol) feel invisible to developers.
 * Instead of manually connecting to MCP servers, just declare them:
 *
 *   export default defineAgent({
 *     name: 'DevAgent',
 *     mcp: ['github', 'filesystem', 'slack'],
 *   });
 *
 * The runtime automatically:
 * - Starts the MCP server process
 * - Authenticates
 * - Exposes tools to the agent
 * - Manages sessions
 * - Reconnects on failure
 */

export { MCPManager } from './mcp-manager.js';
export { defineMCP } from './define-mcp.js';
export type { MCPServerConfig, MCPRegistry } from './types.js';
