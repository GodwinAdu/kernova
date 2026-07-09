/**
 * Nexus Memory Engine
 * 
 * Pillar: Knowledge — "What do we know?"
 * 
 * Implements the five-layer memory architecture with persistent storage.
 * 
 * Layers:
 *   1. Working   — Current task context (minutes)
 *   2. Session   — Current interaction (hours)
 *   3. Long-term — User/project knowledge (months-years)
 *   4. Organizational — Shared company knowledge (years)
 *   5. Global    — Public knowledge (permanent)
 * 
 * Storage modes:
 *   - Persistent (default): SQLite + FTS5 full-text search
 *   - In-memory: For testing or ephemeral workloads
 */

import type {
  MemoryEntry,
  MemoryQuery,
  MemoryLayer,
  NexusId,
} from '@kernova/types';
import { EventBus } from '../events/event-bus.js';
import { MemoryStore, type MemoryStoreConfig } from './memory-store.js';
import { EmbeddingEngine } from './embedding-engine.js';
import { ModelRouter } from '../models/model-router.js';
import { generateId, now } from '../utils.js';

export interface MemoryEngineConfig {
  /** Enable persistent storage (default: true) */
  persistent?: boolean;

  /** SQLite store configuration */
  store?: MemoryStoreConfig;

  /** Enable vector embeddings for semantic search */
  embeddings?: boolean;

  /** Model router for generating embeddings */
  modelRouter?: ModelRouter | null;
}

export class MemoryEngine {
  private eventBus: EventBus;
  private memoryStore: MemoryStore | null = null;
  private inMemory: Map<NexusId, MemoryEntry> = new Map();
  private embeddingEngine: EmbeddingEngine;
  private persistent: boolean;
  private useEmbeddings: boolean;
  private storeConfig: MemoryStoreConfig;

  constructor(eventBus: EventBus, config: MemoryEngineConfig = {}) {
    this.eventBus = eventBus;
    this.persistent = config.persistent !== false;
    this.useEmbeddings = config.embeddings !== false;
    this.storeConfig = config.store || {};
    this.embeddingEngine = new EmbeddingEngine(config.modelRouter || null);
  }

  async start(): Promise<void> {
    if (this.persistent) {
      this.memoryStore = new MemoryStore(this.storeConfig);
    }
  }

  async stop(): Promise<void> {
    if (this.memoryStore) {
      this.memoryStore.close();
      this.memoryStore = null;
    }
  }

  /**
   * Store a memory entry
   */
  async store_entry(entry: Partial<MemoryEntry> & { content: string; layer: MemoryLayer }): Promise<MemoryEntry> {
    const fullEntry: MemoryEntry = {
      id: entry.id || generateId('mem'),
      type: 'memory_entry',
      version: '1.0.0',
      owner: entry.owner || 'system',
      status: 'active',
      createdAt: entry.createdAt || now(),
      updatedAt: now(),
      metadata: entry.metadata || {},
      layer: entry.layer,
      memoryType: entry.memoryType || 'fact',
      content: entry.content,
      data: entry.data,
      relevance: entry.relevance ?? 1.0,
      confidence: entry.confidence ?? 0.8,
      tags: entry.tags || [],
      source: entry.source || { type: 'system' },
      lastAccessedAt: now(),
      accessCount: 0,
      relations: entry.relations || [],
    };

    // Persist
    if (this.memoryStore) {
      this.memoryStore.store(fullEntry);

      // Generate embedding asynchronously (don't block store operation)
      if (this.useEmbeddings) {
        this.generateAndStoreEmbedding(fullEntry.id, fullEntry.content).catch(() => {
          // Embedding failed — non-critical, FTS still works
        });
      }
    } else {
      this.inMemory.set(fullEntry.id, fullEntry);
    }

    // Emit event
    this.eventBus.publish({
      id: generateId('evt'),
      eventType: 'memory.stored',
      category: 'memory',
      severity: 'debug',
      timestamp: now(),
      subjectId: fullEntry.id,
      subjectType: 'memory_entry',
      actorId: fullEntry.owner,
      correlationId: fullEntry.id,
      data: {
        layer: fullEntry.layer,
        memoryType: fullEntry.memoryType,
        contentLength: fullEntry.content.length,
      },
      metadata: {
        schemaVersion: '1.0.0',
        source: 'memory-engine',
        environment: 'development',
      },
    });

    return fullEntry;
  }

  /**
   * Backward-compatible alias for store_entry
   */
  async store(entry: Partial<MemoryEntry> & { content: string; layer: MemoryLayer }): Promise<MemoryEntry> {
    return this.store_entry(entry);
  }

