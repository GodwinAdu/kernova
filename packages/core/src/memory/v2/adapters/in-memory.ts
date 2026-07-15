/**
 * In-Memory Adapter — Simple Map-based implementation of MemoryAdapter.
 *
 * Features:
 *   - Zero dependencies (pure JavaScript)
 *   - Brute-force cosine similarity for vector search
 *   - Case-insensitive string matching for text search
 *   - All operations are synchronous (wrapped in async)
 *   - Great for testing, prototyping, and small datasets
 *
 * Limitations:
 *   - Data is lost on process restart
 *   - Not suitable for production with large datasets
 *   - No persistence
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface InMemoryAdapterConfig {
  /** Maximum number of entries to store (default: 10000) */
  maxEntries?: number;
}

export class InMemoryAdapter implements MemoryAdapter {
  readonly name = 'memory';
  private entries = new Map<string, MemoryEntry>();
  private maxEntries: number;

  constructor(config: InMemoryAdapterConfig = {}) {
    this.maxEntries = config.maxEntries || 10000;
  }

  async initialize(): Promise<void> {
    // Nothing to initialize — ready immediately
  }

  async store(entry: MemoryEntry): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.entries.size >= this.maxEntries && !this.entries.has(entry.id)) {
      const oldestId = this.findOldestEntry();
      if (oldestId) this.entries.delete(oldestId);
    }

    this.entries.set(entry.id, { ...entry });
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.store(entry);
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : null;
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) results.push({ ...entry });
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async deleteBatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.entries.delete(id);
    }
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    let deleted = 0;
    for (const [id, entry] of this.entries) {
      if (this.matchesFilter(entry, filter)) {
        this.entries.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;

    const updated = {
      ...entry,
      ...updates,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    };
    this.entries.set(id, updated);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    if (!filter) return this.entries.size;

    let count = 0;
    for (const entry of this.entries.values()) {
      if (this.matchesFilter(entry, filter)) count++;
    }
    return count;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];
    const now = Date.now();

    for (const entry of this.entries.values()) {
      // Skip entries without embeddings
      if (!entry.embedding || entry.embedding.length === 0) continue;

      // Apply filters
      if (options.namespace && entry.namespace !== options.namespace) continue;
      if (options.layer && entry.layer !== options.layer) continue;
      if (options.tags?.length && !options.tags.some(t => entry.tags.includes(t))) continue;
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) continue;

      // Compute cosine similarity
      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (similarity >= (options.minScore || 0)) {
        results.push({ entry: { ...entry }, similarity });
      }
    }

    // Sort by similarity descending and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    const results: Array<{ entry: MemoryEntry; score: number }> = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const now = Date.now();

    for (const entry of this.entries.values()) {
      // Apply filters
      if (options.namespace && entry.namespace !== options.namespace) continue;
      if (options.layer && entry.layer !== options.layer) continue;
      if (options.tags?.length && !options.tags.some(t => entry.tags.includes(t))) continue;
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) continue;

      const contentLower = entry.content.toLowerCase();

      // Exact substring match (highest score)
      if (contentLower.includes(queryLower)) {
        results.push({ entry: { ...entry }, score: 1.0 });
        continue;
      }

      // Word-level matching
      if (queryWords.length > 0) {
        const matchedWords = queryWords.filter(w => contentLower.includes(w));
        if (matchedWords.length > 0) {
          const score = matchedWords.length / queryWords.length;
          results.push({ entry: { ...entry }, score: score * 0.8 });
        }
      }
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.limit);
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: string; order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    const now = Date.now();
    let entries: MemoryEntry[] = [];

    for (const entry of this.entries.values()) {
      // Exclude expired
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) continue;

      // Apply filters
      if (options.namespace && entry.namespace !== options.namespace) continue;
      if (options.layer && entry.layer !== options.layer) continue;
      if (options.tags?.length && !options.tags.some(t => entry.tags.includes(t))) continue;

      entries.push({ ...entry });
    }

    // Sort
    const orderBy = options.orderBy || 'createdAt';
    const order = options.order || 'desc';
    entries.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (orderBy) {
        case 'updatedAt': aVal = a.updatedAt; bVal = b.updatedAt; break;
        case 'lastAccessedAt': aVal = a.lastAccessedAt; bVal = b.lastAccessedAt; break;
        case 'relevance': aVal = a.relevance; bVal = b.relevance; break;
        default: aVal = a.createdAt; bVal = b.createdAt; break;
      }

      if (order === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    });

    // Pagination
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    return entries.slice(offset, offset + limit);
  }

  async expireEntries(): Promise<number> {
    const now = Date.now();
    let expired = 0;

    for (const [id, entry] of this.entries) {
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) {
        this.entries.delete(id);
        expired++;
      }
    }
    return expired;
  }

  async close(): Promise<void> {
    this.entries.clear();
  }

  // ─── Private ───────────────────────────────────────────

  private matchesFilter(entry: MemoryEntry, filter: MemoryFilter): boolean {
    if (filter.namespace && entry.namespace !== filter.namespace) return false;
    if (filter.layer && entry.layer !== filter.layer) return false;
    if (filter.olderThan && entry.createdAt >= filter.olderThan) return false;
    if (filter.newerThan && entry.createdAt <= filter.newerThan) return false;
    if (filter.tags?.length && !filter.tags.some(t => entry.tags.includes(t))) return false;
    return true;
  }

  private findOldestEntry(): string | null {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of this.entries) {
      const time = new Date(entry.createdAt).getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = id;
      }
    }
    return oldestId;
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
