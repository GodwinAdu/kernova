/**
 * Kernova Plugin System
 * 
 * Extends the runtime with tools, capabilities, middleware, and providers.
 */

export { PluginRegistry } from './plugin-registry.js';
export type {
  KernovaPlugin,
  NexusPlugin, // deprecated alias of KernovaPlugin
  ToolDefinition,
  MiddlewareHook,
  MiddlewareContext,
  PluginContext,
  PluginType,
} from './plugin-registry.js';
