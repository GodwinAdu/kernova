/**
 * @kernova/framework/server
 *
 * Server-side runtime that boots the KernovaKernel, discovers agents/tools
 * from the file system, and exposes the Gateway API.
 *
 * Used internally by `kernova dev` and `kernova start`.
 */

export { createServer } from './create-server.js';
export { discoverAgents } from './discover-agents.js';
export { discoverTools } from './discover-tools.js';
export { discoverMemory } from './discover-memory.js';
export { discoverMiddleware, MiddlewarePipeline } from './middleware-pipeline.js';
export { loadConfig } from './load-config.js';
export { DevServer } from './dev-server.js';

export type { ServerOptions } from './create-server.js';
export type { DiscoveredMiddleware } from './middleware-pipeline.js';
