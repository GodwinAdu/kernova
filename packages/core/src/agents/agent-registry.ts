/**
 * Kernova Agent Registry
 * 
 * Manages agent definitions and instances.
 * Handles agent selection, lifecycle, and execution routing.
 */

import type {
  AgentDefinition,
  AgentInstance,
  Intent,
  IntentResult,
  ComputedContext,
  KernovaId,
  ToolSpec,
  ModelMessage,
  CompletionRequest,
} from '@kernova/types';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import type { PluginRegistry, ToolDefinition } from '../plugins/plugin-registry.js';
import { AgentCoordinator, type DelegationResult } from './coordinator.js';
import { generateId, now } from '../utils.js';

/** Agent executor function — the actual logic of an agent */
export type AgentExecutor = (
  intent: Intent,
  context: ComputedContext,
  tools: AgentTools,
) => Promise<IntentResult>;

/** Tools available to an agent during execution */
export interface AgentTools {
  /** Emit a sub-event */
  emit: (eventType: string, data: Record<string, unknown>) => void;

  /** Store a memory */
  remember: (content: string, layer?: string) => Promise<void>;

  /** Query memories */
  recall: (query: string) => Promise<string[]>;

  /** Log a message */
  log: (message: string) => void;

  /** Call the LLM directly (simple text completion) */
  complete: (prompt: string) => Promise<string>;

  /**
   * Stream a response from the LLM token-by-token.
   * Returns an async generator yielding text chunks.
   */
  stream: (prompt: string) => AsyncGenerator<string>;

  /**
   * Stream and collect the full response as a string.
   * Convenience wrapper over stream() that concatenates all chunks.
   */
  streamToString: (prompt: string) => Promise<string>;

  /**
   * Call the LLM with tool-calling enabled.
   * The LLM can invoke registered plugin tools and reason over results.
   * Returns the final text response after all tool calls are resolved.
   */
  completeWithTools: (prompt: string, toolNames?: string[]) => Promise<string>;

  /** Execute a plugin tool directly */
  useTool: (toolId: string, params: Record<string, unknown>) => Promise<unknown>;

  /** List available tools */
  listTools: () => ToolDefinition[];

  /** Delegate a task to a specific named agent */
  delegate: (agentName: string, goal: string) => Promise<DelegationResult>;

  /** Ask any agent (kernel picks the best one) */
  ask: (goal: string) => Promise<DelegationResult>;

  /** Broadcast to all agents, return first success */
  broadcast: (goal: string) => Promise<DelegationResult>;
}

interface RegisteredAgent {
  definition: AgentDefinition;
  executor: AgentExecutor;
}

export class AgentRegistry {
  private agents: Map<KernovaId, RegisteredAgent> = new Map();
  private instances: Map<KernovaId, AgentInstance> = new Map();
  private eventBus: EventBus;
  private modelRouter: ModelRouter;
  private pluginRegistry: PluginRegistry | null = null;
  private memoryEngine: any = null; // Set by kernel
  private coordinator: AgentCoordinator;
  private debug = false;

  constructor(eventBus: EventBus, modelRouter: ModelRouter) {
    this.eventBus = eventBus;
    this.modelRouter = modelRouter;
    this.coordinator = new AgentCoordinator(this, eventBus);
  }

  /** Connect the plugin registry (called by kernel after construction) */
  setPluginRegistry(registry: PluginRegistry): void {
    this.pluginRegistry = registry;
  }

  /** Connect the memory engine (called by kernel after construction) */
  setMemoryEngine(memory: any): void {
    this.memoryEngine = memory;
  }

  /** Print agent `log()` messages to the console (off by default; they are always emitted as events) */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  async start(): Promise<void> {
    // Initialize agent system
  }

  async stop(): Promise<void> {
    // Gracefully shut down all agent instances
    for (const instance of this.instances.values()) {
      instance.state = 'offline';
    }
  }

  /**
   * Register an agent definition with its executor
   */
  register(definition: AgentDefinition, executor: AgentExecutor): void {
    this.agents.set(definition.id, { definition, executor });

    this.eventBus.publish({
      id: generateId('evt'),
      eventType: 'agent.registered',
      category: 'agent',
      severity: 'info',
      timestamp: now(),
      subjectId: definition.id,
      subjectType: 'agent_definition',
      actorId: 'system',
      correlationId: definition.id,
      data: {
        name: definition.name,
        capabilities: definition.capabilities.map(c => c.name),
      },
      metadata: {
        schemaVersion: '1.0.0',
        source: 'agent-registry',
        environment: 'development',
      },
    });
  }

