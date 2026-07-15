/**
 * Kernova Memory System v2 — Types & Interfaces
 *
 * Three-layer architecture:
 *   Layer 1: Working Memory (ephemeral, in-process, TTL-based)
 *   Layer 2: Session Memory (per-thread, persisted conversations + summaries)
 *   Layer 3: Long-term Memory (forever, vector-indexed, scored retrieval)
 *
 * Developers can:
 *   - Use any storage backend via the MemoryAdapter interface
 *   - Define custom namespaces to partition data
 *   - Hook into save/recall/forget lifecycle
 *   - Configure retrieval scoring weights
 *   - Add custom metadata to any memory
 */

// ─── Core Types ──────────────────────────────────────────────────────────────

/** Memory layers — each has different lifecycle and retrieval semantics */
export type MemoryLayer = 'working' | 'session' | 'longterm';

/** A single memory entry stored in the system */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;
  /** The content of the memory (human-readable text) */
  content: string;
  /** Which layer this memory lives in */
  layer: MemoryLayer;
  /** Namespace for partitioning (e.g., user ID, topic, agent name) */
  namespace: string;
  /** Tags for categorical filtering */
  tags: string[];
  /** Arbitrary metadata (developer-defined) */
  metadata: Record<string, unknown>;
  /** Vector embedding for semantic search */
  embedding?: number[];
  /** Relevance score (0-1, how important is this memory) */
  relevance: number;
  /** Confidence score (0-1, how certain are we this is accurate) */
  confidence: number;
  /** Access count (how many times has this been recalled) */
  accessCount: number;
  /** Last time this memory was accessed/recalled */
  lastAccessedAt: string;
  /** When this memory was first created */
  createdAt: string;
  /** When this memory was last updated */
  updatedAt: string;
  /** TTL in seconds (null = never expires) */
  ttl?: number | null;
  /** Expiration timestamp (computed from createdAt + ttl) */
  expiresAt?: string | null;
}

/** Options for searching/querying memories */
export interface MemoryQuery {
  /** Text query (used for full-text and semantic search) */
  query?: string;
  /** Pre-computed embedding vector for direct similarity search */
  embedding?: number[];
  /** Filter by layer */
  layer?: MemoryLayer;
  /** Filter by namespace */
  namespace?: string;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Filter by metadata fields */
  metadata?: Record<string, unknown>;
  /** Maximum results to return */
  limit?: number;
  /** Minimum relevance score threshold (0-1) */
  minScore?: number;
  /** How to score results (default uses combined scoring) */
  scoring?: ScoringConfig;
  /** Whether to include expired entries */
  includeExpired?: boolean;
  /** Time range filter */
  after?: string;
  before?: string;
}

/** Result from a memory search */
export interface MemoryResult {
  /** The memory entry */
  entry: MemoryEntry;
  /** Combined relevance score (0-1) from the scoring algorithm */
  score: number;
  /** Breakdown of individual score components */
  scoreBreakdown?: {
    similarity: number;   // Vector/text similarity (0-1)
    recency: number;      // How recent (0-1, 1 = just now)
    frequency: number;    // How often accessed (0-1)
    relevance: number;    // Base relevance score (0-1)
  };
}

// ─── Scoring Configuration ───────────────────────────────────────────────────

/** Weights for the retrieval scoring algorithm */
export interface ScoringConfig {
  /** Weight for vector/text similarity (default: 0.5) */
  similarityWeight: number;
  /** Weight for recency (default: 0.25) */
  recencyWeight: number;
  /** Weight for access frequency (default: 0.1) */
  frequencyWeight: number;
  /** Weight for base relevance (default: 0.15) */
  relevanceWeight: number;
  /** Recency decay half-life in hours (default: 168 = 1 week) */
  recencyHalfLife: number;
  /** Frequency boost cap (max score from frequency) */
  frequencyBoostCap: number;
}

/** Default scoring configuration */
export const DEFAULT_SCORING: ScoringConfig = {
  similarityWeight: 0.5,
  recencyWeight: 0.25,
  frequencyWeight: 0.1,
  relevanceWeight: 0.15,
  recencyHalfLife: 168,  // 1 week
  frequencyBoostCap: 0.9,
};

// ─── Memory Adapter Interface ────────────────────────────────────────────────

/**
 * The interface developers implement to use any storage backend.
 *
 * Kernova ships adapters for:
 *   - PostgreSQL + pgvector
 *   - SQLite + sqlite-vec
 *   - Redis (for working memory)
 *   - In-Memory (for testing)
 *
 * Developers can implement this for:
 *   - Pinecone, Qdrant, Weaviate, Milvus (vector DBs)
 *   - MongoDB, DynamoDB, Firestore (document DBs)
 *   - Turso/Libsql (edge)
 *   - Supabase (hosted PostgreSQL)
 *   - Any custom storage
 */
export interface MemoryAdapter {
  /** Adapter name (for logging/debugging) */
  readonly name: string;

  /** Initialize connection, create tables/indexes, etc. */
  initialize(): Promise<void>;

  /** Store a memory entry (upsert semantics — update if ID exists) */
  store(entry: MemoryEntry): Promise<void>;

  /** Store multiple entries in a batch (for efficiency) */
  storeBatch?(entries: MemoryEntry[]): Promise<void>;

  /** Get a single entry by ID */
  get(id: string): Promise<MemoryEntry | null>;

  /** Get multiple entries by IDs */
  getMany?(ids: string[]): Promise<MemoryEntry[]>;

  /** Delete an entry by ID */
  delete(id: string): Promise<void>;

