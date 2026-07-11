/**
 * Kernova SDK — Main Entry Point
 * 
 * The Kernova class provides a high-level, fluent API for:
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
  KernovaKernel,
  defineAgent,
  DaemonRunner,
  type KernovaPlugin,
  type AgentSpec,
  type DaemonConfig,
} from '@kernova/core';
import type { TriggerActionDef } from '@kernova/types';
import type {
  Intent,
  IntentResult,
  MemoryLayer,
  MemoryEntry,
  WorkflowDefinition,
  Priority,
  SDKChannelAdapter,
  InboundMessage,
} from '@kernova/types';

export interface KernovaConfig {
  /** Environment (default: 'development') */
  env?: 'development' | 'staging' | 'production';

  /** Data directory (default: './kernova-data') */
  dataDir?: string;

  /** Disable persistence (default: false) */
  ephemeral?: boolean;

  /** Debug mode (default: false) */
  debug?: boolean;

  /**
   * Configuration for built-in tools (http-fetch, file-read, file-write, shell-exec, date-time, web-search).
   *
   * - `enabled`: whitelist — if set, only these tools are available.
   * - `disabled`: blacklist — these tools are disabled (takes priority over `enabled`).
   * - `sandboxDir`: root directory for file operations.
   * - `shellTimeout`: timeout for shell-exec in ms (default: 30000).
   */
  builtInTools?: {
    enabled?: string[];
    disabled?: string[];
    sandboxDir?: string;
    shellTimeout?: number;
  };
}

/** @deprecated Use KernovaConfig instead. Will be removed in v1.0. */
export type NexusConfig = KernovaConfig;

export interface EnqueueOptions {
  /** Task priority (default: 'medium') */
  priority?: 'critical' | 'high' | 'medium' | 'low';

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
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

export class Kernova {
  private kernel: KernovaKernel;
  private started = false;
  private channelAdapters: Map<string, SDKChannelAdapter> = new Map();
  private globalMessageHandlers: Array<(msg: InboundMessage) => Promise<void>> = [];
  private scheduleHandlers: Map<string, () => Promise<void>> = new Map();

  private constructor(kernel: KernovaKernel) {
    this.kernel = kernel;
  }