  /**
   * Select the best agent for a given intent.
   * Uses capability matching to score agents and pick the best fit.
   */
  async selectAgent(intent: Intent, context: ComputedContext): Promise<AgentInstance | null> {
    if (this.agents.size === 0) return null;

    // Score each agent based on capability match
    let bestScore = -1;
    let bestDefinition: AgentDefinition | null = null;

    for (const [_, { definition }] of this.agents) {
      const score = this.scoreAgent(definition, intent);
      if (score > bestScore) {
        bestScore = score;
        bestDefinition = definition;
      }
    }

    if (!bestDefinition) return null;
    return this.getOrCreateInstance(bestDefinition);
  }

  /**
   * Score an agent's fit for an intent (higher is better).
   * Considers capability confidence, description match, and intent type.
   */
  private scoreAgent(definition: AgentDefinition, intent: Intent): number {
    let score = 0;

    // Base score from capabilities
    for (const cap of definition.capabilities) {
      score += cap.confidence;
    }

    // Bonus if agent description mentions keywords from the goal
    const goalWords = intent.goal.toLowerCase().split(/\s+/);
    const descWords = definition.description.toLowerCase();
    for (const word of goalWords) {
      if (word.length > 3 && descWords.includes(word)) {
        score += 0.2;
      }
    }

    // Bonus for capability name matching intent type
    for (const cap of definition.capabilities) {
      if (cap.id === intent.intentType || cap.name.toLowerCase() === intent.intentType) {
        score += 0.5;
      }
    }

    return score;
  }

  /**
   * Select an agent by name (for delegation)
   */
  async selectAgentByName(name: string, intent: Intent, context: ComputedContext): Promise<AgentInstance | null> {
    for (const [id, { definition }] of this.agents) {
      if (definition.name === name) {
        return this.getOrCreateInstance(definition);
      }
    }
    return null;
  }