  /** Delete multiple entries */
  deleteBatch?(ids: string[]): Promise<void>;

  /** Delete entries matching a filter */
  deleteWhere?(filter: MemoryFilter): Promise<number>;

  /** Update specific fields of an entry */
  update(id: string, updates: Partial<MemoryEntry>): Promise<void>;

  /** Count entries matching optional filter */
  count(filter?: MemoryFilter): Promise<number>;

  /**
   * Search by vector similarity.
   * Returns entries sorted by cosine/dot-product similarity.
   * This is the primary retrieval mechanism for semantic search.
   */
  searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>>;

  /**
   * Search by text (full-text search, keyword matching).
   * Fallback when embeddings aren't available or for exact matches.
   */
  searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>>;

  /**
   * List entries with filtering and pagination.
   * Used for browsing, not semantic retrieval.
   */
  list(options: {
    namespace?: string;
    layer?: MemoryLayer;
    tags?: string[];
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]>;

  /**
   * Expire entries that have passed their TTL.
   * Called periodically by the memory engine.
   */
  expireEntries?(): Promise<number>;

  /** Close connections and cleanup */
  close(): Promise<void>;
}

/** Filter for querying/deleting entries */
export interface MemoryFilter {
  namespace?: string;
  layer?: MemoryLayer;
  tags?: string[];
  metadata?: Record<string, unknown>;
  olderThan?: string;
  newerThan?: string;
}

// ─── Working Memory ──────────────────────────────────────────────────────────

/** Entry in working memory (ephemeral, in-process) */
export interface WorkingMemoryEntry {
  key: string;
  value: unknown;
  ttl: number;       // seconds
  createdAt: number; // Date.now()
  expiresAt: number; // Date.now() + ttl * 1000
}

/** Working memory interface (in-process, no DB needed) */
export interface WorkingMemory {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown, ttl?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  keys(): string[];
  size(): number;
  /** Get all entries for a namespace prefix (e.g., "thread:abc:*") */
  getByPrefix<T = unknown>(prefix: string): Array<{ key: string; value: T }>;
}

// ─── Auto-Compaction ─────────────────────────────────────────────────────────

/** Configuration for auto-compaction (conversation summarization) */
export interface CompactionConfig {
  /** Enable auto-compaction (default: true) */
  enabled: boolean;
  /** Compact after this many messages in a thread (default: 50) */
  threshold: number;
  /** Keep this many recent messages uncompacted (default: 10) */
  keepRecent: number;
  /** Model to use for summarization (default: same as agent model) */
  model?: string;
  /** Maximum summary length in tokens (default: 500) */
  maxSummaryTokens: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = {
  enabled: true,
  threshold: 50,
  keepRecent: 10,
  maxSummaryTokens: 500,
};

/** A conversation summary produced by compaction */
export interface ConversationSummary {
  threadId: string;
  summary: string;
  messagesCompacted: number;
  topics: string[];
  keyFacts: string[];
  createdAt: string;
}

// ─── Lifecycle Hooks ─────────────────────────────────────────────────────────

/** Hooks that developers can register to control memory behavior */
export interface MemoryHooks {
  /**
   * Called before storing a memory. Return null to prevent storage.
   * Modify the entry to change what gets stored.
   */
  onBeforeStore?(entry: MemoryEntry): Promise<MemoryEntry | null>;

  /**
   * Called after a memory is stored successfully.
   */
  onAfterStore?(entry: MemoryEntry): Promise<void>;

  /**
   * Called before recall/retrieval. Modify the query to change retrieval behavior.
   */
  onBeforeRecall?(query: MemoryQuery): Promise<MemoryQuery>;

  /**
   * Called after recall. Filter/rerank results before they're used.
   */
  onAfterRecall?(results: MemoryResult[], query: MemoryQuery): Promise<MemoryResult[]>;

  /**
   * Called when a memory expires or is deleted.
   */
  onForget?(entry: MemoryEntry, reason: 'expired' | 'deleted' | 'compacted'): Promise<void>;

  /**
   * Called when compaction produces a summary. Developer can modify or reject.
   */
  onCompaction?(summary: ConversationSummary, messages: Array<{ role: string; content: string }>): Promise<ConversationSummary | null>;

  /**
   * Custom classifier — developer defines what layer/namespace to assign.
   * If not provided, uses default classification logic.
   */
  classify?(content: string, context: { role: string; threadId: string; agentName: string }): Promise<{
    layer: MemoryLayer;
    namespace: string;
    tags: string[];
    relevance: number;
    ttl?: number;
  } | null>;
}

// ─── Memory Engine Configuration ─────────────────────────────────────────────

/** Full configuration for the Kernova Memory Engine */
export interface MemoryEngineConfig {
  /** Storage adapter (required) */
  adapter: MemoryAdapter;
  /** Working memory implementation (optional, defaults to in-process) */
  workingMemory?: WorkingMemory;
  /** Embedding function (required for vector search) */
  embed?: (text: string) => Promise<number[] | null>;
  /** Retrieval scoring weights */
  scoring?: Partial<ScoringConfig>;
  /** Auto-compaction settings */
  compaction?: Partial<CompactionConfig>;
  /** Lifecycle hooks */
  hooks?: MemoryHooks;
  /** Default namespace (default: 'default') */
  defaultNamespace?: string;
  /** Working memory TTL in seconds (default: 3600 = 1 hour) */
  workingMemoryTTL?: number;
  /** How often to run expiration cleanup in seconds (default: 300 = 5 min) */
  expirationInterval?: number;
  /** Enable debug logging */
  debug?: boolean;
}
