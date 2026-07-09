/**
 * Nexus Kernel
 * 
 * The heart of the runtime. Like V8 is to Node.js, the Kernel is to Nexus.
 * It receives Intents and orchestrates their fulfillment through agents,
 * tools, and workflows.
 * 
 * Responsibilities:
 * - Intent lifecycle management
 * - Agent orchestration
 * - Event dispatch
 * - Context computation
 * - Memory coordination
 */

import type {
  Intent,
  IntentStatus,
  NexusEvent,
  NexusId,
  ModelRoutingConfig,
} from '@kernova/types';
import { EventBus } from './events/event-bus.js';
import { MemoryEngine } from './memory/memory-engine.js';
import { AgentRegistry } from './agents/agent-registry.js';
import { ContextEngine } from './context/context-engine.js';
import { ModelRouter } from './models/model-router.js';
import type { ModelProvider } from './models/provider.js';
import { detectProvidersFromCatalog } from './models/adapter-registry.js';
import { PluginRegistry } from './plugins/plugin-registry.js';
import { WorkflowEngine } from './workflows/workflow-engine.js';
import { IdentityManager } from './identity/identity-manager.js';
import { BudgetManager } from './governance/budget-manager.js';
import { generateId, now } from './utils.js';

export interface KernelConfig {
  /** Instance identifier */
  instanceId?: string;

  /** Environment */
  environment: 'development' | 'staging' | 'production';

  /** Enable debug logging */
  debug?: boolean;

  /** Model routing configuration */
  models?: ModelRoutingConfig;

  /** Additional model providers */
  providers?: ModelProvider[];

  /** Data directory for persistence (default: ./kernova-data) */
  dataDir?: string;

  /** Disable event persistence (events only in memory) */
  ephemeral?: boolean;
}

/**
 * The Nexus Kernel
 * 
 * Usage:
 *   const kernel = new NexusKernel({ environment: 'development' });
 *   await kernel.start();
 *   const result = await kernel.submit(intent);
 */
export class NexusKernel {
  private readonly config: KernelConfig;
  private readonly instanceId: NexusId;
  private readonly eventBus: EventBus;
  private readonly memory: MemoryEngine;
  private readonly agents: AgentRegistry;
  private readonly context: ContextEngine;
  private readonly modelRouter: ModelRouter;
  private readonly pluginRegistry: PluginRegistry;
  private readonly workflowEngine: WorkflowEngine;
  private readonly identityManager: IdentityManager;
  private readonly budgetManager: BudgetManager;

  private running = false;
  private activeIntents: Map<NexusId, Intent> = new Map();

  constructor(config: KernelConfig) {
    this.config = config;
    this.instanceId = config.instanceId || generateId('kernel');

    // Event bus with optional persistence
    const dataDir = config.dataDir || './kernova-data';
    this.eventBus = new EventBus({
      persistent: config.ephemeral !== true,
      store: {
        path: `${dataDir}/kernova.db`,
      },
    });

    // Initialize model providers (needed before memory for embeddings)
    const providers: ModelProvider[] = [
      ...(config.providers || []),
      ...detectProvidersFromCatalog(),
    ];

    const firstAvailable = providers.find(p => p.isAvailable());
    const defaultProvider = firstAvailable?.id || 'openai';
    const defaultModel = firstAvailable
      ? (firstAvailable.id === 'openai' ? 'gpt-4o'
        : firstAvailable.id === 'anthropic' ? 'claude-sonnet-4-20250514'
        : 'default')
      : 'gpt-4o';

    const routing = config.models || {
      default: {
        provider: defaultProvider,
        model: defaultModel,
      },
    };

    this.modelRouter = new ModelRouter({
      routing,
      providers,
      eventBus: this.eventBus,
    });

    // Memory engine (uses model router for embeddings)
    this.memory = new MemoryEngine(this.eventBus, {
      persistent: config.ephemeral !== true,
      store: {
        path: `${dataDir}/kernova.db`,
      },
      embeddings: config.ephemeral !== true,
      modelRouter: this.modelRouter,
    });
    this.context = new ContextEngine(this.memory);

    // Agent registry now has access to model router
    this.agents = new AgentRegistry(this.eventBus, this.modelRouter);

    // Plugin system
    this.pluginRegistry = new PluginRegistry(this.eventBus);

    // Connect plugins to agents (so agents can use tools)
    this.agents.setPluginRegistry(this.pluginRegistry);

    // Connect memory to agents (so agents can remember/recall)
    this.agents.setMemoryEngine(this.memory);

    // Identity & auth
    this.identityManager = new IdentityManager(this.eventBus, {
      storePath: config.ephemeral ? undefined : `${dataDir}/kernova.db`,
      ephemeral: config.ephemeral,
    });

    // Governance & budget
    this.budgetManager = new BudgetManager(this.eventBus);

    // Workflow engine
    this.workflowEngine = new WorkflowEngine(
      this.eventBus,
      this.agents,
      this.pluginRegistry,
    );
  }

