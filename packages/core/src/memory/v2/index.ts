/**
 * Kernova Memory System v2
 *
 * Three-layer architecture for intelligent agent memory:
 *   - Working Memory: In-process, TTL-based, ephemeral (no DB needed)
 *   - Session Memory: Per-conversation, persisted, auto-compacted
 *   - Long-term Memory: Forever, vector-indexed, scored retrieval
 *
 * Usage:
 *   import { createMemoryEngine, type MemoryAdapter } from '@kernova/core/memory';
 *
 *   // Use built-in PostgreSQL adapter
 *   const engine = await createMemoryEngine({
 *     adapter: new PostgresMemoryAdapter({ url: process.env.DATABASE_URL }),
 *     embed: async (text) => generateEmbedding(text),
 *   });
 *
 *   // Store
 *   await engine.store("User's name is Godwin", {
 *     tags: ['identity', 'name'],
 *     namespace: 'user-profile',
 *   });
 *
 *   // Recall (vector + text search, scored by relevance × recency × frequency)
 *   const results = await engine.recall("what is the user's name?");
 *
 *   // Working memory (ephemeral, no DB)
 *   engine.working.set('current_task', { step: 2, data: {...} }, 300); // 5 min TTL
 *   const task = engine.working.get('current_task');
 *
 *   // Custom hooks
 *   const engine = await createMemoryEngine({
 *     adapter: myAdapter,
 *     hooks: {
 *       onBeforeStore: async (entry) => {
 *         // Filter sensitive data
 *         if (entry.content.includes('password')) return null;
 *         return entry;
 *       },
 *       onAfterRecall: async (results) => {
 *         // Custom reranking
 *         return results.sort((a, b) => customScore(b) - customScore(a));
 *       },
 *     },
 *   });
 */

// Core engine
export { KernovaMemoryEngine, createMemoryEngine } from './engine.js';

// Working memory
export { InProcessWorkingMemory } from './working-memory.js';
export type { WorkingMemoryOptions } from './working-memory.js';

// Scoring
export { scoreResults, recencyScore, frequencyScore, normalizeWeights } from './scoring.js';

// Compaction
export { compact, needsCompaction, formatSummaryForPrompt } from './compaction.js';
export type { CompactionContext } from './compaction.js';

// Adapters
export { PostgresMemoryAdapter, SqliteMemoryAdapter, InMemoryAdapter } from './adapters/index.js';
export type { PostgresAdapterConfig, SqliteAdapterConfig, InMemoryAdapterConfig } from './adapters/index.js';
export { RedisMemoryAdapter, MongoDBMemoryAdapter, QdrantMemoryAdapter, TursoMemoryAdapter, SupabaseMemoryAdapter } from './adapters/index.js';
export type { RedisAdapterConfig, MongoDBAdapterConfig, QdrantAdapterConfig, TursoAdapterConfig, SupabaseAdapterConfig } from './adapters/index.js';

// Types (everything developers need to implement custom adapters)
export type {
  MemoryAdapter,
  MemoryEntry,
  MemoryQuery,
  MemoryResult,
  MemoryLayer,
  MemoryFilter,
  MemoryEngineConfig,
  ScoringConfig,
  WorkingMemory,
  WorkingMemoryEntry,
  MemoryHooks,
  CompactionConfig,
  ConversationSummary,
} from './types.js';

export { DEFAULT_SCORING, DEFAULT_COMPACTION } from './types.js';
