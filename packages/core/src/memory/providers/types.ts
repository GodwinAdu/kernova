/**
 * Memory Provider Interface — Pluggable storage backends for agent memory.
 *
 * Developers can implement this interface to use any database/service
 * as the memory backend: PostgreSQL, Redis, Pinecone, Supabase, MongoDB, etc.
 *
 * The framework provides built-in providers:
 * - 'sqlite' (default, zero-config)
 * - 'postgres' (PostgreSQL + pgvector)
 * - 'memory' (in-memory only, for testing)
 *
 * Custom providers implement MemoryProvider and register via config.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  layer: 'working' | 'session' | 'longterm';
  tags: string[];
  metadata: Record<string, unknown>;
  relevance: number;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  embedding?: number[];
}

export interface MemorySearchOptions {
  query?: string;
  embedding?: number[];
  layer?: 'working' | 'session' | 'longterm';
  tags?: string[];
  limit?: number;
  minScore?: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/**
 * The interface that all memory providers must implement.
 */
export interface MemoryProvider {
  /** Provider name (for logging) */
  name: string;

  /** Initialize the provider (create tables, connect, etc.) */
  initialize(): Promise<void>;

  /** Store a memory entry */
  store(entry: MemoryEntry): Promise<void>;

  /** Search memories by text query (full-text search) */
  search(options: MemorySearchOptions): Promise<MemorySearchResult[]>;

  /** Search memories by vector similarity (semantic search) */
  searchByVector?(embedding: number[], options?: { limit?: number; minScore?: number; layer?: string }): Promise<MemorySearchResult[]>;

  /** Get a specific entry by ID */
  get(id: string): Promise<MemoryEntry | null>;

  /** Get all entries (with optional filtering) */
  getAll(options?: { layer?: string; limit?: number; tags?: string[] }): Promise<MemoryEntry[]>;

  /** Delete a memory entry */
  delete(id: string): Promise<void>;

  /** Update a memory entry */
  update(id: string, updates: Partial<MemoryEntry>): Promise<void>;

  /** Count total entries */
  count(layer?: string): Promise<number>;

  /** Close/cleanup the provider */
  close(): Promise<void>;
}

/**
 * Configuration for memory providers.
 */
export interface MemoryProviderConfig {
  /** Provider type */
  provider: 'sqlite' | 'postgres' | 'memory' | 'redis' | 'pinecone' | 'supabase' | 'custom';

  /** Connection URL (for postgres, redis, supabase) */
  url?: string;

  /** API key (for pinecone, supabase) */
  apiKey?: string;

  /** Database/index name */
  database?: string;

  /** Table/collection name (default: 'memories') */
  table?: string;

  /** Custom adapter path or instance */
  adapter?: string | MemoryProvider;

  /** Embedding model to use for vector search */
  embeddingModel?: string;

  /** Whether to enable vector search (requires embedding model) */
  vectorSearch?: boolean;

  /** SQLite-specific: file path */
  path?: string;

  /** Additional provider-specific options */
  options?: Record<string, unknown>;
}
