/**
 * defineMemoryConfig — Developer-facing Memory v2 configuration helper.
 *
 * This is the typed config factory for the Memory System v2.
 * It creates a configuration object that createServer uses to initialize
 * the KernovaMemoryEngine with the correct adapter, embedding, scoring, etc.
 *
 * Usage in kernova.config.ts:
 *   import { defineMemoryConfig } from '@kernova/framework';
 *
 *   export const memory = defineMemoryConfig({
 *     adapter: 'postgres',
 *     url: process.env.DATABASE_URL,
 *     embedding: { model: 'text-embedding-3-small', dimensions: 1536 },
 *     scoring: { similarityWeight: 0.5, recencyWeight: 0.25 },
 *     compaction: { enabled: true, threshold: 50 },
 *     namespaces: ['user-profile', 'tasks', 'knowledge'],
 *   });
 *
 * Or in a dedicated memory/index.ts config file:
 *   import { defineMemoryConfig } from '@kernova/framework';
 *
 *   export default defineMemoryConfig({
 *     adapter: 'sqlite',
 *     embedding: { model: 'text-embedding-3-small' },
 *   });
 */

import type {
  MemoryAdapter,
  ScoringConfig,
  CompactionConfig,
  MemoryHooks,
  MemoryEntryV2 as MemoryEntry,
  MemoryResult,
  MemoryQuery,
} from '@kernova/core';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryV2EmbeddingConfig {
  /** Embedding model to use (default: 'text-embedding-3-small') */
  model?: string;
  /** Vector dimensions (default: 1536) */
  dimensions?: number;
  /** Base URL for embedding API (optional, for custom providers) */
  baseUrl?: string;
  /** API key env variable name (optional, defaults to OPENAI_API_KEY) */
  apiKeyEnv?: string;
}

export interface MemoryV2Config {
  /** Adapter: 'postgres', 'sqlite', 'memory', or a custom MemoryAdapter instance */
  adapter: 'postgres' | 'sqlite' | 'memory' | MemoryAdapter;
  /** Connection URL (for postgres) or file path (for sqlite) */
  url?: string;
  /** Path to SQLite database file (for sqlite adapter) */
  path?: string;
  /** Table name override (default: 'kernova_memories') */
  table?: string;
  /** Schema name (postgres only, default: 'public') */
  schema?: string;
  /** Vector dimensions (default: 1536) */
  vectorDimensions?: number;

  /** Embedding configuration */
  embedding?: MemoryV2EmbeddingConfig;

  /** Retrieval scoring weights */
  scoring?: Partial<ScoringConfig>;

  /** Auto-compaction settings */
  compaction?: Partial<CompactionConfig>;

  /** Default namespace for memories (default: 'default') */
  defaultNamespace?: string;

  /** Declared namespaces (for documentation/typing, not enforced) */
  namespaces?: string[];

  /** Lifecycle hooks */
  hooks?: {
    /** Called before storing a memory. Return null to prevent storage. */
    onBeforeStore?: (entry: MemoryEntry) => Promise<MemoryEntry | null>;
    /** Called after a memory is stored. */
    onAfterStore?: (entry: MemoryEntry) => Promise<void>;
    /** Called before recall. Modify the query. */
    onBeforeRecall?: (query: MemoryQuery) => Promise<MemoryQuery>;
    /** Called after recall. Filter/rerank results. */
    onAfterRecall?: (results: MemoryResult[], query: MemoryQuery) => Promise<MemoryResult[]>;
  };

  /** Enable debug logging (default: false in production) */
  debug?: boolean;
}

/** Resolved memory config (what createServer receives) */
export type ResolvedMemoryV2Config = MemoryV2Config & { version: 2 };

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Define a Memory v2 configuration for the Kernova Framework.
 *
 * Returns a typed configuration object that the framework's createServer
 * will use to initialize the KernovaMemoryEngine.
 *
 * @example
 * ```ts
 * import { defineMemoryConfig } from '@kernova/framework';
 *
 * export default defineMemoryConfig({
 *   adapter: 'postgres',
 *   url: process.env.DATABASE_URL,
 *   embedding: { model: 'text-embedding-3-small', dimensions: 1536 },
 *   scoring: { similarityWeight: 0.5, recencyWeight: 0.25, frequencyWeight: 0.1, relevanceWeight: 0.15 },
 *   compaction: { enabled: true, threshold: 50, keepRecent: 10 },
 *   namespaces: ['user-profile', 'tasks', 'knowledge'],
 *   hooks: {
 *     onBeforeStore: async (entry) => entry,
 *     onAfterRecall: async (results, query) => results,
 *   },
 * });
 * ```
 */
export function defineMemoryConfig(config: MemoryV2Config): ResolvedMemoryV2Config {
  return {
    ...config,
    version: 2,
  };
}
