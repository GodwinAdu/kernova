/**
 * Nexus SDK — Main Entry Point
 * 
 * The Nexus class provides a high-level, fluent API for:
 * - Creating and configuring the runtime
 * - Defining agents (one-liner)
 * - Registering tools
 * - Submitting intents (asking questions, running actions)
 * - Managing memory
 * 
 * Design goals:
 * - Minimal boilerplate (3 lines to get started)
 * - Sensible defaults (works without configuration)
 * - Progressive complexity (simple things simple, complex things possible)
 */

import {
  NexusKernel,
  defineAgent,
  type KernelConfig,
  type NexusPlugin,
  type ToolDefinition,
  type AgentSpec,
  type DefinedAgent,
} from '@nexus/core';
import type {
  Intent,
  IntentResult,
  MemoryLayer,
  MemoryEntry,
  WorkflowDefinition,
} from '@nexus/types';

export interface NexusConfig {
  /** Environment (default: 'development') */
  env?: 'development' | 'staging' | 'production';

  /** Data directory (default: './nexus-data') */
  dataDir?: string;

  /** Disable persistence (default: false) */
  ephemeral?: boolean;

  /** Debug mode (default: false) */
  debug?: boolean;
}

export interface AskOptions {
  /** Intent type */
  type?: Intent['intentType'];

  /** Priority */
  priority?: Intent['priority'];

  /** Owner */
  owner?: string;
}

export interface AskResult {
  /** Whether the intent succeeded */
  success: boolean;

  /** The response text */
  answer: string;

  /** Full intent result with evidence */
  intent: Intent;

  /** Duration in ms */
  durationMs: number;
}

export class Nexus {
  private kernel: NexusKernel;
  private started = false;

  private constructor(kernel: NexusKernel) {
    this.kernel = kernel;
  }

  /**
   * Create a new Nexus instance.
   * Starts the kernel automatically.
   * 
   * Usage:
   *   const app = await Nexus.create();
   *   const app = await Nexus.create({ env: 'production', dataDir: './data' });
   */
  static async create(config: NexusConfig = {}): Promise<Nexus> {
    const kernel = new NexusKernel({
      environment: config.env || 'development',
      dataDir: config.dataDir,
      ephemeral: config.ephemeral,
      debug: config.debug,
    });

    await kernel.start();

    const instance = new Nexus(kernel);
    instance.started = true;
    return instance;
  }

  /**
   * Define an agent with minimal configuration.
   * 
   * Usage:
   *   app.agent('assistant', { instructions: 'You are helpful.' });
   *   app.agent('reviewer', {
   *     instructions: 'Review code for bugs.',
   *     execute: async (intent, ctx, tools) => { ... }
   *   });
   */
  agent(name: string, spec: Partial<AgentSpec> & { instructions: string }): this {
    const defined = defineAgent({
      name,
      description: spec.description || name,
      capabilities: spec.capabilities || [
        { id: name, name, description: spec.description || name, confidence: 0.8 },
      ],
      tools: spec.tools || [],
      instructions: spec.instructions,
      execute: spec.execute,
    });

    this.kernel.agentRegistry.register(defined.definition, defined.executor);
    return this;
  }

  /**
   * Register a tool that agents can use.
   * 
   * Usage:
   *   app.tool('search', {
   *     description: 'Search the web',
   *     parameters: { query: { type: 'string' } },
   *     execute: async ({ query }) => fetch(`...${query}`)
   *   });
   */
  tool(name: string, spec: {
    description: string;
    parameters?: Record<string, unknown>;
    execute: (params: Record<string, unknown>) => Promise<unknown>;
  }): this {
    const plugin: NexusPlugin = {
      id: `sdk-tool:${name}`,
      name,
      version: '1.0.0',
      type: 'tool',
      tools: [{
        id: name,
        name,
        description: spec.description,
        parameters: spec.parameters || { type: 'object', properties: {} },
        execute: spec.execute,
      }],
    };

    this.kernel.plugins.register(plugin);
    return this;
  }

  /**
   * Ask a question or submit an intent.
   * Returns the agent's response.
   */
  async ask(goal: string, options: AskOptions = {}): Promise<AskResult> {
    const intent = await this.kernel.submit({
      goal,
      intentType: options.type || 'query',
      priority: options.priority || 'medium',
      owner: options.owner,
    });

    return {
      success: intent.result?.success ?? false,
      answer: intent.result?.summary ?? '',
      intent,
      durationMs: intent.result?.durationMs ?? 0,
    };
  }

  /**
   * Stream a response token-by-token.
   * 
   * Usage:
   *   for await (const token of app.stream('Tell me a story')) {
   *     process.stdout.write(token);
   *   }
   */
  async *stream(goal: string): AsyncGenerator<string> {
    const router = this.kernel.models;
    for await (const chunk of router.stream({
      messages: [{ role: 'user', content: goal }],
      model: '',
    })) {
      if (chunk.content) yield chunk.content;
    }
  }

  /**
   * Store a memory.
   * 
   * Usage:
   *   await app.remember('User prefers TypeScript', 'longterm');
   */
  async remember(content: string, layer: MemoryLayer = 'longterm', tags: string[] = []): Promise<MemoryEntry> {
    return this.kernel.memoryEngine.store({ content, layer, tags });
  }

  /**
   * Search memories.
   * 
   * Usage:
   *   const memories = await app.recall('TypeScript');
   */
  async recall(query: string, options: { layer?: MemoryLayer; limit?: number } = {}): Promise<MemoryEntry[]> {
    return this.kernel.memoryEngine.query({
      query,
      layers: options.layer ? [options.layer] : undefined,
      limit: options.limit || 10,
    });
  }

  /**
   * Register a workflow definition.
   */
  workflow(definition: WorkflowDefinition): this {
    this.kernel.workflows.define(definition);
    return this;
  }

  /**
   * Run a registered workflow.
   */
  async runWorkflow(definitionId: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const instance = await this.kernel.workflows.execute(definitionId, input);
    return instance;
  }

  /**
   * Get the underlying kernel (for advanced usage).
   */
  getKernel(): NexusKernel {
    return this.kernel;
  }

  /**
   * Shut down the Nexus instance.
   */
  async close(): Promise<void> {
    if (this.started) {
      await this.kernel.stop();
      this.started = false;
    }
  }
}
