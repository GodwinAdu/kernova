/**
 * Kernova Kernel
 *
 * The heart of the runtime. Like V8 is to Node.js, the Kernel is to Kernova.
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
  KernovaEvent,
  KernovaId,
  ModelRoutingConfig,
  ToolPolicy,
  ToolPolicyLayer,
} from "@kernova/types";
import { EventBus } from "./events/event-bus.js";
import { MemoryEngine } from "./memory/memory-engine.js";
import { AgentRegistry } from "./agents/agent-registry.js";
import { ContextEngine } from "./context/context-engine.js";
import { ModelRouter } from "./models/model-router.js";
import type { ModelProvider } from "./models/provider.js";
import { detectProvidersFromCatalog } from "./models/adapter-registry.js";
import { PluginRegistry } from "./plugins/plugin-registry.js";
import { WorkflowEngine } from "./workflows/workflow-engine.js";
import { IdentityManager } from "./identity/identity-manager.js";
import { BudgetManager } from "./governance/budget-manager.js";
import { Scheduler, type SchedulerConfig } from "./scheduler/index.js";
import {
  BackgroundLoopModule,
  type BackgroundLoopConfig,
} from "./background-loop/index.js";
import { TaskQueue, type TaskQueueConfig } from "./task-queue/index.js";
import {
  ProactiveTriggerEngine,
  type TriggerEngineConfig,
} from "./triggers/index.js";
import {
  ConnectorRegistry,
  type ConnectorRegistryConfig,
} from "./channels/index.js";
import { AgentPlanner, type AgentPlannerConfig } from "./planning/index.js";
import { SelfReflection } from "./reflection/index.js";
import { ConversationManager } from "./conversation/index.js";
import { RAGPipeline, type RAGPipelineConfig } from "./rag/index.js";
import { ModelFallbackManager } from "./fallback/index.js";
import { SubAgentManager } from "./subagents/index.js";
import { TrajectoryRecorder } from "./trajectory/index.js";
import { WebhookRouter } from "./webhooks/index.js";
import { ToolAvailabilityEngine } from "./tool-availability/index.js";
import { ToolPolicyEngine } from "./tool-availability/index.js";
import { ContextEngineManager } from "./context/context-engine-manager.js";
import { MCPBridge } from "./mcp/index.js";
import { RateLimiter, type RateLimiterConfig } from "./rate-limiter/index.js";
import { AuthProfileManager } from "./auth-profiles/index.js";
import { SandboxManager } from "./sandbox/index.js";
import { ConfigManager } from "./config-manager/index.js";
import { AgentGateway, type GatewayConfig } from "./gateway/index.js";
import { HotReloader } from "./hot-reload/index.js";
import { PluginMarketplace } from "./marketplace/index.js";
import { SecurityAuditor } from "./security-audit/index.js";
import { MetricsCollector } from "./metrics/index.js";
import { HealthMonitor } from "./health/index.js";
import { BuiltInToolRegistry } from "./built-in-tools/index.js";
import type { BuiltInToolConfig } from "./built-in-tools/index.js";
import { generateId, now } from "./utils.js";
import { IN_MEMORY_DATA_DIR } from "./storage/store-path.js";
import { join } from "node:path";

export interface KernelConfig {
  /** Instance identifier */
  instanceId?: string;

  /** Environment */
  environment: "development" | "staging" | "production";

  /** Enable debug logging */
  debug?: boolean;

  /** Model routing configuration */
  models?: ModelRoutingConfig;

  /** Additional model providers */
  providers?: ModelProvider[];

  /** Data directory for persistence (default: ./kernova-data) */
  dataDir?: string;

  /** Keep everything in memory: nothing is written to disk */
  ephemeral?: boolean;

  /**
   * Configuration for built-in tools. Tools that run code or touch files or a database
   * (shell-exec, code-eval, file-read, file-write, database-query) are off unless listed in `enabled`.
   * File tools are confined to `sandboxDir` (default: <dataDir>/workspace).
   */
  builtInTools?: BuiltInToolConfig;

  /**
   * Kernel-wide tool policy: allow/deny lists matched against tool IDs such as "shell-exec"
   * (`*` globs supported). Agents can narrow it further with `toolPolicy` in defineAgent().
   */
  toolPolicy?: ToolPolicy;

  /** Settings for the HTTP gateway (kernel.gateway). It requires a token unless anonymous access is enabled. */
  gateway?: GatewayConfig;

  /** Per-identity rate limits. The kernel's own "system" owner is only limited by an explicit rule. */
  rateLimits?: RateLimiterConfig;

  /** Delete persisted events older than this many days, at start and then daily (default: 30; 0 keeps them forever) */
  eventRetentionDays?: number;

  /** How long stop() waits for active intents to finish before shutting down anyway (default: 10000 ms) */
  shutdownTimeoutMs?: number;

  /** Global reflection configuration (an extra model call grades each answer; off by default) */
  reflection?: {
    /** Whether reflection is enabled globally (default: false) */
    enabled: boolean;
    /** Confidence score threshold (default: 0.7) */
    threshold?: number;
    /** Maximum regeneration attempts (default: 2) */
    maxAttempts?: number;
  };

  /**
   * Give agents the earlier turns of an intent's thread (metadata.threadId) and record each
   * exchange in it (default: true). Turn off when your app keeps its own conversation history.
   */
  threadHistory?: boolean;

  /** Planner settings for kernel.planner (maxSteps, strategy, adaptiveReplanning, maxReplanAttempts) */
  planning?: Partial<AgentPlannerConfig>;

  /** RAG settings for kernel.rag (chunkSize, chunkOverlap, topK, scoreThreshold, chunkStrategy) */
  rag?: Partial<RAGPipelineConfig>;

  /** Identity settings for kernel.identity */
  identity?: {
    /** How long sessions last, in seconds (default: 86400 = 24 hours) */
    sessionTtlSeconds?: number;
  };
}