  /** Start the kernel */
  async start(): Promise<void> {
    if (this.running) return;

    await this.eventBus.start();
    await this.memory.start();
    await this.agents.start();

    this.running = true;

    this.emit({
      eventType: 'kernel.started',
      category: 'system',
      severity: 'info',
      data: {
        instanceId: this.instanceId,
        environment: this.config.environment,
      },
    });

    if (this.config.debug) {
      console.log(`[Kernova] Kernel started (${this.instanceId})`);
    }
  }

  /** Stop the kernel gracefully */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.emit({
      eventType: 'kernel.stopping',
      category: 'system',
      severity: 'info',
      data: { activeIntents: this.activeIntents.size },
    });

    // Wait for active intents to complete (with timeout)
    // In production, we'd implement graceful shutdown here

    await this.agents.stop();
    await this.memory.stop();
    await this.eventBus.stop();

    this.running = false;

    if (this.config.debug) {
      console.log(`[Kernova] Kernel stopped`);
    }
  }

  /**
   * Submit an intent for execution
   * This is the primary entry point for the runtime.
   */
  async submit(intent: Partial<Intent> & { goal: string }): Promise<Intent> {
    if (!this.running) {
      throw new Error('Kernel is not running. Call start() first.');
    }

    const owner = intent.owner || 'system';

    // Enforce permissions (if identity system has this user)
    if (owner !== 'system') {
      const permCheck = this.identityManager.checkPermission({
        identityId: owner,
        resource: 'intent',
        action: 'submit',
      });
      if (!permCheck.granted) {
        throw new Error(`Permission denied: ${permCheck.reason}`);
      }
    }

    // Enforce budget (check before processing)
    const budgetCheck = this.budgetManager.check(owner);
    if (!budgetCheck.allowed) {
      throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
    }

    // Create a full intent object from the partial
    const fullIntent: Intent = {
      id: intent.id || generateId('intent'),
      type: 'intent',
      version: '1.0.0',
      owner: intent.owner || 'system',
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      metadata: intent.metadata || {},
      intentType: intent.intentType || 'action',
      goal: intent.goal,
      description: intent.description,
      priority: intent.priority || 'medium',
      intentStatus: 'pending',
      confidence: intent.confidence || 0,
      source: intent.source || {
        actorId: 'system',
        channel: 'user',
      },
      temporal: intent.temporal || {},
      dependencies: intent.dependencies || [],
      childIds: intent.childIds || [],
      constraints: intent.constraints || [],
      approvals: intent.approvals || [],
      risk: intent.risk || {
        level: 'low',
        factors: [],
        reversible: true,
      },
    };

    // Register the intent
    this.activeIntents.set(fullIntent.id, fullIntent);

    // Emit intent created event
    this.emit({
      eventType: 'intent.created',
      category: 'intent',
      severity: 'info',
      data: {
        intentId: fullIntent.id,
        goal: fullIntent.goal,
        type: fullIntent.intentType,
        priority: fullIntent.priority,
      },
    });

    // Execute the intent
    try {
      const result = await this.executeIntent(fullIntent);
      return result;
    } catch (error) {
      return this.failIntent(fullIntent, error as Error);
    }
  }

  /** Execute an intent through the pipeline */
  private async executeIntent(intent: Intent): Promise<Intent> {
    // Phase 1: Planning
    intent = this.updateIntentStatus(intent, 'planning');

    // Compute context for this intent
    const context = await this.context.compute({
      intentId: intent.id,
      ownerId: intent.owner,
      goal: intent.goal,
    });

    // Phase 2: Agent Selection
    const agent = await this.agents.selectAgent(intent, context);

    if (!agent) {
      return this.failIntent(intent, new Error('No suitable agent found for this intent'));
    }

    // Phase 3: Execution
    intent = this.updateIntentStatus(intent, 'executing');

    this.emit({
      eventType: 'intent.executing',
      category: 'intent',
      severity: 'info',
      data: {
        intentId: intent.id,
        agentId: agent.id,
      },
    });

    // Execute through the agent
    const usageBefore = this.modelRouter.getUsageStats().usage.totalTokens;
    const result = await this.agents.execute(agent, intent, context);
    const usageAfter = this.modelRouter.getUsageStats().usage.totalTokens;
    const tokensConsumed = usageAfter - usageBefore;

    // Phase 4: Completion
    intent.result = result;
    intent = this.updateIntentStatus(intent, result.success ? 'completed' : 'failed');

    // Record actual token usage for budget tracking
    if (tokensConsumed > 0) {
      this.budgetManager.record(intent.owner, tokensConsumed);
    }

    // Clean up
    this.activeIntents.delete(intent.id);

    return intent;
  }

  /** Update intent status and emit event */
  private updateIntentStatus(intent: Intent, status: IntentStatus): Intent {
    intent.intentStatus = status;
    intent.updatedAt = now();

    this.emit({
      eventType: `intent.${status}`,
      category: 'intent',
      severity: status === 'failed' ? 'error' : 'info',
      data: { intentId: intent.id, status },
    });

    return intent;
  }

  /** Mark an intent as failed */
  private failIntent(intent: Intent, error: Error): Intent {
    intent.intentStatus = 'failed';
    intent.updatedAt = now();
    intent.result = {
      success: false,
      summary: error.message,
      evidence: {
        sources: [],
        confidence: 0,
        reasoning: `Failed: ${error.message}`,
      },
      durationMs: Date.now() - new Date(intent.createdAt).getTime(),
    };

    this.activeIntents.delete(intent.id);

    this.emit({
      eventType: 'intent.failed',
      category: 'intent',
      severity: 'error',
      data: {
        intentId: intent.id,
        error: error.message,
      },
    });

    return intent;
  }

  /** Emit an event through the event bus */
  private emit(partial: Partial<NexusEvent> & { eventType: string; category: NexusEvent['category']; severity: NexusEvent['severity']; data: Record<string, unknown> }): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType: partial.eventType,
      category: partial.category,
      severity: partial.severity,
      timestamp: now(),
      subjectId: (partial.data?.['intentId'] as string) || this.instanceId,
      subjectType: partial.category,
      actorId: this.instanceId,
      correlationId: (partial.data?.['intentId'] as string) || generateId('cor'),
      data: partial.data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'kernel',
        environment: this.config.environment,
      },
    };

    this.eventBus.publish(event);
  }

  /** Get kernel status */
  getStatus() {
    return {
      running: this.running,
      instanceId: this.instanceId,
      environment: this.config.environment,
      activeIntents: this.activeIntents.size,
      registeredAgents: this.agents.count(),
      availableProviders: this.modelRouter.getAvailableProviders(),
      modelUsage: this.modelRouter.getUsageStats(),
    };
  }

  /** Access the event bus for subscriptions */
  get events(): EventBus {
    return this.eventBus;
  }

  /** Access the memory engine */
  get memoryEngine(): MemoryEngine {
    return this.memory;
  }

  /** Access the agent registry */
  get agentRegistry(): AgentRegistry {
    return this.agents;
  }

  /** Access the model router */
  get models(): ModelRouter {
    return this.modelRouter;
  }

  /** Access the plugin registry */
  get plugins(): PluginRegistry {
    return this.pluginRegistry;
  }

  /** Access the workflow engine */
  get workflows(): WorkflowEngine {
    return this.workflowEngine;
  }

  /** Access the identity manager */
  get identity(): IdentityManager {
    return this.identityManager;
  }

  /** Access the budget manager */
  get budget(): BudgetManager {
    return this.budgetManager;
  }
}
