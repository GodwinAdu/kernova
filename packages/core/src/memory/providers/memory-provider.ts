/**
 * In-Memory Provider — For testing and development.
 * No persistence — data lost on restart.
 */

import type { MemoryProvider, MemoryEntry, MemorySearchOptions, MemorySearchResult } from './types.js';

export class InMemoryProvider implements MemoryProvider {
  name = 'memory';
  private entries: Map<string, MemoryEntry> = new Map();

  async initialize(): Promise<void> {
    // Nothing to initialize
  }

  async store(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    let results = Array.from(this.entries.values());

    if (options.layer) {
      results = results.filter(e => e.layer === options.layer);
    }
    if (options.tags?.length) {
      results = results.filter(e => options.tags!.some(t => e.tags.includes(t)));
    }
    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(e =>
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    results.sort((a, b) => (b.relevance * b.confidence) - (a.relevance * a.confidence));

    const limited = results.slice(0, options.limit || 10);
    return limited.map(e => ({ entry: e, score: e.relevance * e.confidence }));
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) || null;
  }

  async getAll(options?: { layer?: string; limit?: number; tags?: string[] }): Promise<MemoryEntry[]> {
    let results = Array.from(this.entries.values());

    if (options?.layer) results = results.filter(e => e.layer === options.layer);
    if (options?.tags?.length) results = results.filter(e => options.tags!.some(t => e.tags.includes(t)));

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return options?.limit ? results.slice(0, options.limit) : results;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const existing = this.entries.get(id);
    if (existing) {
      this.entries.set(id, { ...existing, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async count(layer?: string): Promise<number> {
    if (layer) {
      return Array.from(this.entries.values()).filter(e => e.layer === layer).length;
    }
    return this.entries.size;
  }

  async close(): Promise<void> {
    this.entries.clear();
  }
}
