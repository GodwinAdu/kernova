/**
 * Nexus Plugin Registry
 * 
 * The plugin system allows developers to extend the runtime with:
 * - Tools (functions agents can call)
 * - Capabilities (reusable skills)
 * - Middleware (intercept intent pipeline)
 * - Providers (custom model providers, storage backends)
 * 
 * Plugins are discovered from:
 * - Project dependencies (node_modules/@nexus-plugin/*)
 * - Local plugins (src/plugins/)
 * - kernova.config.json plugin list
 */

import type { NexusId } from '@kernova/types';
import { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

/** What a plugin provides */
export type PluginType = 'tool' | 'capability' | 'middleware' | 'provider';

/** Tool definition — a function an agent can call */
export interface ToolDefinition {
  /** Unique tool ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** What this tool does */
  description: string;

  /** Input parameters schema (JSON Schema) */
  parameters: Record<string, unknown>;

  /** The function to execute */
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

/** Middleware hook — intercepts the intent pipeline */
export interface MiddlewareHook {
  /** When to run: before or after execution */
  stage: 'before' | 'after';

  /** Priority (lower runs first) */
  priority: number;

  /** The hook function */
  handler: (context: MiddlewareContext) => Promise<MiddlewareContext>;
}

export interface MiddlewareContext {
  intentId: NexusId;
  goal: string;
  agentId?: NexusId;
  result?: unknown;
  metadata: Record<string, unknown>;
  /** Set to true to halt the pipeline */
  halt?: boolean;
}

/** Plugin definition */
export interface NexusPlugin {
  /** Plugin ID */
  id: string;

  /** Plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** What this plugin provides */
  type: PluginType;

  /** Tools provided */
  tools?: ToolDefinition[];

  /** Middleware hooks */
  middleware?: MiddlewareHook[];

  /** Plugin initialization */
  init?: (context: PluginContext) => Promise<void>;

  /** Plugin teardown */
  destroy?: () => Promise<void>;
}

/** Context passed to plugins during init */
export interface PluginContext {
  /** Register a tool */
  registerTool: (tool: ToolDefinition) => void;

  /** Register middleware */
  registerMiddleware: (hook: MiddlewareHook) => void;

  /** Access the event bus */
  events: EventBus;

  /** Emit a plugin event */
  emit: (eventType: string, data: Record<string, unknown>) => void;
}

export class PluginRegistry {
  private plugins: Map<string, NexusPlugin> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private middleware: MiddlewareHook[] = [];
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Register a plugin
   */
  async register(plugin: NexusPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered.`);
    }

    // Create plugin context
    const context: PluginContext = {
      registerTool: (tool) => this.registerTool(tool, plugin.id),
      registerMiddleware: (hook) => this.registerMiddleware(hook),
      events: this.eventBus,
      emit: (eventType, data) => {
        this.eventBus.publish({
          id: generateId('evt'),
          eventType: `plugin.${eventType}`,
          category: 'system',
          severity: 'info',
          timestamp: now(),
          subjectId: plugin.id,
          subjectType: 'plugin',
          actorId: plugin.id,
          correlationId: generateId('cor'),
          data: { pluginId: plugin.id, ...data },
          metadata: {
            schemaVersion: '1.0.0',
            source: `plugin:${plugin.id}`,
            environment: 'development',
          },
        });
      },
    };

    // Initialize plugin
    if (plugin.init) {
      await plugin.init(context);
    }

    // Register provided tools
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.registerTool(tool, plugin.id);
      }
    }

    // Register provided middleware
    if (plugin.middleware) {
      for (const hook of plugin.middleware) {
        this.registerMiddleware(hook);
      }
    }

    this.plugins.set(plugin.id, plugin);

    this.eventBus.publish({
      id: generateId('evt'),
      eventType: 'plugin.registered',
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId: plugin.id,
      subjectType: 'plugin',
      actorId: 'system',
      correlationId: plugin.id,
      data: { name: plugin.name, version: plugin.version, type: plugin.type },
      metadata: { schemaVersion: '1.0.0', source: 'plugin-registry', environment: 'development' },
    });
  }

  /**
   * Unregister a plugin
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    if (plugin.destroy) {
      await plugin.destroy();
    }

    // Remove tools from this plugin
    for (const [toolId, tool] of this.tools.entries()) {
      if (toolId.startsWith(`${pluginId}:`)) {
        this.tools.delete(toolId);
      }
    }

    this.plugins.delete(pluginId);
  }

  /**
   * Get a tool by ID
   */
  getTool(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  /**
   * List all registered tools
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool
   */
  async executeTool(toolId: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool "${toolId}" not found. Available: ${Array.from(this.tools.keys()).join(', ')}`);
    }

    const startTime = Date.now();

    try {
      const result = await tool.execute(params);

      this.eventBus.publish({
        id: generateId('evt'),
        eventType: 'tool.executed',
        category: 'tool',
        severity: 'info',
        timestamp: now(),
        subjectId: toolId,
        subjectType: 'tool',
        actorId: 'system',
        correlationId: generateId('cor'),
        data: { toolId, durationMs: Date.now() - startTime, success: true },
        metadata: { schemaVersion: '1.0.0', source: 'plugin-registry', environment: 'development' },
      });

      return result;
    } catch (error) {
      this.eventBus.publish({
        id: generateId('evt'),
        eventType: 'tool.failed',
        category: 'tool',
        severity: 'error',
        timestamp: now(),
        subjectId: toolId,
        subjectType: 'tool',
        actorId: 'system',
        correlationId: generateId('cor'),
        data: { toolId, error: (error as Error).message },
        metadata: { schemaVersion: '1.0.0', source: 'plugin-registry', environment: 'development' },
      });

      throw error;
    }
  }

  /**
   * Run middleware hooks for a stage
   */
  async runMiddleware(stage: 'before' | 'after', context: MiddlewareContext): Promise<MiddlewareContext> {
    const hooks = this.middleware
      .filter(h => h.stage === stage)
      .sort((a, b) => a.priority - b.priority);

    let ctx = context;
    for (const hook of hooks) {
      ctx = await hook.handler(ctx);
      if (ctx.halt) break;
    }

    return ctx;
  }

  /**
   * Get plugin count
   */
  count(): number {
    return this.plugins.size;
  }

  /**
   * List registered plugins
   */
  list(): NexusPlugin[] {
    return Array.from(this.plugins.values());
  }

  private registerTool(tool: ToolDefinition, pluginId: string): void {
    const fullId = tool.id.includes(':') ? tool.id : `${pluginId}:${tool.id}`;
    this.tools.set(fullId, { ...tool, id: fullId });
  }

  private registerMiddleware(hook: MiddlewareHook): void {
    this.middleware.push(hook);
  }
}
