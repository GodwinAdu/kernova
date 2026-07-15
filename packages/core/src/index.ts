/**
 * @kernova/core
 * 
 * The Kernova Intelligent Systems Runtime.
 * 
 * Usage:
 *   import { KernovaKernel } from '@kernova/core';
 *   
 *   const kernel = new KernovaKernel({ environment: 'development' });
 *   await kernel.start();
 *   
 *   const result = await kernel.submit({ goal: 'Summarize this document' });
 *   console.log(result);
 */

export { KernovaKernel, NexusKernel } from './kernel.js';
export type { KernelConfig } from './kernel.js';

export { EventBus } from './events/event-bus.js';
export type { EventBusConfig } from './events/event-bus.js';
export { EventStore } from './events/event-store.js';
export type { EventStoreConfig, EventQuery, EventStoreStats } from './events/event-store.js';
export { MemoryEngine } from './memory/memory-engine.js';
export type { MemoryEngineConfig } from './memory/memory-engine.js';
export { MemoryStore } from './memory/memory-store.js';
export type { MemoryStoreConfig } from './memory/memory-store.js';

export { createMemoryProvider, SqliteMemoryProvider, PostgresMemoryProvider, InMemoryProvider } from './memory/providers/index.js';
export { createConversationStore, PostgresConversationStore, SqliteConversationStore } from './memory/providers/index.js';
export type { MemoryProvider, MemoryProviderConfig, MemorySearchOptions, MemorySearchResult } from './memory/providers/index.js';
export type { MemoryEntry as ProviderMemoryEntry } from './memory/providers/types.js';
export type { ConversationStore, ConversationStoreConfig, Thread as ConversationThread, ChatMessage } from './memory/providers/index.js';

// Memory System v2 — Three-layer architecture with scoring, compaction, and pluggable adapters
export { KernovaMemoryEngine, createMemoryEngine } from './memory/v2/index.js';
export { InProcessWorkingMemory } from './memory/v2/index.js';
export { scoreResults, recencyScore, frequencyScore, normalizeWeights } from './memory/v2/index.js';
export { compact, needsCompaction, formatSummaryForPrompt } from './memory/v2/index.js';
export { PostgresMemoryAdapter, SqliteMemoryAdapter, InMemoryAdapter } from './memory/v2/adapters/index.js';
export { RedisMemoryAdapter, MongoDBMemoryAdapter, QdrantMemoryAdapter, TursoMemoryAdapter, SupabaseMemoryAdapter } from './memory/v2/adapters/index.js';
export { PineconeMemoryAdapter, WeaviateMemoryAdapter, DynamoDBMemoryAdapter, FirestoreMemoryAdapter } from './memory/v2/adapters/index.js';
export type { PostgresAdapterConfig, SqliteAdapterConfig, InMemoryAdapterConfig } from './memory/v2/adapters/index.js';
export type { RedisAdapterConfig, MongoDBAdapterConfig, QdrantAdapterConfig, TursoAdapterConfig, SupabaseAdapterConfig } from './memory/v2/adapters/index.js';
export type { PineconeAdapterConfig, WeaviateAdapterConfig, DynamoDBAdapterConfig, FirestoreAdapterConfig } from './memory/v2/adapters/index.js';
export type {
  MemoryAdapter, MemoryEntry as MemoryEntryV2, MemoryQuery, MemoryResult,
  MemoryLayer, MemoryFilter, MemoryEngineConfig as MemoryEngineConfigV2,
  ScoringConfig, WorkingMemory, MemoryHooks, CompactionConfig, ConversationSummary,
} from './memory/v2/index.js';
export { DEFAULT_SCORING, DEFAULT_COMPACTION } from './memory/v2/index.js';

export { AgentRegistry } from './agents/agent-registry.js';
export type { AgentExecutor, AgentTools } from './agents/agent-registry.js';
export { AgentCoordinator } from './agents/coordinator.js';
export type { DelegationResult, CoordinatorConfig } from './agents/coordinator.js';

// Agent Loop — Goal-oriented iterative execution (Think → Act → Evaluate → Repeat)
export { executeLoop } from './agent-loop/index.js';
export type { LoopExecutorDeps } from './agent-loop/index.js';
export type { LoopConfig, LoopResult, LoopStep, LoopContext, LoopStatus } from './agent-loop/index.js';
export { DEFAULT_LOOP_CONFIG } from './agent-loop/index.js';

export { ContextEngine } from './context/context-engine.js';

