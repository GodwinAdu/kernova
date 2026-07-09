/**
 * @kernova/core
 * 
 * The Kernova Intelligent Systems Runtime.
 * 
 * Usage:
 *   import { NexusKernel } from '@kernova/core';
 *   
 *   const kernel = new NexusKernel({ environment: 'development' });
 *   await kernel.start();
 *   
 *   const result = await kernel.submit({ goal: 'Summarize this document' });
 *   console.log(result);
 */

export { NexusKernel } from './kernel.js';
export type { KernelConfig } from './kernel.js';

export { EventBus } from './events/event-bus.js';
export type { EventBusConfig } from './events/event-bus.js';
export { EventStore } from './events/event-store.js';
export type { EventStoreConfig, EventQuery, EventStoreStats } from './events/event-store.js';
export { MemoryEngine } from './memory/memory-engine.js';
export type { MemoryEngineConfig } from './memory/memory-engine.js';
export { MemoryStore } from './memory/memory-store.js';
export type { MemoryStoreConfig } from './memory/memory-store.js';
export { AgentRegistry } from './agents/agent-registry.js';
export type { AgentExecutor, AgentTools } from './agents/agent-registry.js';
export { AgentCoordinator } from './agents/coordinator.js';
export type { DelegationResult, CoordinatorConfig } from './agents/coordinator.js';
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

export { DevServer } from './dev/dev-server.js';
export type { DevServerConfig } from './dev/dev-server.js';
export { FileWatcher } from './dev/file-watcher.js';
export { AgentLoader } from './dev/agent-loader.js';
export type { AgentLoadResult } from './dev/agent-loader.js';
export { StudioServer } from './studio/studio-server.js';
export type { StudioServerConfig } from './studio/studio-server.js';

export { PluginRegistry } from './plugins/plugin-registry.js';
export type {
  NexusPlugin,
  ToolDefinition,
  MiddlewareHook,
  MiddlewareContext,
  PluginContext,
  PluginType,
} from './plugins/plugin-registry.js';

export { WorkflowEngine } from './workflows/workflow-engine.js';
export type { WorkflowEngineConfig, ApprovalHandler } from './workflows/workflow-engine.js';

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