  /**
   * Execute an intent through a specific agent
   *
   * @param options.allowedTools - IDs of the plugin tools this execution may see and call
   *   (after tool policies). All registered tools when omitted.
   */
  async execute(
    instance: AgentInstance,
    intent: Intent,
    context: ComputedContext,
    options: { allowedTools?: string[] } = {},
  ): Promise<IntentResult> {
    const registered = this.agents.get(instance.definitionId);
    if (!registered) {
      throw new Error(`No executor found for agent ${instance.definitionId}`);
    }

    // Update instance state
    instance.state = 'executing';
    instance.activeIntents.push(intent.id);

    const allowed = options.allowedTools ? new Set(options.allowedTools) : null;
    const visibleTools = (): ToolDefinition[] => {
      const all = this.pluginRegistry?.listTools() ?? [];
      return allowed ? all.filter(t => allowed.has(t.id)) : all;
    };

    // Earlier turns of the conversation thread (if any) go between the instructions and the prompt
    const history: ModelMessage[] = (context.conversation ?? []).map(turn => ({
      role: turn.role,
      content: turn.content,
    }));
    const messagesFor = (prompt: string): ModelMessage[] => [
      { role: 'system', content: registered.definition.instructions },
      ...history,
      { role: 'user', content: prompt },
    ];

    // Create tools interface for this execution
    const self = this;
    const tools: AgentTools = {
      emit: (eventType, data) => {
        this.eventBus.publish({
          id: generateId('evt'),
          eventType: `agent.${eventType}`,
          category: 'agent',
          severity: 'info',
          timestamp: now(),
          subjectId: instance.id,
          subjectType: 'agent_instance',
          actorId: instance.id,
          correlationId: intent.id,
          data,
          metadata: {
            schemaVersion: '1.0.0',
            source: registered.definition.name,
            environment: 'development',
          },
        });
      },
      remember: async (content, layer) => {
        if (self.memoryEngine) {
          await self.memoryEngine.store({
            content,
            layer: (layer as any) || 'session',
            owner: intent.owner,
            source: { type: 'agent', ref: instance.id },
          });
        }
      },
      recall: async (query) => {
        if (self.memoryEngine) {
          const results = await self.memoryEngine.query({ query, ownerId: intent.owner, limit: 5 });
          return results.map((m: any) => m.content);
        }
        return [];
      },
      log: (message) => {
        tools.emit('log', { message });
        if (self.debug) console.log(`[Agent:${registered.definition.name}] ${message}`);
      },
      complete: async (prompt: string) => {
        const response = await this.modelRouter.complete({
          messages: messagesFor(prompt),
          ...self.modelSettings(registered.definition),
          metadata: {
            intentId: intent.id,
            agentId: instance.id,
            purpose: 'reasoning',
          },
        });
        instance.metrics.tokensConsumed += response.usage.totalTokens;
        return response.content;
      },
      stream: async function*(prompt: string) {
        const generator = self.modelRouter.stream({
          messages: messagesFor(prompt),
          ...self.modelSettings(registered.definition),
          metadata: {
            intentId: intent.id,
            agentId: instance.id,
            purpose: 'reasoning',
          },
        });
        for await (const chunk of generator) {
          if (chunk.content) yield chunk.content;
          if (chunk.done && chunk.usage) {
            instance.metrics.tokensConsumed += chunk.usage.totalTokens;
          }
        }
      },
      streamToString: async (prompt: string) => {
        let result = '';
        const generator = self.modelRouter.stream({
          messages: messagesFor(prompt),
          ...self.modelSettings(registered.definition),
          metadata: { intentId: intent.id, agentId: instance.id, purpose: 'reasoning' },
        });
        for await (const chunk of generator) {
          result += chunk.content;
          if (chunk.done && chunk.usage) {
            instance.metrics.tokensConsumed += chunk.usage.totalTokens;
          }
        }
        return result;
      },
      completeWithTools: async (prompt: string, toolNames?: string[]) => {
        return self.completeWithToolLoop(registered, instance, intent, messagesFor(prompt), visibleTools(), toolNames);
      },
      useTool: async (toolId: string, params: Record<string, unknown>) => {
        if (!self.pluginRegistry) {
          throw new Error('Plugin registry not available. Cannot use tools.');
        }
        const tool = self.pluginRegistry.getTool(toolId);
        if (tool && allowed && !allowed.has(tool.id)) {
          throw new Error(`Tool "${toolId}" is not allowed for this agent.`);
        }
        return self.pluginRegistry.executeTool(toolId, params);
      },
      listTools: () => visibleTools(),
      delegate: async (agentName: string, goal: string) => {
        const depth = (intent.metadata?.depth as number) || 0;
        return self.coordinator.delegate(agentName, goal, intent.id, depth, context);
      },
      ask: async (goal: string) => {
        const depth = (intent.metadata?.depth as number) || 0;
        return self.coordinator.ask(goal, intent.id, depth, context);
      },
      broadcast: async (goal: string) => {
        const depth = (intent.metadata?.depth as number) || 0;
        return self.coordinator.broadcast(goal, intent.id, depth, context);
      },
    };

    const startTime = Date.now();

    try {
      const result = await registered.executor(intent, context, tools);

      // Update metrics
      instance.metrics.intentsProcessed++;
      instance.metrics.avgResponseMs =
        (instance.metrics.avgResponseMs * (instance.metrics.intentsProcessed - 1) + (Date.now() - startTime)) /
        instance.metrics.intentsProcessed;

      if (result.success) {
        instance.metrics.successRate =
          ((instance.metrics.successRate * (instance.metrics.intentsProcessed - 1)) + 1) /
          instance.metrics.intentsProcessed;
      }

      return result;
    } finally {
      // Remove from active intents
      instance.activeIntents = instance.activeIntents.filter(id => id !== intent.id);
      instance.state = instance.activeIntents.length > 0 ? 'executing' : 'idle';
    }
  }

  /**
   * Get or create an instance for a definition
   */
  private getOrCreateInstance(definition: AgentDefinition): AgentInstance {
    // Look for existing idle instance
    for (const instance of this.instances.values()) {
      if (instance.definitionId === definition.id && instance.state === 'idle') {
        return instance;
      }
    }

    // Create new instance
    const instance: AgentInstance = {
      id: generateId('agent_inst'),
      type: 'agent_instance',
      version: '1.0.0',
      owner: definition.owner,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      metadata: {},
      definitionId: definition.id,
      state: 'idle',
      activeIntents: [],
      metrics: {
        intentsProcessed: 0,
        successRate: 0,
        avgResponseMs: 0,
        tokensConsumed: 0,
        uptimeMs: 0,
      },
    };

    this.instances.set(instance.id, instance);
    return instance;
  }

  /**
   * Unregister an agent by definition ID.
   * Removes the agent definition and any associated instances.
   */
  unregister(definitionId: KernovaId): boolean {
    const registered = this.agents.get(definitionId);
    if (!registered) return false;

    this.agents.delete(definitionId);

    // Remove associated instances
    for (const [instanceId, instance] of this.instances) {
      if (instance.definitionId === definitionId) {
        instance.state = 'offline';
        this.instances.delete(instanceId);
      }
    }

    this.eventBus.publish({
      id: generateId('evt'),
      eventType: 'agent.unregistered',
      category: 'agent',
      severity: 'info',
      timestamp: now(),
      subjectId: definitionId,
      subjectType: 'agent_definition',
      actorId: 'system',
      correlationId: definitionId,
      data: {
        name: registered.definition.name,
      },
      metadata: {
        schemaVersion: '1.0.0',
        source: 'agent-registry',
        environment: 'development',
      },
    });

    return true;
  }