/**
 * The Kernova Kernel
 *
 * Usage:
 *   const kernel = new KernovaKernel({ environment: 'development' });
 *   await kernel.start();
 *   const result = await kernel.submit(intent);
 */
export class KernovaKernel {
  private readonly config: KernelConfig;
  private readonly instanceId: KernovaId;
  private readonly eventBus: EventBus;
  private readonly memory: MemoryEngine;
  private readonly agents: AgentRegistry;
  private readonly context: ContextEngine;
  private readonly modelRouter: ModelRouter;
  private readonly pluginRegistry: PluginRegistry;
  private readonly workflowEngine: WorkflowEngine;
  private readonly identityManager: IdentityManager;
  private readonly budgetManager: BudgetManager;

  // Autonomy modules
  private readonly _scheduler: Scheduler;
  private readonly _loops: BackgroundLoopModule;
  private readonly _taskQueue: TaskQueue;
  private readonly _triggers: ProactiveTriggerEngine;
  private readonly _channels: ConnectorRegistry;

  // Intelligence modules
  private readonly _planner: AgentPlanner;
  private readonly _reflection: SelfReflection;
  private readonly _conversation: ConversationManager;
  private readonly _rag: RAGPipeline;

  // Advanced modules
  private readonly _fallback: ModelFallbackManager;
  private readonly _subagents: SubAgentManager;
  private readonly _trajectory: TrajectoryRecorder;
  private readonly _webhooks: WebhookRouter;
  private readonly _toolAvailability: ToolAvailabilityEngine;
  private readonly _toolPolicy: ToolPolicyEngine;
  private readonly _contextEngines: ContextEngineManager;
  private readonly _mcp: MCPBridge;
  private readonly _rateLimiter: RateLimiter;
  private readonly _authProfiles: AuthProfileManager;
  private readonly _sandbox: SandboxManager;
  private readonly _configManager: ConfigManager;
  private readonly _gateway: AgentGateway;
  private readonly _marketplace: PluginMarketplace;
  private readonly _securityAuditor: SecurityAuditor;
  private readonly _metrics: MetricsCollector;
  private readonly _health: HealthMonitor;
  private readonly _builtInTools: BuiltInToolRegistry;