  /**
   * Query memories with filters and optional text search.
   * Uses hybrid search (FTS5 + vector similarity) when embeddings are available.
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (this.memoryStore) {
      // If there's a text query and embeddings are enabled, try semantic search
      if (query.query && this.useEmbeddings && this.memoryStore) {
        const semanticResults = await this.semanticQuery(query);
        if (semanticResults.length > 0) {
          return semanticResults;
        }
      }
      // Fall back to FTS5 / filter-based query
      return this.memoryStore.query(query);
    }

    // In-memory fallback
    return this.queryInMemory(query);
  }

  /**
   * Get a specific memory by ID
   */
  async get(id: NexusId): Promise<MemoryEntry | undefined> {
    if (this.memoryStore) {
      return this.memoryStore.get(id);
    }
    return this.inMemory.get(id);
  }

  /**
   * Delete a memory
   */
  async delete(id: NexusId): Promise<boolean> {
    if (this.memoryStore) {
      return this.memoryStore.delete(id);
    }
    return this.inMemory.delete(id);
  }

  /**
   * Apply memory decay — reduce relevance of stale memories
   * Call periodically (e.g., daily) to keep memory fresh
   */
  async decay(options: { factor?: number; minRelevance?: number; olderThanMs?: number } = {}): Promise<number> {
    if (this.memoryStore) {
      return this.memoryStore.decay(options);
    }

    // In-memory decay
    const factor = options.factor ?? 0.95;
    const minRelevance = options.minRelevance ?? 0.1;
    const olderThanMs = options.olderThanMs ?? 86400000;
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    let decayed = 0;

    for (const entry of this.inMemory.values()) {
      if (entry.lastAccessedAt < cutoff && entry.relevance > minRelevance) {
        entry.relevance = Math.max(entry.relevance * factor, minRelevance);
        entry.updatedAt = now();
        decayed++;
      }
    }

    return decayed;
  }

  /**
   * Get memory count by layer
   */
  getStats(): Record<MemoryLayer, number> {
    if (this.memoryStore) {
      return this.memoryStore.getStats();
    }

    const stats: Record<string, number> = {
      working: 0, session: 0, longterm: 0, organizational: 0, global: 0,
    };
    for (const entry of this.inMemory.values()) {
      stats[entry.layer]++;
    }
    return stats as Record<MemoryLayer, number>;
  }

  /**
   * Whether persistent storage is active
   */
  get isPersistent(): boolean {
    return this.memoryStore !== null;
  }

  /**
   * Semantic search using vector embeddings.
   * Generates an embedding for the query, then finds similar memories.
   */
  private async semanticQuery(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.memoryStore) return [];

    // Generate query embedding
    const queryVector = await this.embeddingEngine.embed(query.query!);
    if (!queryVector) return []; // Embedding not available, fall back

    // Get stored embeddings (filtered by layer/owner)
    const candidates = this.memoryStore.getEmbeddings({
      layers: query.layers,
      ownerId: query.ownerId,
    });

    if (candidates.length === 0) return [];

    // Find similar vectors
    const similar = this.embeddingEngine.findSimilar(
      queryVector,
      candidates,
      query.limit || 20,
      0.4, // Minimum similarity threshold
    );

    if (similar.length === 0) return [];

    // Fetch full memory entries for matching IDs
    const results: MemoryEntry[] = [];
    for (const match of similar) {
      const entry = this.memoryStore.get(match.id);
      if (entry) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Generate an embedding and store it for a memory entry
   */
  private async generateAndStoreEmbedding(memoryId: NexusId, content: string): Promise<void> {
    if (!this.memoryStore) return;

    const vector = await this.embeddingEngine.embed(content);
    if (vector) {
      this.memoryStore.storeEmbedding(memoryId, vector);
    }
  }

  /**
   * In-memory query fallback
   */
  private queryInMemory(query: MemoryQuery): MemoryEntry[] {
    let results = Array.from(this.inMemory.values());

    if (query.layers?.length) {
      results = results.filter(e => query.layers!.includes(e.layer));
    }
    if (query.types?.length) {
      results = results.filter(e => query.types!.includes(e.memoryType));
    }
    if (query.tags?.length) {
      results = results.filter(e => query.tags!.some(tag => e.tags.includes(tag)));
    }
    if (query.ownerId) {
      results = results.filter(e => e.owner === query.ownerId);
    }
    if (query.minRelevance !== undefined) {
      results = results.filter(e => e.relevance >= query.minRelevance!);
    }
    if (query.minConfidence !== undefined) {
      results = results.filter(e => e.confidence >= query.minConfidence!);
    }
    if (query.after) {
      results = results.filter(e => e.createdAt > query.after!);
    }
    if (query.before) {
      results = results.filter(e => e.createdAt < query.before!);
    }
    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter(e =>
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    results.sort((a, b) => (b.relevance * b.confidence) - (a.relevance * a.confidence));

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    // Update access counts
    for (const entry of results) {
      entry.lastAccessedAt = now();
      entry.accessCount++;
    }

    return results;
  }
}