  /** Get registered agent count */
  count(): number {
    return this.agents.size;
  }

  /** List all registered agents */
  list(): AgentDefinition[] {
    return Array.from(this.agents.values()).map(a => a.definition);
  }

  /**
   * The model settings an agent's calls use: its first model reference (provider and/or model)
   * and its temperature, maxTokens, reasoning, response format, and prompt caching.
   * Without a model reference the kernel's routing decides.
   */
  private modelSettings(
    definition: AgentDefinition,
  ): Pick<CompletionRequest, 'model' | 'provider' | 'temperature' | 'maxTokens' | 'reasoning' | 'responseFormat' | 'cache'> {
    const primary = definition.models?.[0];
    const config = definition.config;
    return {
      model: primary?.model ?? '',
      ...(primary?.provider && { provider: primary.provider }),
      ...(config?.temperature !== undefined && { temperature: config.temperature }),
      ...(config?.maxTokens !== undefined && { maxTokens: config.maxTokens }),
      ...(config?.reasoning && { reasoning: config.reasoning }),
      ...(config?.responseFormat && { responseFormat: config.responseFormat }),
      ...(config?.promptCache && { cache: true }),
    };
  }

  /**
   * Tool-calling loop.
   * Sends prompt to LLM with tool definitions. If LLM requests tool calls,
   * executes them, feeds results back, and loops until LLM responds with text.
   */
  private async completeWithToolLoop(
    registered: RegisteredAgent,
    instance: AgentInstance,
    intent: Intent,
    initialMessages: ModelMessage[],
    tools: ToolDefinition[],
    toolNames?: string[],
    maxIterations = 10,
  ): Promise<string> {
    if (!this.pluginRegistry) {
      // No plugin registry — fall back to plain completion
      const response = await this.modelRouter.complete({
        messages: initialMessages,
        ...this.modelSettings(registered.definition),
      });
      instance.metrics.tokensConsumed += response.usage.totalTokens;
      return response.content;
    }

    // Narrow to the requested tools, if any
    let availableTools = tools;
    if (toolNames?.length) {
      availableTools = availableTools.filter(t =>
        toolNames.some(name => t.id.includes(name) || t.name === name)
      );
    }

    // Registered tool IDs already match the function-name pattern providers require
    const toolSpecs: ToolSpec[] = availableTools.map(t => ({
      name: t.id,
      description: t.description,
      parameters: t.parameters,
    }));
    const offered = new Set(toolSpecs.map(t => t.name));

    const messages: ModelMessage[] = [...initialMessages];

    // Tool-calling loop
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.modelRouter.complete({
        messages,
        ...this.modelSettings(registered.definition),
        tools: toolSpecs.length > 0 ? toolSpecs : undefined,
        metadata: {
          intentId: intent.id,
          agentId: instance.id,
          purpose: 'reasoning',
        },
      });

      instance.metrics.tokensConsumed += response.usage.totalTokens;

      // If no tool calls, return the text response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.content;
      }

      // LLM wants to call tools — execute them
      // Add assistant message with tool calls (for conversation history)
      // providerData carries what the provider needs back with this turn (e.g. Claude's signed thinking)
      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
        ...(response.providerData && { providerData: response.providerData }),
      });

      for (const toolCall of response.toolCalls) {
        this.eventBus.publish({
          id: generateId('evt'),
          eventType: 'agent.tool_call',
          category: 'tool',
          severity: 'info',
          timestamp: now(),
          subjectId: instance.id,
          subjectType: 'agent_instance',
          actorId: instance.id,
          correlationId: intent.id,
          data: {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            arguments: toolCall.arguments,
          },
          metadata: {
            schemaVersion: '1.0.0',
            source: registered.definition.name,
            environment: 'development',
          },
        });

        // Execute the tool. Only tools offered to the model may run.
        let toolResult: string;
        try {
          if (!offered.has(toolCall.name)) {
            throw new Error(`Tool "${toolCall.name}" is not available.`);
          }
          const result = await this.pluginRegistry.executeTool(toolCall.name, toolCall.arguments);
          toolResult = typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
          toolResult = `Error: ${(error as Error).message}`;
        }

        // Add tool result to messages
        messages.push({
          role: 'tool',
          content: toolResult,
          toolCallId: toolCall.id,
        });
      }
    }

    // Max iterations reached — return whatever we have
    return '[Max tool iterations reached. The agent called too many tools without producing a final answer.]';
  }
}
