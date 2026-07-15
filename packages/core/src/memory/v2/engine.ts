/**
 * Kernova Memory Engine v2 — The brain of the memory system.
 *
 * Orchestrates all three layers:
 *   - Working Memory (in-process TTL cache)
 *   - Session Memory (conversation threads + summaries)
 *   - Long-term Memory (vector-indexed, scored retrieval)
 *
 * Developers interact with this through a simple API:
 *   engine.store(content, options)   — save a memory
 *   engine.recall(query, options)    — retrieve relevant memories
 *   engine.forget(id)               — delete a memory
 *   engine.working.get/set          — ephemeral task state
 *
 * The engine handles:
 *   - Embedding generation
 *   - Scoring and ranking
 *   - TTL expiration
 *   - Auto-compaction
 *   - Hook execution
 *   - Namespace isolation
 */

import type {
  MemoryAdapter,
  MemoryEntry,
  MemoryQuery,
  MemoryResult,
  MemoryLayer,
  MemoryEngineConfig,
  ScoringConfig,
  WorkingMemory,
  MemoryHooks,
  CompactionConfig,
} from './types.js';
import { DEFAULT_SCORING, DEFAULT_COMPACTION } from './types.js';
import { InProcessWorkingMemory } from './working-memory.js';
import { scoreResults, normalizeWeights } from './scoring.js';

export class KernovaMemoryEngine {
  /** Working memory (ephemeral, in-process) */
  public readonly working: WorkingMemory;