export { ModelRouter } from './models/model-router.js';
export type { ModelRouterConfig } from './models/model-router.js';
export type { ModelProvider } from './models/provider.js';
export { OpenAIProvider } from './models/openai-provider.js';
export type { OpenAIConfig } from './models/openai-provider.js';
export { AnthropicProvider } from './models/anthropic-provider.js';
export type { AnthropicConfig } from './models/anthropic-provider.js';
export { GeminiProvider } from './models/gemini-provider.js';
export type { GeminiConfig } from './models/gemini-provider.js';
export { OllamaProvider } from './models/ollama-provider.js';
export type { OllamaConfig } from './models/ollama-provider.js';
export { OpenAICompatibleProvider } from './models/openai-compatible-provider.js';
export type { OpenAICompatibleConfig } from './models/openai-compatible-provider.js';
export {
  createProvider,
  detectAvailableProviders,
  listPresets,
} from './models/presets.js';
export type { ProviderPreset } from './models/presets.js';
export {
  createProviderFromConfig,
  createProvidersFromConfig,
  PROVIDER_CATALOG,
} from './models/adapter-registry.js';

export { defineAgent } from './define-agent.js';
export type { AgentSpec, DefinedAgent } from './define-agent.js';

export { DaemonRunner } from './daemon/index.js';
export type { DaemonConfig } from './daemon/index.js';

export { DevServer } from './dev/dev-server.js';
export type { DevServerConfig } from './dev/dev-server.js';
export { FileWatcher } from './dev/file-watcher.js';
export { AgentLoader } from './dev/agent-loader.js';
export type { AgentLoadResult } from './dev/agent-loader.js';
export { StudioServer } from './studio/studio-server.js';
export type { StudioServerConfig } from './studio/studio-server.js';

export { PluginRegistry } from './plugins/plugin-registry.js';
export type {
  KernovaPlugin,
  NexusPlugin,
  ToolDefinition,
  MiddlewareHook,
  MiddlewareContext,
  PluginContext,
  PluginType,
} from './plugins/plugin-registry.js';

export { WorkflowEngine } from './workflows/workflow-engine.js';
export type { WorkflowEngineConfig, ApprovalHandler } from './workflows/workflow-engine.js';

export { AgentPlanner } from './planning/index.js';
export type { AgentPlannerConfig } from './planning/index.js';
export type { StepExecutor } from './planning/agent-planner.js';

export { SelfReflection, clampConfidence, resolveReflectionConfig } from './reflection/index.js';
export type { SelfReflectionConfig, ReflectionToggleConfig } from './reflection/index.js';

export { ConversationManager } from './conversation/index.js';
export type { ConversationManagerConfig } from './conversation/index.js';

export { RAGPipeline } from './rag/index.js';
export type { RAGPipelineConfig } from './rag/index.js';

export { AgentTestRunner } from './testing/index.js';
export { MockModelProvider } from './testing/index.js';
export { ConversationSimulator } from './testing/index.js';
export type { AgentTestRunnerConfig } from './testing/index.js';

export { ModelFallbackManager } from './fallback/index.js';
export type { ModelFallbackManagerConfig } from './fallback/index.js';

export { SubAgentManager } from './subagents/index.js';
export type { SubAgentManagerOptions } from './subagents/index.js';

export { TeamRegistry, TeamExecutor, MessageBus, SharedWorkspace } from './teams/index.js';
export type {
  TeamConfig,
  TeamMember,
  DelegationStrategy,
  TeamTask,
  AgentMessage,
  TeamExecuteOptions,
  TeamExecutionTrace,
  TeamProgressEvent,
  WorkspaceEntry,
  AgentExecutor as TeamAgentExecutor,
  AgentExecutionContext as TeamAgentContext,
  AgentExecutionResult as TeamAgentResult,
  TeamExecutorOptions,
  MessageBusOptions,
  SharedWorkspaceOptions,
  WorkspaceChangeEvent,
} from './teams/index.js';

export { RemoteAgentClient, AgentProtocolServer, AgentRegistry as KAPRegistry } from './agent-protocol/index.js';
export type {
  RemoteAgentClientOptions,
  AgentServerConfig,
  AgentRegistryConfig as KAPRegistryConfig,
  AgentCard,
  AgentAuthConfig,
  AgentCapability,
  AgentRequest,
  AgentResponse,
  AgentRegistryEntry,
  RemoteAgentConnection,
  RemoteAgentCredentials,
  DiscoveryOptions,
} from './agent-protocol/index.js';

export { TrajectoryRecorder } from './trajectory/index.js';
export type { TrajectoryRecorderConfig } from './trajectory/index.js';

export { WebhookRouter } from './webhooks/index.js';
export type { WebhookRouterConfig } from './webhooks/index.js';

