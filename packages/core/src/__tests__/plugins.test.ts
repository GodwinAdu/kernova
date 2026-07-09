/**
 * Plugin Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import type { NexusPlugin } from '../plugins/plugin-registry.js';
import { EventBus } from '../events/event-bus.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
    registry = new PluginRegistry(eventBus);
  });

  afterEach(async () => {
    await eventBus.stop();
  });

  it('should register a plugin', async () => {
    const plugin: NexusPlugin = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      type: 'tool',
      tools: [{
        id: 'echo',
        name: 'echo',
        description: 'Echoes input',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
        execute: async (params) => params.text,
      }],
    };

    await registry.register(plugin);
    expect(registry.count()).toBe(1);
  });

  it('should prevent duplicate plugin registration', async () => {
    const plugin: NexusPlugin = {
      id: 'dupe', name: 'Dupe', version: '1.0.0', type: 'tool',
    };

    await registry.register(plugin);
    await expect(registry.register(plugin)).rejects.toThrow('already registered');
  });

  it('should execute tools', async () => {
    const plugin: NexusPlugin = {
      id: 'math',
      name: 'Math',
      version: '1.0.0',
      type: 'tool',
      tools: [{
        id: 'add',
        name: 'add',
        description: 'Adds two numbers',
        parameters: {},
        execute: async (params) => (params.a as number) + (params.b as number),
      }],
    };

    await registry.register(plugin);
    const result = await registry.executeTool('math:add', { a: 2, b: 3 });
    expect(result).toBe(5);
  });

  it('should throw on unknown tool', async () => {
    await expect(registry.executeTool('nonexistent', {}))
      .rejects.toThrow('not found');
  });

  it('should list tools', async () => {
    const plugin: NexusPlugin = {
      id: 'multi',
      name: 'Multi',
      version: '1.0.0',
      type: 'tool',
      tools: [
        { id: 'tool-a', name: 'A', description: 'A', parameters: {}, execute: async () => 'a' },
        { id: 'tool-b', name: 'B', description: 'B', parameters: {}, execute: async () => 'b' },
      ],
    };

    await registry.register(plugin);
    const tools = registry.listTools();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toContain('A');
    expect(tools.map(t => t.name)).toContain('B');
  });

  it('should run middleware hooks', async () => {
    const plugin: NexusPlugin = {
      id: 'middleware-test',
      name: 'Middleware',
      version: '1.0.0',
      type: 'middleware',
      middleware: [{
        stage: 'before',
        priority: 1,
        handler: async (ctx) => {
          ctx.metadata.modified = true;
          return ctx;
        },
      }],
    };

    await registry.register(plugin);

    const result = await registry.runMiddleware('before', {
      intentId: 'test',
      goal: 'test',
      metadata: {},
    });

    expect(result.metadata.modified).toBe(true);
  });

  it('should support middleware halt', async () => {
    const plugin: NexusPlugin = {
      id: 'halt-test',
      name: 'Halt',
      version: '1.0.0',
      type: 'middleware',
      middleware: [
        { stage: 'before', priority: 1, handler: async (ctx) => { ctx.halt = true; return ctx; } },
        { stage: 'before', priority: 2, handler: async (ctx) => { ctx.metadata.ran = true; return ctx; } },
      ],
    };

    await registry.register(plugin);
    const result = await registry.runMiddleware('before', { intentId: 'test', goal: 'test', metadata: {} });

    expect(result.halt).toBe(true);
    expect(result.metadata.ran).toBeUndefined(); // Second hook never ran
  });

  it('should unregister plugins', async () => {
    const plugin: NexusPlugin = {
      id: 'removable', name: 'R', version: '1.0.0', type: 'tool',
      tools: [{ id: 'x', name: 'X', description: 'X', parameters: {}, execute: async () => null }],
    };

    await registry.register(plugin);
    expect(registry.count()).toBe(1);

    await registry.unregister('removable');
    expect(registry.count()).toBe(0);
  });
});