  /**
   * Create a new Kernova instance.
   * Starts the kernel automatically.
   * 
   * Usage:
   *   const app = await Kernova.create();
   *   const app = await Kernova.create({ env: 'production', dataDir: './data' });
   */
  static async create(config: KernovaConfig = {}): Promise<Kernova> {
    const kernel = new KernovaKernel({
      environment: config.env || 'development',
      dataDir: config.dataDir,
      ephemeral: config.ephemeral,
      debug: config.debug,
      builtInTools: config.builtInTools,
    });

    await kernel.start();

    const instance = new Kernova(kernel);
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
    const plugin: KernovaPlugin = {
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
   * Start the Kernova instance in daemon mode.
   * Creates a DaemonRunner that handles signal-based graceful shutdown
   * and periodic heartbeat emission.
   * 
   * Returns a promise that resolves when the daemon stops (via SIGINT/SIGTERM or manual stop).
   * 
   * Usage:
   *   await app.serve();
   *   await app.serve({ shutdownTimeoutMs: 10000, heartbeatIntervalMs: 30000 });
   */
  async serve(options: DaemonConfig = {}): Promise<void> {
    const daemon = new DaemonRunner(this.kernel, options);
    return daemon.start();
  }

  /**
   * Register a scheduled job.
   * Accepts a cron expression (string) for recurring jobs
   * or a delay in milliseconds (number) for one-shot jobs.
   * 
   * Usage:
   *   // Recurring cron job
   *   app.schedule('hourly-report', '0 * * * *', async () => { ... });
   * 
   *   // One-shot job (fires once after 5 seconds)
   *   app.schedule('delayed-init', 5000, async () => { ... });
   */
  schedule(name: string, cronOrDelay: string | number, handler: () => Promise<void>): this {
    const scheduler = this.kernel.scheduler;

    if (typeof cronOrDelay === 'number') {
      // One-shot job: delayMs
      scheduler.register({
        name,
        delayMs: cronOrDelay,
        oneShot: true,
        target: {
          type: 'intent',
          goal: `sdk:schedule:${name}`,
          metadata: { _sdkHandler: true },
        },
      });
    } else {
      // Recurring cron job
      scheduler.register({
        name,
        cronExpression: cronOrDelay,
        target: {
          type: 'intent',
          goal: `sdk:schedule:${name}`,
          metadata: { _sdkHandler: true },
        },
      });
    }

    // Store handler in a handlers map for execution
    this.scheduleHandlers.set(name, handler);

    return this;
  }

  /**
   * Plan and execute a goal using the Agent Planner.
   * Decomposes the goal into steps via the LLM and executes them sequentially.
   * 
   * Options:
   * - maxSteps: Maximum number of steps to execute (default: 10)
   * 
   * Usage:
   *   const result = await app.plan('Deploy new version to staging');
   *   const result = await app.plan('Migrate database', { maxSteps: 5 });
   */
  async plan(goal: string, options: { maxSteps?: number } = {}): Promise<IntentResult> {
    const maxSteps = options.maxSteps ?? 10;

    // Use the kernel's planner directly, creating a fresh one with configured maxSteps
    const { AgentPlanner } = await import('@kernova/core');
    const configuredPlanner = new AgentPlanner(
      this.kernel.events,
      this.kernel.models,
      { maxSteps },
    );

    const startTime = Date.now();
    const executionPlan = await configuredPlanner.plan(goal);

    // Execute the plan — each step is submitted as a sub-intent
    const result = await configuredPlanner.execute(executionPlan, async (step) => {
      const intent = await this.kernel.submit({
        goal: step.description,
        intentType: 'action',
        priority: 'medium',
        metadata: { planId: executionPlan.id, stepId: step.id },
      });
      if (!intent.result?.success) {
        throw new Error(intent.result?.summary || `Step failed: ${step.description}`);
      }
      return intent.result;
    });

    const durationMs = Date.now() - startTime;

    return {
      success: result.status === 'completed',
      summary: result.status === 'completed'
        ? `Plan completed: ${result.completedSteps}/${result.totalSteps} steps executed`
        : `Plan ${result.status}: ${result.completedSteps}/${result.totalSteps} steps completed, ${result.failedSteps} failed`,
      data: {
        planId: result.id,
        goal: result.goal,
        status: result.status,
        totalSteps: result.totalSteps,
        completedSteps: result.completedSteps,
        failedSteps: result.failedSteps,
        steps: result.steps.map(s => ({
          description: s.description,
          status: s.status,
          error: s.error,
        })),
      },
      evidence: {
        sources: [],
        confidence: result.status === 'completed' ? 1.0 : result.completedSteps / Math.max(result.totalSteps, 1),
        reasoning: `Executed ${result.completedSteps} of ${result.totalSteps} plan steps`,
      },
      durationMs,
    };
  }

  /**
   * Enqueue a task into the task queue.
   * Returns the unique task ID string.
   * 
   * Usage:
   *   const taskId = await app.enqueue('send-email', { to: 'user@example.com', subject: 'Hi' });
   *   const taskId = await app.enqueue('process-data', payload, { priority: 'high', maxRetries: 5 });
   */
  async enqueue(handler: string, payload: unknown, options: EnqueueOptions = {}): Promise<string> {
    const task = this.kernel.taskQueue.enqueue({
      handler,
      payload,
      priority: options.priority as Priority | undefined,
      maxRetries: options.maxRetries,
    });
    return task.id;
  }

  /**
   * Register a channel adapter with a name.
   * The adapter will be connected when `serve()` is called, or can be manually connected.
   * 
   * Usage:
   *   app.channel('webhooks', new WebhookChannelAdapter({ port: 3100 }));
   *   app.channel('ws', new WebSocketChannelAdapter({ port: 3200 }));
   */
  channel(name: string, adapter: SDKChannelAdapter): this {
    this.channelAdapters.set(name, adapter);

    // Wire the adapter's messages to global handlers
    adapter.onMessage(async (msg) => {
      for (const handler of this.globalMessageHandlers) {
        await handler(msg);
      }
    });

    return this;
  }

  /**
   * Register a global message handler that receives messages from all channel adapters.
   * 
   * Usage:
   *   app.onMessage(async (msg) => {
   *     console.log(`Message from ${msg.sender}: ${msg.content}`);
   *   });
   */
  onMessage(handler: (msg: InboundMessage) => Promise<void>): this {
    this.globalMessageHandlers.push(handler);
    return this;
  }

  /**
   * Register a proactive trigger rule.
   * When events matching `eventPattern` are published on the EventBus,
   * the specified action (intent goal) is submitted automatically.
   * 
   * Event patterns use glob-style wildcards:
   * - `channel.message.*` matches `channel.message.received`
   * - `*.created` matches `intent.created`, `agent.created`
   * 
   * Usage:
   *   app.trigger('on-message', 'channel.message.*', { goal: 'Process incoming message' });
   *   app.trigger('on-error', 'intent.failed', { goal: 'Handle failure', priority: 'high' });
   */
  trigger(name: string, eventPattern: string, action: TriggerActionDef): this {
    this.kernel.triggers.register({
      name,
      eventPattern,
      action,
      cooldownMs: action.cooldownMs,
    });
    return this;
  }

  /**
   * Get a ThreadHandle for a named conversation thread.
   * Creates the thread if it doesn't exist.
   * 
   * The ThreadHandle provides `addMessage(role, content)` and `getContext()` methods
   * for managing conversation history with automatic sliding window enforcement.
   * 
   * Usage:
   *   const thread = app.thread('support-session-123');
   *   await thread.addMessage('user', 'Hello, I need help');
   *   const ctx = thread.getContext();
   */
  thread(threadId: string): ThreadHandle {
    return new ThreadHandle(threadId, this.kernel.conversation);
  }

  /**
   * Get the underlying kernel (for advanced usage).
   */
  getKernel(): KernovaKernel {
    return this.kernel;
  }

  /**
   * Shut down the Kernova instance.
   */
  async close(): Promise<void> {
    if (this.started) {
      // Disconnect all channel adapters
      for (const adapter of this.channelAdapters.values()) {
        await adapter.disconnect().catch(() => {});
      }
      this.channelAdapters.clear();

      await this.kernel.stop();
      this.started = false;
    }
  }
}

/** @deprecated Use Kernova instead. Will be removed in v1.0. */
export const Nexus = Kernova;
/** @deprecated Use Kernova instead. Will be removed in v1.0. */
export type Nexus = Kernova;

/**
 * ThreadHandle — A lightweight wrapper around ConversationManager
 * for interacting with a specific named conversation thread.
 * 
 * Provides:
 * - addMessage(role, content): add a message to the thread
 * - getContext(): get the active context (summary + recent messages)
 */
export class ThreadHandle {
  constructor(
    public readonly threadId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly conversationManager: any,
  ) {
    // Ensure the thread exists
    this.conversationManager.create(this.threadId);
  }

  /**
   * Add a message to this thread.
   * Sliding window is automatically enforced after adding.
   */
  async addMessage(role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    await this.conversationManager.addMessageToThread(this.threadId, role, content);
  }

  /**
   * Get the current conversation context for this thread.
   * Returns the summary of older messages and the active messages within the window.
   */
  getContext(): { summary: string | null; messages: Array<{ role: string; content: string }> } {
    return this.conversationManager.getThreadContext(this.threadId);
  }
}