export { ToolAvailabilityEngine, ToolPolicyEngine } from './tool-availability/index.js';

export { ContextEngineManager } from './context/context-engine-manager.js';
export { DefaultContextEngine } from './context/default-context-engine.js';
export type {
  ContextEnginePlugin,
  ContextEngineInfo,
  ContextMessage,
  AssembleResult,
  CompactResult,
  IngestResult,
  BootstrapResult,
  MaintenanceResult,
} from './context/context-engine-plugin.js';

export { MCPBridge } from './mcp/index.js';
export type { MCPBridgeConfig } from './mcp/index.js';

export { RateLimiter } from './rate-limiter/index.js';
export type { RateLimiterConfig, RateLimitRule } from './rate-limiter/index.js';

export { AuthProfileManager } from './auth-profiles/index.js';
export type { AuthProfile, AuthProfileManagerConfig, KeyResult } from './auth-profiles/index.js';

export { SandboxManager } from './sandbox/index.js';
export type { SandboxConfig, SandboxPolicy } from './sandbox/index.js';

export { ConfigManager } from './config-manager/index.js';
export type { ConfigManagerOptions } from './config-manager/index.js';
export {
  parseAgentConfigFile,
  parseAgentConfigString,
  serializeAgentConfigToYaml,
  serializeAgentConfigToJson,
  validateAgentConfig,
  mergeAgentConfigs,
  loadAgentConfigWithExtends,
  discoverAgentConfigFiles,
  isAgentConfigFile,
  watchAgentConfigFiles,
  AgentConfigError,
} from './config-manager/index.js';
export type { AgentConfigLoadResult, AgentConfigLoaderOptions } from './config-manager/index.js';

export { WebhookChannelAdapter } from './channels/adapters/webhook-adapter.js';
export type { WebhookAdapterConfig } from './channels/adapters/webhook-adapter.js';
export { WebSocketChannelAdapter } from './channels/adapters/websocket-adapter.js';
export type { WebSocketAdapterConfig } from './channels/adapters/websocket-adapter.js';

export { BuiltInToolRegistry } from './built-in-tools/index.js';
export type { BuiltInToolConfig } from './built-in-tools/index.js';
export { SandboxViolationError } from './built-in-tools/sandbox-error.js';
export { createWebSearchTool, StubSearchProvider } from './built-in-tools/web-search.js';
export type { WebSearchProvider, SearchResult } from './built-in-tools/web-search.js';

export { TaskQueue } from './task-queue/index.js';
export type { TaskQueueConfig, TaskHandler } from './task-queue/index.js';
export { QueueStore } from './task-queue/index.js';
export type { QueueStoreConfig } from './task-queue/index.js';

export { ProactiveTriggerEngine } from './triggers/index.js';
export type { TriggerEngineConfig } from './triggers/index.js';
export { TriggerStore } from './triggers/trigger-store.js';
export type { TriggerStoreConfig } from './triggers/trigger-store.js';

export { AgentGateway } from './gateway/index.js';
export type { GatewayConfig, GatewayAuthConfig } from './gateway/index.js';

export { HotReloader } from './hot-reload/index.js';
export type { HotReloaderConfig } from './hot-reload/index.js';

export { PluginMarketplace } from './marketplace/index.js';
export type { MarketplaceConfig, PluginListing } from './marketplace/index.js';

export { SecurityAuditor } from './security-audit/index.js';
export type { AuditResult, AuditCheck, AuditSeverity } from './security-audit/index.js';

export { MetricsCollector } from './metrics/index.js';
export type { MetricsSnapshot, MetricEntry, MetricsConfig } from './metrics/index.js';

export { HealthMonitor } from './health/index.js';
export type { HealthStatus, HealthCheck, HealthMonitorConfig } from './health/index.js';

export { IdentityManager } from './identity/identity-manager.js';
export type { RegisteredIdentity, Organization, ActorType, IdentityManagerConfig } from './identity/identity-manager.js';
export { ApiKeyManager } from './identity/api-keys.js';
export type { ApiKey, CreateKeyOptions, ApiKeyValidation } from './identity/api-keys.js';
export { PermissionEngine } from './identity/permission-engine.js';
export type { PermissionCheck, PermissionResult, Role } from './identity/permission-engine.js';
export { SessionManager } from './identity/session-manager.js';
export type { Session, CreateSessionOptions } from './identity/session-manager.js';

export { BudgetManager } from './governance/budget-manager.js';
export type { BudgetConfig, IdentityBudget, UsageRecord, BudgetCheckResult } from './governance/budget-manager.js';

export * from './utils.js';
export { ValidationError, QueueFullError, ConnectorError } from './errors.js';
