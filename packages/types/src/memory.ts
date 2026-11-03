/**
 * Kernova Memory System
 * 
 * Five-layer memory architecture:
 * 1. Working Memory - Current task context
 * 2. Session Memory - Current conversation/interaction
 * 3. Long-term Memory - Projects, skills, preferences
 * 4. Organizational Memory - Shared company knowledge
 * 5. Global Knowledge - Public information and references
 */

import type {
  KernovaObject,
  KernovaId,
  Confidence,
  Timestamp,
} from './base.js';

/** Memory layers */
export type MemoryLayer =
  | 'working'
  | 'session'
  | 'longterm'
  | 'organizational'
  | 'global';

/** Types of memory entries */
export type MemoryType =
  | 'fact'          // A known truth
  | 'preference'   // A user/org preference
  | 'skill'        // A learned capability
  | 'experience'   // A past interaction outcome
  | 'relationship' // A connection between entities
  | 'procedure'    // How to do something
  | 'context'      // Contextual information
  | 'document';    // Reference material

/**
 * Memory Entry
 * A single piece of knowledge in the memory system
 */
export interface MemoryEntry extends KernovaObject {
  type: 'memory_entry';

  /** Which layer this belongs to */
  layer: MemoryLayer;

  /** What kind of memory */
  memoryType: MemoryType;

  /** The content of this memory */
  content: string;

  /** Structured data associated with this memory */
  data?: Record<string, unknown>;

  /** Relevance score (decays over time) */
  relevance: number;

  /** How confident we are in this memory */
  confidence: Confidence;

  /** Embedding vector for semantic search */
  embedding?: number[];

  /** Tags for categorical retrieval */
  tags: string[];

  /** Source of this memory */
  source: MemorySource;

  /** When this memory was last accessed */
  lastAccessedAt: Timestamp;

  /** How many times this memory has been accessed */
  accessCount: number;

  /** Relationships to other memories */
  relations: MemoryRelation[];
}

export interface MemorySource {
  /** What created this memory */
  type: 'user' | 'agent' | 'system' | 'import' | 'inference';

  /** Reference to the source */
  ref?: KernovaId;

  /** Human-readable description */
  description?: string;
}

export interface MemoryRelation {
  /** Related memory ID */
  targetId: KernovaId;

  /** Type of relationship */
  relationType: 'supports' | 'contradicts' | 'extends' | 'supersedes' | 'related';

  /** Strength of the relationship (0-1) */
  strength: number;
}

/**
 * Memory Query
 * How to retrieve memories
 */
export interface MemoryQuery {
  /** Natural language query */
  query?: string;

  /** Which layers to search */
  layers?: MemoryLayer[];

  /** Filter by memory type */
  types?: MemoryType[];

  /** Filter by tags */
  tags?: string[];

  /** Filter by owner */
  ownerId?: KernovaId;

  /** Minimum relevance score */
  minRelevance?: number;

  /** Minimum confidence */
  minConfidence?: Confidence;

  /** Maximum results */
  limit?: number;

  /** Time range */
  after?: Timestamp;
  before?: Timestamp;
}

/**
 * Context
 * Computed context for a specific intent/task
 * Decision #67: Context is computed, never stored as one giant blob
 */
export interface ComputedContext {
  /** The intent this context was computed for */
  intentId: KernovaId;

  /** Relevant memories */
  memories: MemoryEntry[];

  /** User information */
  user: ContextUser;

  /** Active permissions */
  permissions: string[];

  /** Applicable policies */
  policies: string[];

  /** Relevant knowledge */
  knowledge: MemoryEntry[];

  /** Passages retrieved from ingested documents (RAG), formatted for a prompt */
  documents?: string;

  /** Earlier turns of the conversation thread this intent belongs to, oldest first */
  conversation?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

  /** Total token estimate */
  estimatedTokens: number;

  /** When this context was computed */
  computedAt: Timestamp;
}

export interface ContextUser {
  /** User ID */
  userId: KernovaId;

  /** User's active role */
  role: string;

  /** User's preferences relevant to this context */
  preferences: Record<string, unknown>;
}