  private running = false;
  private stopping = false;
  private retentionTimer?: ReturnType<typeof setInterval>;
  private activeIntents: Map<KernovaId, Intent> = new Map();

  constructor(config: KernelConfig) {
    this.config = config;
    this.instanceId = config.instanceId || generateId("kernel");

    // Event bus with optional persistence
    const dataDir = config.dataDir || "./kernova-data";
    this.eventBus = new EventBus({
      persistent: config.ephemeral !== true,
      store: {
        path: `${dataDir}/kernova.db`,
      },
    });

    // Initialize model providers (needed before memory for embeddings)
    // Providers you pass in take precedence over auto-detected ones with the same ID
    const explicitIds = new Set((config.providers || []).map((p) => p.id));
    const providers: ModelProvider[] = [
      ...(config.providers || []),
      ...detectProvidersFromCatalog().filter((p) => !explicitIds.has(p.id)),
    ];

    const firstAvailable = providers.find((p) => p.isAvailable());

    const routing = config.models || {
      default: {
        provider: firstAvailable?.id || "openai",
        // An empty model means the provider's own default
        model: firstAvailable?.defaultModel ?? "",
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
    this.agents.setDebug(config.debug ?? false);

    // Identity & auth
    this.identityManager = new IdentityManager(this.eventBus, {
      storePath: config.ephemeral ? undefined : `${dataDir}/kernova.db`,
      ephemeral: config.ephemeral,
      sessionTtlSeconds: config.identity?.sessionTtlSeconds,
    });

    // Governance & budget
    this.budgetManager = new BudgetManager(this.eventBus);

    // Workflow engine
    this.workflowEngine = new WorkflowEngine(
      this.eventBus,
      this.agents,
      this.pluginRegistry,
    );

    // Autonomy modules (ephemeral kernels keep their stores in memory)
    const autonomyDataDir = config.ephemeral ? IN_MEMORY_DATA_DIR : dataDir;
    this._scheduler = new Scheduler(this.eventBus, {
      dataDir: autonomyDataDir,
    });
    this._loops = new BackgroundLoopModule(this.eventBus, {
      dataDir: autonomyDataDir,
    });
    this._taskQueue = new TaskQueue(this.eventBus, {
      dataDir: autonomyDataDir,
    });
    this._triggers = new ProactiveTriggerEngine(this.eventBus, {
      dataDir: autonomyDataDir,
    });
    this._channels = new ConnectorRegistry(this.eventBus, {
      dataDir: autonomyDataDir,
    });

    // Intelligence modules
    this._planner = new AgentPlanner(this.eventBus, this.modelRouter, config.planning);
    this._reflection = new SelfReflection(this.eventBus, this.modelRouter, {
      enabled: config.reflection?.enabled ?? false,
      threshold: config.reflection?.threshold,
      maxAttempts: config.reflection?.maxAttempts,
    });
    this._conversation = new ConversationManager(
      this.eventBus,
      this.modelRouter,
    );
    this._rag = new RAGPipeline(this.eventBus, this.modelRouter, config.rag);

    // Advanced modules
    this._fallback = new ModelFallbackManager(this.eventBus, this.modelRouter);
    this._subagents = new SubAgentManager(this.eventBus);
    this._subagents.setExecutor(async (def) => {
      const intent = await this.submit({
        goal: def.goal,
        intentType: "action",
        priority: "medium",
        metadata: { subAgentId: def.id, parentId: def.parentId },
      });
      return intent.result;
    });
    this._trajectory = new TrajectoryRecorder(this.eventBus, {
      enabled: config.debug,
    });
    this._webhooks = new WebhookRouter(this.eventBus, {
      onIntent: async (goal, priority, metadata) => {
        await this.submit({ goal, priority, metadata });
      },
    });
    this._toolAvailability = new ToolAvailabilityEngine();
    this._toolPolicy = new ToolPolicyEngine();
    this._contextEngines = new ContextEngineManager(
      this.eventBus,
      this.modelRouter,
      this.memory,
    );
    this._mcp = new MCPBridge(this.eventBus);
    // Tools from connected MCP servers become plugin tools, so agents can call them
    this.eventBus.subscribe(["mcp.connected", "mcp.disconnected"], (event) =>
      this.syncMcpTools(event),
    );
    this._rateLimiter = new RateLimiter(this.eventBus, config.rateLimits);
    this._authProfiles = new AuthProfileManager(this.eventBus);
    this._sandbox = new SandboxManager(this.eventBus, {
      workspaceDir: dataDir,
    });
    this._configManager = new ConfigManager(this.eventBus, {
      defaults: { environment: config.environment, dataDir },
    });
    this._gateway = new AgentGateway(this, this.eventBus, config.gateway);
    this._marketplace = new PluginMarketplace(this.eventBus);
    this._securityAuditor = new SecurityAuditor(this.eventBus);
    this._metrics = new MetricsCollector(this.eventBus);
    this._health = new HealthMonitor(this.eventBus);

    // Built-in tools registry
    // The sandbox is a subfolder, so file tools can't reach the kernel's own database
    this._builtInTools = new BuiltInToolRegistry({
      ...config.builtInTools,
      sandboxDir: config.builtInTools?.sandboxDir || join(dataDir, "workspace"),
      modelRouter: this.modelRouter,
    });

    // Register built-in health checks
    this._health.addCheck({
      id: "kernel",
      name: "Kernel Running",
      check: () => ({ state: this.running ? "healthy" : "unhealthy" }),
    });
    this._health.addCheck({
      id: "providers",
      name: "Model Providers",
      check: () => {
        const available = this.modelRouter.getAvailableProviders();
        return {
          state: available.length > 0 ? "healthy" : "unhealthy",
          message: `${available.length} providers available`,
        };
      },
    });
  }

  /** Start the kernel */
  async start(): Promise<void> {
    if (this.running) return;

    await this.eventBus.start();
    await this.memory.start();
    await this.agents.start();

    // Start autonomy modules in order
    const autonomyModules = [
      { name: "scheduler", module: this._scheduler },
      { name: "loops", module: this._loops },
      { name: "taskQueue", module: this._taskQueue },
      { name: "triggers", module: this._triggers },
      { name: "channels", module: this._channels },
    ];

    const startedModules: Array<{
      name: string;
      module: { stop(): Promise<void> };
    }> = [];
    for (const { name, module } of autonomyModules) {
      try {
        await module.start();
        startedModules.push({ name, module });
      } catch (error) {
        // Stop previously started modules in reverse
        for (const started of [...startedModules].reverse()) {
          try {
            await started.module.stop();
          } catch {}
        }
        throw new Error(
          `Autonomy module '${name}' failed to start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.running = true;

    // Register built-in tools as an internal plugin
    const builtInTools = this._builtInTools.getTools();
    if (builtInTools.length > 0) {
      await this.pluginRegistry.register({
        id: "@kernova/built-in-tools",
        name: "Kernova Built-in Tools",
        version: "0.1.0",
        type: "tool",
        tools: builtInTools,
      });
    }

    // Start trajectory recording if debug enabled
    this._trajectory.start();

    // Start metrics collection
    this._metrics.start();

    // Prune old events now and then daily, so the event log doesn't grow forever
    const retentionDays = this.config.eventRetentionDays ?? 30;
    if (retentionDays > 0 && !this.config.ephemeral) {
      const prune = () => {
        try {
          this.eventBus.applyRetention(retentionDays);
        } catch {
          // A failed prune shouldn't stop the kernel; it will retry tomorrow
        }
      };
      prune();
      this.retentionTimer = setInterval(prune, 24 * 60 * 60 * 1000);
      this.retentionTimer.unref();
    }

    this.emit({
      eventType: "kernel.started",
      category: "system",
      severity: "info",
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
      eventType: "kernel.stopping",
      category: "system",
      severity: "info",
      data: { activeIntents: this.activeIntents.size },
    });

    // Refuse new intents, then give active ones time to finish
    this.stopping = true;
    const deadline = Date.now() + (this.config.shutdownTimeoutMs ?? 10_000);
    while (this.activeIntents.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Stop autonomy modules in reverse order
    const autonomyModulesToStop = [
      { name: "channels", module: this._channels },
      { name: "triggers", module: this._triggers },
      { name: "taskQueue", module: this._taskQueue },
      { name: "loops", module: this._loops },
      { name: "scheduler", module: this._scheduler },
    ];

    for (const { name, module } of autonomyModulesToStop) {
      try {
        await module.stop();
      } catch (error) {
        // Continue stopping others, emit event
        this.emit({
          eventType: "kernel.module.stopFailed",
          category: "system",
          severity: "error",
          data: {
            module: name,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    await this.agents.stop();
    this._trajectory.stop();
    this._metrics.stop();
    this._health.stopPolling();
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
    await this._gateway.stop();
    await this._mcp.dispose();
    await this._contextEngines.dispose();
    this._conversation.close();
    this.identityManager.close();
    await this.memory.stop();
    await this.eventBus.stop();

    this.running = false;
    this.stopping = false;

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
      throw new Error("Kernel is not running. Call start() first.");
    }
    if (this.stopping) {
      throw new Error("Kernel is stopping. No new intents are accepted.");
    }

    const owner = intent.owner || "system";

    // Enforce permissions for owners registered with the identity system.
    // Other owners are plain labels (e.g. your app's user IDs) used to scope memory and budgets.
    if (owner !== "system" && this.identityManager.getIdentity(owner)) {
      const permCheck = this.identityManager.checkPermission({
        identityId: owner,
        resource: "intent",
        action: "submit",
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

    // Enforce rate limits. "system" is the kernel itself (sub-agents, schedules, triggers)
    // and every caller that doesn't pass an owner, so only an explicit rule limits it.
    const rateLimited =
      owner !== "system" || this._rateLimiter.hasRule("identity", owner);
    if (rateLimited && !this._rateLimiter.consume("identity", owner)) {
      throw new Error("Rate limit exceeded. Try again later.");
    }

    // Create a full intent object from the partial
    const fullIntent: Intent = {
      id: intent.id || generateId("intent"),
      type: "intent",
      version: "1.0.0",
      owner: intent.owner || "system",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      metadata: intent.metadata || {},
      intentType: intent.intentType || "action",
      goal: intent.goal,
      description: intent.description,
      priority: intent.priority || "medium",
      intentStatus: "pending",
      confidence: intent.confidence || 0,
      source: intent.source || {
        actorId: "system",
        channel: "user",
      },
      temporal: intent.temporal || {},
      dependencies: intent.dependencies || [],
      childIds: intent.childIds || [],
      constraints: intent.constraints || [],
      approvals: intent.approvals || [],
      risk: intent.risk || {
        level: "low",
        factors: [],
        reversible: true,
      },
    };

    // Register the intent
    this.activeIntents.set(fullIntent.id, fullIntent);

    // Emit intent created event
    this.emit({
      eventType: "intent.created",
      category: "intent",
      severity: "info",
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
    // Begin trajectory trace for this intent
    const trace = this._trajectory.enabled
      ? this._trajectory.beginTrace({ goal: intent.goal, intentId: intent.id })
      : null;

    // Phase 1: Planning
    intent = this.updateIntentStatus(intent, "planning");

    // Compute context for this intent (base layer from memory)
    const context = await this.context.compute({
      intentId: intent.id,
      ownerId: intent.owner,
      goal: intent.goal,
    });

    // Enrich context with RAG retrieval if documents are ingested
    const ragStats = this._rag.stats();
    if (ragStats.documents > 0) {
      const ragContext = await this._rag.getContext(intent.goal, { topK: 3 });
      if (ragContext) {
        context.documents = ragContext;
        context.estimatedTokens += Math.ceil(ragContext.length / 4);
      }
    }

    // Conversation history, when the intent belongs to a thread (metadata.threadId)
    const threadId =
      this.config.threadHistory !== false &&
      typeof intent.metadata?.threadId === "string"
        ? intent.metadata.threadId
        : undefined;
    if (threadId) {
      const thread = this._conversation.getThreadContext(threadId);
      context.conversation = [
        ...(thread.summary
          ? [{ role: "system" as const, content: `Summary of the earlier conversation:\n${thread.summary}` }]
          : []),
        ...thread.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
    }

    // Phase 2: Agent Selection
    let agent: any = null;

    // If a specific agent is targeted (via metadata.targetAgent), find it directly
    const targetAgentId = intent.metadata?.targetAgent as string | undefined;
    if (targetAgentId) {
      // Search registered agents by their definition ID
      for (const [regId, registered] of (this.agents as any).agents) {
        if (
          regId === targetAgentId ||
          (registered.definition as any)?.id === targetAgentId
        ) {
          // Use selectAgentByName which creates an instance
          agent = await this.agents.selectAgentByName(
            (registered.definition as any).name,
            intent,
            context,
          );
          break;
        }
      }
    }

    // Fallback to capability-based selection if no target or target not found
    if (!agent) {
      agent = await this.agents.selectAgent(intent, context);
    }

    if (!agent) {
      if (trace)
        this._trajectory.endTrace(trace.id, { error: "No agent found" });
      return this.failIntent(
        intent,
        new Error("No suitable agent found for this intent"),
      );
    }

    if (trace) {
      this._trajectory.record(trace.id, "agent.selected", {
        agentId: agent.id,
        agentDefinitionId: agent.definitionId,
      });
    }

    // Phase 2.5: Apply tool policies (kernel-wide, then the agent's own)
    const agentDef = this.agents
      .list()
      .find((a) => a.id === agent.definitionId);
    const policyLayers: ToolPolicyLayer[] = [];
    if (this.config.toolPolicy) {
      policyLayers.push({ name: "kernel", policy: this.config.toolPolicy });
    }
    const agentPolicy = agentDef?.metadata?.toolPolicy as ToolPolicy | undefined;
    if (agentPolicy) {
      policyLayers.push({ name: `agent:${agentDef!.name}`, policy: agentPolicy });
    }
    const allToolIds = this.pluginRegistry.listTools().map((t) => t.id);
    const allowedTools =
      policyLayers.length > 0
        ? allToolIds.filter((id) =>
            this._toolPolicy.isToolAllowed(
              this.pluginRegistry.getToolAliases(id),
              policyLayers,
            ),
          )
        : undefined;

    // Phase 3: Execution
    intent = this.updateIntentStatus(intent, "executing");

    this.emit({
      eventType: "intent.executing",
      category: "intent",
      severity: "info",
      data: {
        intentId: intent.id,
        agentId: agent.id,
      },
    });

    if (trace) {
      this._trajectory.record(trace.id, "agent.executing", {
        agentId: agent.id,
        toolCount: allowedTools?.length ?? allToolIds.length,
      });
    }

    // Execute through the agent. Usage is measured per intent (including reflection),
    // so concurrent intents aren't charged for each other's tokens.
    const { result: finalResult, usage } = await this.modelRouter.measureUsage(async () => {
      let result = await this.agents.execute(agent, intent, context, { allowedTools });

      // Phase 3.5: Self-Reflection (per-agent setting overrides the global one)
      const agentReflection = agentDef?.metadata?.reflection as
        | { enabled?: boolean; threshold?: number; maxAttempts?: number }
        | undefined;
      const shouldReflect = agentReflection?.enabled ?? this._reflection.enabled;

      if (result.success && result.summary && shouldReflect) {
        try {
          const reflectionInstance = agentReflection
            ? this._reflection.withAgentConfig({
                enabled: agentReflection.enabled ?? true,
                threshold: agentReflection.threshold,
                maxAttempts: agentReflection.maxAttempts,
              })
            : this._reflection;

          const reflectionResult = await reflectionInstance.reflect(
            result.summary,
            intent.goal,
            undefined,
            agent.definitionId,
          );

          // If reflection produced a revised output, update the result
          if (reflectionResult.revisedOutput) {
            result = {
              ...result,
              summary: reflectionResult.revisedOutput,
              data: reflectionResult.revisedOutput,
            };
          }
        } catch {
          // Reflection failed (model unavailable, etc.) — keep original output
          // This is non-critical; the agent's response is already valid
        }
      }

      return result;
    });
    const result = finalResult;
    const tokensConsumed = usage.totalTokens;

    // Phase 4: Completion
    intent.result = result;
    intent = this.updateIntentStatus(
      intent,
      result.success ? "completed" : "failed",
    );

    // Record actual token usage for budget tracking
    if (tokensConsumed > 0) {
      this.budgetManager.record(intent.owner, tokensConsumed);
    }

    // End trajectory trace
    if (trace) {
      this._trajectory.record(
        trace.id,
        result.success ? "intent.completed" : "intent.failed",
        {
          intentId: intent.id,
          tokensConsumed,
          durationMs: result.durationMs,
        },
      );
      this._trajectory.endTrace(trace.id, {
        totalTokens: tokensConsumed,
        durationMs: result.durationMs,
      });
    }

    // Record the exchange in the intent's conversation thread (successful turns only)
    if (threadId && result.success) {
      await this._conversation.addMessageToThread(threadId, "user", intent.goal);
      if (result.summary) {
        await this._conversation.addMessageToThread(threadId, "assistant", result.summary);
      }
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
      category: "intent",
      severity: status === "failed" ? "error" : "info",
      data: { intentId: intent.id, status },
    });

    return intent;
  }

  /** Mark an intent as failed */
  private failIntent(intent: Intent, error: Error): Intent {
    intent.intentStatus = "failed";
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
      eventType: "intent.failed",
      category: "intent",
      severity: "error",
      data: {
        intentId: intent.id,
        error: error.message,
      },
    });

    return intent;
  }

  /** Emit an event through the event bus */
  private emit(
    partial: Partial<KernovaEvent> & {
      eventType: string;
      category: KernovaEvent["category"];
      severity: KernovaEvent["severity"];
      data: Record<string, unknown>;
    },
  ): void {
    const event: KernovaEvent = {
      id: generateId("evt"),
      eventType: partial.eventType,
      category: partial.category,
      severity: partial.severity,
      timestamp: now(),
      subjectId: (partial.data?.["intentId"] as string) || this.instanceId,
      subjectType: partial.category,
      actorId: this.instanceId,
      correlationId:
        (partial.data?.["intentId"] as string) || generateId("cor"),
      data: partial.data,
      metadata: {
        schemaVersion: "1.0.0",
        source: "kernel",
        environment: this.config.environment,
      },
    };

    this.eventBus.publish(event);
  }

  /** Mirror a connected MCP server's tools into the plugin registry (and remove them on disconnect) */
  private async syncMcpTools(event: KernovaEvent): Promise<void> {
    const serverId = event.subjectId;
    const pluginId = `mcp:${serverId}`;
    await this.pluginRegistry.unregister(pluginId);
    if (event.eventType !== "mcp.connected") return;

    const server = this._mcp.getServer(serverId);
    const tools = this._mcp.getServerTools(serverId);
    if (!server || tools.length === 0) return;

    const prefix = server.toolPrefix ?? "";
    await this.pluginRegistry.register({
      id: pluginId,
      name: `MCP: ${server.name}`,
      version: "1.0.0",
      type: "tool",
      tools: tools.map((tool) => ({
        id: `${prefix}${tool.name}`,
        name: `${prefix}${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (params: Record<string, unknown>) => {
          const result = await this._mcp.callTool(serverId, tool.name, params);
          const text = result.content
            .map((c) => c.text ?? (c.data ? `[${c.mimeType ?? "binary"} data]` : ""))
            .filter(Boolean)
            .join("\n");
          if (result.isError) throw new Error(text || "MCP tool call failed");
          return text;
        },
      })),
    });
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

  /** Access the scheduler */
  get scheduler(): Scheduler {
    return this._scheduler;
  }

  /** Access the background loop module */
  get loops(): BackgroundLoopModule {
    return this._loops;
  }

  /** Access the task queue */
  get taskQueue(): TaskQueue {
    return this._taskQueue;
  }

  /** Access the proactive trigger engine */
  get triggers(): ProactiveTriggerEngine {
    return this._triggers;
  }

  /** Access the connector registry (channels) */
  get channels(): ConnectorRegistry {
    return this._channels;
  }

  /** Access the agent planner (Plan-and-Execute pattern) */
  get planner(): AgentPlanner {
    return this._planner;
  }

  /** Access the self-reflection module */
  get reflection(): SelfReflection {
    return this._reflection;
  }

  /** Access the conversation history manager */
  get conversation(): ConversationManager {
    return this._conversation;
  }

  /** Access the RAG pipeline */
  get rag(): RAGPipeline {
    return this._rag;
  }

  /** Access the model fallback manager */
  get fallback(): ModelFallbackManager {
    return this._fallback;
  }

  /** Access the sub-agent manager */
  get subagents(): SubAgentManager {
    return this._subagents;
  }

  /** Access the trajectory recorder */
  get trajectory(): TrajectoryRecorder {
    return this._trajectory;
  }

  /** Access the webhook router */
  get webhooks(): WebhookRouter {
    return this._webhooks;
  }

  /** Access the tool availability engine */
  get toolAvailability(): ToolAvailabilityEngine {
    return this._toolAvailability;
  }

  /** Access the tool policy engine */
  get toolPolicy(): ToolPolicyEngine {
    return this._toolPolicy;
  }

  /** Access the pluggable context engine manager */
  get contextEngines(): ContextEngineManager {
    return this._contextEngines;
  }

  /** Access the MCP bridge (Model Context Protocol client) */
  get mcp(): MCPBridge {
    return this._mcp;
  }

  /** Access the rate limiter */
  get rateLimiter(): RateLimiter {
    return this._rateLimiter;
  }

  /** Access the auth profile manager */
  get authProfiles(): AuthProfileManager {
    return this._authProfiles;
  }

  /** Access the sandbox manager */
  get sandbox(): SandboxManager {
    return this._sandbox;
  }

  /** Access the config manager */
  get configManager(): ConfigManager {
    return this._configManager;
  }

  /** Access the API gateway */
  get gateway(): AgentGateway {
    return this._gateway;
  }

  /** Access the plugin marketplace */
  get marketplace(): PluginMarketplace {
    return this._marketplace;
  }

  /** Access the security auditor */
  get securityAuditor(): SecurityAuditor {
    return this._securityAuditor;
  }

  /** Access the metrics collector */
  get metrics(): MetricsCollector {
    return this._metrics;
  }

  /** Access the health monitor */
  get health(): HealthMonitor {
    return this._health;
  }

  /** Access the built-in tool registry */
  get builtInTools(): BuiltInToolRegistry {
    return this._builtInTools;
  }
}

/** @deprecated Use KernovaKernel instead. Will be removed in the next major version. */
export const NexusKernel = KernovaKernel;
/** @deprecated Use KernovaKernel instead. Will be removed in the next major version. */
export type NexusKernel = KernovaKernel;
