/**
 * @kernova/sdk
 * 
 * High-level SDK for building intelligent applications with Kernova.
 * 
 * This package provides a simplified, opinionated API on top of @kernova/core.
 * It's what most developers will use day-to-day.
 * 
 * Quick start:
 *   import { Kernova } from '@kernova/sdk';
 *   
 *   const app = await Kernova.create();
 *   app.agent('assistant', { instructions: 'You are helpful.' });
 *   app.tool('search', { ... });
 *   const answer = await app.ask('What is the weather in London?');
 */

export { Kernova, ThreadHandle } from './kernova.js';
export type { KernovaConfig, AskOptions, AskResult, EnqueueOptions } from './kernova.js';

// Re-export DaemonConfig for use with app.serve()
export type { DaemonConfig } from '@kernova/core';

// Re-export BuiltInToolConfig for use with builtInTools configuration
export type { BuiltInToolConfig } from '@kernova/core';

/** @deprecated Use Kernova instead. Will be removed in v1.0. */
export { Nexus } from './kernova.js';
/** @deprecated Use KernovaConfig instead. Will be removed in v1.0. */
export type { NexusConfig } from './kernova.js';

export { agent } from './helpers/agent.js';
export { tool } from './helpers/tool.js';
export { workflow } from './helpers/workflow.js';

// ─── Memory v2 (Three-layer architecture with 12 adapters) ───────────────────
export {
  createMemoryEngine,
  KernovaMemoryEngine,
  InProcessWorkingMemory,
  scoreResults,
  recencyScore,
  frequencyScore,
  normalizeWeights,
  compact,
  needsCompaction,
  formatSummaryForPrompt,
  // Adapters
  PostgresMemoryAdapter,
  SqliteMemoryAdapter,
  InMemoryAdapter,
  RedisMemoryAdapter,
  MongoDBMemoryAdapter,
  QdrantMemoryAdapter,
  TursoMemoryAdapter,
  SupabaseMemoryAdapter,
  PineconeMemoryAdapter,
  WeaviateMemoryAdapter,
  DynamoDBMemoryAdapter,
  FirestoreMemoryAdapter,
  // Constants
  DEFAULT_SCORING,
  DEFAULT_COMPACTION,
} from '@kernova/core';

export type {
  MemoryAdapter,
  MemoryEntryV2,
  MemoryQuery,
  MemoryResult,
  MemoryLayer,
  MemoryFilter,
  MemoryEngineConfigV2,
  ScoringConfig,
  WorkingMemory,
  MemoryHooks,
  CompactionConfig,
  ConversationSummary,
  PostgresAdapterConfig,
  SqliteAdapterConfig,
  InMemoryAdapterConfig,
  RedisAdapterConfig,
  MongoDBAdapterConfig,
  QdrantAdapterConfig,
  TursoAdapterConfig,
  SupabaseAdapterConfig,
  PineconeAdapterConfig,
  WeaviateAdapterConfig,
  DynamoDBAdapterConfig,
  FirestoreAdapterConfig,
} from '@kernova/core';

// ─── Agent Loop (Goal-oriented iterative execution) ──────────────────────────
export { executeLoop, DEFAULT_LOOP_CONFIG } from '@kernova/core';
export type { LoopExecutorDeps, LoopConfig, LoopResult, LoopStep, LoopContext, LoopStatus } from '@kernova/core';

// Re-export commonly used types
export type {
  Intent,
  IntentResult,
  MemoryEntry,
  AgentDefinition,
  KernovaEvent,
  TriggerActionDef,
} from '@kernova/types';

/** @deprecated Use KernovaEvent instead. Will be removed in v1.0. */
export type { NexusEvent } from '@kernova/types';