  private adapter: MemoryAdapter;
  private embed: ((text: string) => Promise<number[] | null>) | undefined;
  private scoring: ScoringConfig;
  private compaction: CompactionConfig;
  private hooks: MemoryHooks;
  private defaultNamespace: string;
  private debug: boolean;
  private expirationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: MemoryEngineConfig) {
    this.adapter = config.adapter;
    this.embed = config.embed;
    this.scoring = normalizeWeights(config.scoring || {});
    this.compaction = { ...DEFAULT_COMPACTION, ...(config.compaction || {}) };
    this.hooks = config.hooks || {};
    this.defaultNamespace = config.defaultNamespace || 'default';
    this.debug = config.debug || false;

    // Working memory
    this.working = config.workingMemory || new InProcessWorkingMemory({
      defaultTTL: config.workingMemoryTTL || 3600,
    });

    // Start periodic expiration cleanup
    const expirationInterval = (config.expirationInterval || 300) * 1000;
    this.expirationTimer = setInterval(() => this.runExpiration(), expirationInterval);
    if (this.expirationTimer.unref) this.expirationTimer.unref();
  }

  /**
   * Initialize the engine (must be called before use).
   */
  async initialize(): Promise<void> {
    await this.adapter.initialize();
    if (this.debug) console.log(`[MemoryEngine] Initialized with adapter: ${this.adapter.name}`);
  }

  // ─── STORE ─────────────────────────────────────────────────────────────────

  /**
   * Store a memory entry.
   *
   * @param content - Text content to remember
   * @param options - Storage options (layer, namespace, tags, metadata, ttl)
   * @returns The stored entry ID
   */
  async store(content: string, options: {
    layer?: MemoryLayer;
    namespace?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    relevance?: number;
    confidence?: number;
    ttl?: number;
    id?: string;
  } = {}): Promise<string> {
    const now = new Date().toISOString();
    const id = options.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let entry: MemoryEntry = {
      id,
      content,
      layer: options.layer || 'longterm',
      namespace: options.namespace || this.defaultNamespace,
      tags: options.tags || [],
      metadata: options.metadata || {},
      relevance: options.relevance ?? 0.7,
      confidence: options.confidence ?? 0.8,
      accessCount: 0,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
      ttl: options.ttl || null,
      expiresAt: options.ttl ? new Date(Date.now() + options.ttl * 1000).toISOString() : null,
    };

    // Generate embedding if embed function is available
    if (this.embed && entry.layer !== 'working') {
      try {
        const embedding = await this.embed(content);
        if (embedding) entry.embedding = embedding;
      } catch {
        // Non-critical — store without embedding
      }
    }

    // Execute onBeforeStore hook
    if (this.hooks.onBeforeStore) {
      const modified = await this.hooks.onBeforeStore(entry);
      if (modified === null) {
        if (this.debug) console.log(`[MemoryEngine] Store rejected by hook: ${content.slice(0, 50)}`);
        return id;
      }
      entry = modified;
    }

    // Store in adapter
    await this.adapter.store(entry);

    // Execute onAfterStore hook
    if (this.hooks.onAfterStore) {
      await this.hooks.onAfterStore(entry).catch(() => {});
    }

    if (this.debug) console.log(`[MemoryEngine] Stored: ${entry.layer}/${entry.namespace} "${content.slice(0, 50)}..."`);
    return id;
  }

  /**
   * Store multiple memories in a batch.
   */
  async storeBatch(entries: Array<{ content: string; layer?: MemoryLayer; namespace?: string; tags?: string[]; metadata?: Record<string, unknown> }>): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of entries) {
      const id = await this.store(entry.content, entry);
      ids.push(id);
    }
    return ids;
  }

  // ─── RECALL ────────────────────────────────────────────────────────────────

  /**
   * Recall relevant memories for a given query.
   * Uses vector similarity + scoring algorithm for ranking.
   *
   * @param query - What to search for (text or options object)
   * @param options - Additional query parameters
   * @returns Scored and ranked results
   */
  async recall(query: string | MemoryQuery, options?: Partial<MemoryQuery>): Promise<MemoryResult[]> {
    // Normalize query input
    const queryObj: MemoryQuery = typeof query === 'string'
      ? { query, ...options }
      : { ...query, ...options };

    // Apply defaults
    queryObj.limit = queryObj.limit || 15;
    queryObj.namespace = queryObj.namespace || this.defaultNamespace;

    // Execute onBeforeRecall hook
    if (this.hooks.onBeforeRecall) {
      const modified = await this.hooks.onBeforeRecall(queryObj);
      Object.assign(queryObj, modified);
    }

    let rawResults: Array<{ entry: MemoryEntry; similarity: number }> = [];

    // Strategy 1: Vector search (semantic, preferred)
    if (this.embed && queryObj.query) {
      try {
        const embedding = queryObj.embedding || await this.embed(queryObj.query);
        if (embedding) {
          rawResults = await this.adapter.searchByVector(embedding, {
            limit: queryObj.limit * 2, // Over-fetch for reranking
            namespace: queryObj.namespace,
            layer: queryObj.layer,
            minScore: queryObj.minScore || 0.2,
            tags: queryObj.tags,
          });
        }
      } catch {
        // Vector search failed — fall through to text search
      }
    }

    // Strategy 2: Text search (fallback or supplement)
    if (rawResults.length < (queryObj.limit || 15) && queryObj.query) {
      try {
        const textResults = await this.adapter.searchByText(queryObj.query, {
          limit: queryObj.limit || 15,
          namespace: queryObj.namespace,
          layer: queryObj.layer,
          tags: queryObj.tags,
        });

        // Merge text results (avoid duplicates)
        const existingIds = new Set(rawResults.map(r => r.entry.id));
        for (const tr of textResults) {
          if (!existingIds.has(tr.entry.id)) {
            rawResults.push({ entry: tr.entry, similarity: tr.score * 0.8 }); // Slight penalty vs vector
          }
        }
      } catch {
        // Text search failed — use what we have
      }
    }

    // Filter expired entries
    if (!queryObj.includeExpired) {
      const now = Date.now();
      rawResults = rawResults.filter(r => {
        if (!r.entry.expiresAt) return true;
        return new Date(r.entry.expiresAt).getTime() > now;
      });
    }

    // Apply scoring algorithm
    const scoringConfig = queryObj.scoring || this.scoring;
    let scored = scoreResults(rawResults, scoringConfig);

    // Apply min score filter
    if (queryObj.minScore) {
      scored = scored.filter(r => r.score >= queryObj.minScore!);
    }

    // Trim to requested limit
    scored = scored.slice(0, queryObj.limit);

    // Update access counts (async, non-blocking)
    this.updateAccessCounts(scored.map(r => r.entry.id)).catch(() => {});

    // Execute onAfterRecall hook
    if (this.hooks.onAfterRecall) {
      scored = await this.hooks.onAfterRecall(scored, queryObj);
    }

    if (this.debug) {
      console.log(`[MemoryEngine] Recall "${(queryObj.query || '').slice(0, 40)}" → ${scored.length} results`);
    }

    return scored;
  }

  /**
   * Recall memories and format them as a string for prompt injection.
   * Convenience method for the common use case.
   */
  async recallForPrompt(query: string, options?: { limit?: number; namespace?: string }): Promise<string> {
    const results = await this.recall(query, options);
    if (results.length === 0) return '';

    return results
      .map(r => `• ${r.entry.content}`)
      .join('\n');
  }

  // ─── FORGET ────────────────────────────────────────────────────────────────

  /**
   * Delete a specific memory.
   */
  async forget(id: string): Promise<void> {
    const entry = await this.adapter.get(id);
    if (!entry) return;

    await this.adapter.delete(id);

    if (this.hooks.onForget) {
      await this.hooks.onForget(entry, 'deleted').catch(() => {});
    }

    if (this.debug) console.log(`[MemoryEngine] Forgot: ${id}`);
  }

  /**
   * Delete all memories matching a filter.
   */
  async forgetWhere(filter: { namespace?: string; layer?: MemoryLayer; tags?: string[]; olderThan?: string }): Promise<number> {
    if (this.adapter.deleteWhere) {
      return await this.adapter.deleteWhere(filter);
    }

    // Fallback: list and delete individually
    const entries = await this.adapter.list({
      namespace: filter.namespace,
      layer: filter.layer,
      tags: filter.tags,
      limit: 1000,
    });

    let deleted = 0;
    for (const entry of entries) {
      if (filter.olderThan && entry.createdAt > filter.olderThan) continue;
      await this.adapter.delete(entry.id);
      deleted++;
    }
    return deleted;
  }

  // ─── UTILITIES ─────────────────────────────────────────────────────────────

  /**
   * Get total memory count.
   */
  async count(filter?: { namespace?: string; layer?: MemoryLayer }): Promise<number> {
    return await this.adapter.count(filter);
  }

  /**
   * Get a specific memory by ID.
   */
  async get(id: string): Promise<MemoryEntry | null> {
    return await this.adapter.get(id);
  }

  /**
   * Update a memory entry.
   */
  async update(id: string, updates: Partial<Pick<MemoryEntry, 'content' | 'tags' | 'metadata' | 'relevance' | 'namespace'>>): Promise<void> {
    const updatePayload: Partial<MemoryEntry> = {
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Re-embed if content changed
    if (updates.content && this.embed) {
      try {
        const embedding = await this.embed(updates.content);
        if (embedding) updatePayload.embedding = embedding;
      } catch {}
    }

    await this.adapter.update(id, updatePayload);
  }

  /**
   * List memories (for browsing/management UI).
   */
  async list(options?: {
    namespace?: string;
    layer?: MemoryLayer;
    tags?: string[];
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    return await this.adapter.list(options || {});
  }

  /**
   * Graceful shutdown.
   */
  async close(): Promise<void> {
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = null;
    }
    if (this.working instanceof InProcessWorkingMemory) {
      (this.working as InProcessWorkingMemory).destroy();
    }
    await this.adapter.close();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async updateAccessCounts(ids: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of ids) {
      try {
        const entry = await this.adapter.get(id);
        if (entry) {
          await this.adapter.update(id, {
            accessCount: (entry.accessCount || 0) + 1,
            lastAccessedAt: now,
          });
        }
      } catch {
        // Non-critical
      }
    }
  }

  private async runExpiration(): Promise<void> {
    if (this.adapter.expireEntries) {
      const expired = await this.adapter.expireEntries();
      if (expired > 0 && this.debug) {
        console.log(`[MemoryEngine] Expired ${expired} entries`);
      }
    }
  }
}

/**
 * Factory function — create a configured KernovaMemoryEngine.
 *
 * Usage:
 *   import { createMemoryEngine } from '@kernova/core';
 *
 *   const engine = await createMemoryEngine({
 *     adapter: new PostgresAdapter({ url: process.env.DATABASE_URL }),
 *     embed: async (text) => openai.embeddings.create({ model: 'text-embedding-3-small', input: text }),
 *     scoring: { recencyWeight: 0.3, similarityWeight: 0.4 },
 *     hooks: {
 *       onBeforeStore: async (entry) => { ... },
 *     },
 *   });
 *
 *   await engine.store("User prefers Python", { tags: ['preference', 'programming'] });
 *   const results = await engine.recall("what language does the user like?");
 */
export async function createMemoryEngine(config: MemoryEngineConfig): Promise<KernovaMemoryEngine> {
  const engine = new KernovaMemoryEngine(config);
  await engine.initialize();
  return engine;
}
