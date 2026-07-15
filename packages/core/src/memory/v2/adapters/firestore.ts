/**
 * Firestore Memory Adapter — Google Cloud document-based implementation of MemoryAdapter.
 *
 * Features:
 *   - Firestore documents with rich field types (strings, arrays, numbers, timestamps)
 *   - Native array-contains-any queries for tag filtering
 *   - Composite queries for namespace + layer filtering
 *   - Vector search via findNearest() (Firestore 2024+ feature), fallback to cosine in JS
 *   - TTL via Firestore TTL policies (expiresAt as Timestamp field)
 *   - Auto-creates collection on first write (Firestore behavior)
 *   - Supports Firestore emulator via FIRESTORE_EMULATOR_HOST
 *
 * Requires: @google-cloud/firestore (optional peer dependency).
 * Best for: GCP-native deployments, serverless architectures, real-time sync.
 *
 * NOTE: Firestore does not have native full-text search. For text search,
 * entries are loaded and filtered in JS. Consider Algolia or Elasticsearch
 * for production text search workloads.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface FirestoreAdapterConfig {
  /** GCP project ID (optional if running on GCP or using emulator) */
  projectId?: string;
  /** Collection name (default: 'kernova_memories') */
  collectionName?: string;
  /** Service account credentials JSON object */
  credentials?: object;
  /** Firestore database ID (default: '(default)') */
  databaseId?: string;
}

export class FirestoreMemoryAdapter implements MemoryAdapter {
  readonly name = 'firestore';
  private db: any = null;
  private collectionRef: any = null;
  private config: FirestoreAdapterConfig;
  private collectionName: string;
  private hasVectorSearch = false;

  constructor(config: FirestoreAdapterConfig) {
    this.config = config;
    this.collectionName = config.collectionName || 'kernova_memories';
  }

  async initialize(): Promise<void> {
    let firestore: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      firestore = require('@google-cloud/firestore');
    } catch {
      try {
        firestore = await (Function('m', 'return import(m)')('@google-cloud/firestore'));
      } catch {
        throw new Error(
          'Firestore adapter requires "@google-cloud/firestore" package. Install: npm install @google-cloud/firestore'
        );
      }
    }

    const Firestore = firestore.Firestore || firestore.default?.Firestore;

    const firestoreConfig: any = {};
    if (this.config.projectId) firestoreConfig.projectId = this.config.projectId;
    if (this.config.credentials) firestoreConfig.credentials = this.config.credentials;
    if (this.config.databaseId) firestoreConfig.databaseId = this.config.databaseId;

    this.db = new Firestore(firestoreConfig);
    this.collectionRef = this.db.collection(this.collectionName);

    // Check if vector search is available (Firestore 2024+ feature)
    try {
      // Attempt a findNearest query to test support
      const testQuery = this.collectionRef.limit(1);
      if (typeof testQuery.findNearest === 'function') {
        this.hasVectorSearch = true;
      }
    } catch {
      this.hasVectorSearch = false;
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const doc = this.entryToDocument(entry);
    await this.collectionRef.doc(entry.id).set(doc);
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Firestore batches support max 500 writes
    const batchSize = 500;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = this.db.batch();
      const slice = entries.slice(i, i + batchSize);

      for (const entry of slice) {
        const docRef = this.collectionRef.doc(entry.id);
        batch.set(docRef, this.entryToDocument(entry));
      }

      await batch.commit();
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const doc = await this.collectionRef.doc(id).get();
    if (!doc.exists) return null;
    return this.documentToEntry(id, doc.data());
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];

    // Firestore getAll supports multiple document refs
    const refs = ids.map(id => this.collectionRef.doc(id));
    const docs = await this.db.getAll(...refs);

    return docs
      .filter((doc: any) => doc.exists)
      .map((doc: any) => this.documentToEntry(doc.id, doc.data()));
  }

  async delete(id: string): Promise<void> {
    await this.collectionRef.doc(id).delete();
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const batchSize = 500;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = this.db.batch();
      const slice = ids.slice(i, i + batchSize);

      for (const id of slice) {
        batch.delete(this.collectionRef.doc(id));
      }

      await batch.commit();
    }
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const entries = await this.queryWithFilter(filter);
    if (entries.length === 0) return 0;

    await this.deleteBatch(entries.map(e => e.id));
    return entries.length;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const docRef = this.collectionRef.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return;

    const updateFields: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (updates.content !== undefined) updateFields.content = updates.content;
    if (updates.tags !== undefined) updateFields.tags = updates.tags;
    if (updates.metadata !== undefined) updateFields.metadata = updates.metadata;
    if (updates.relevance !== undefined) updateFields.relevance = updates.relevance;
    if (updates.confidence !== undefined) updateFields.confidence = updates.confidence;
    if (updates.accessCount !== undefined) updateFields.accessCount = updates.accessCount;
    if (updates.lastAccessedAt !== undefined) updateFields.lastAccessedAt = updates.lastAccessedAt;
    if (updates.namespace !== undefined) updateFields.namespace = updates.namespace;
    if (updates.embedding !== undefined) updateFields.embedding = updates.embedding;

    await docRef.update(updateFields);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    try {
      if (!filter) {
        const snapshot = await this.collectionRef.count().get();
        return snapshot.data().count || 0;
      }

      let query = this.buildFirestoreQuery(filter);
      const snapshot = await query.count().get();
      return snapshot.data().count || 0;
    } catch {
      // Fallback: fetch and count
      const entries = await this.queryWithFilter(filter || {});
      return entries.length;
    }
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // Try native Firestore vector search (findNearest, available since 2024)
    if (this.hasVectorSearch) {
      try {
        let query: any = this.collectionRef;

        if (options.namespace) {
          query = query.where('namespace', '==', options.namespace);
        }
        if (options.layer) {
          query = query.where('layer', '==', options.layer);
        }

        const vectorQuery = query.findNearest({
          vectorField: 'embedding',
          queryVector: embedding,
          limit: options.limit,
          distanceMeasure: 'COSINE',
        });

        const snapshot = await vectorQuery.get();
        const results: Array<{ entry: MemoryEntry; similarity: number }> = [];

        snapshot.forEach((doc: any) => {
          const entry = this.documentToEntry(doc.id, doc.data());
          // Skip expired
          if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) return;
          // Filter by tags in JS if needed
          if (options.tags?.length && !options.tags.some(t => entry.tags.includes(t))) return;
          // Compute similarity from vector (findNearest doesn't always return score)
          const similarity = entry.embedding?.length
            ? cosineSimilarity(embedding, entry.embedding)
            : 0;
          if (options.minScore && similarity < options.minScore) return;
          results.push({ entry, similarity });
        });

        return results;
      } catch {
        // Fall through to brute-force
      }
    }

    // Brute-force: load all entries with embeddings and compute cosine in JS
    const entries = await this.queryWithFilter({
      namespace: options.namespace,
      layer: options.layer,
      tags: options.tags,
    });

    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];
    for (const entry of entries) {
      if (!entry.embedding?.length) continue;
      if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (similarity >= (options.minScore || 0)) {
        results.push({ entry, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Firestore doesn't have native full-text search — load + filter in JS
    const entries = await this.queryWithFilter({
      namespace: options.namespace,
      layer: options.layer,
      tags: options.tags,
    });

    const queryLower = query.toLowerCase();
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of entries) {
      if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
      const contentLower = entry.content.toLowerCase();
      if (contentLower.includes(queryLower)) {
        const idx = contentLower.indexOf(queryLower);
        const positionScore = 1 - (idx / Math.max(entry.content.length, 1));
        results.push({ entry, score: Math.min(positionScore * 0.8, 1) });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.limit);
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    let query: any = this.collectionRef;

    if (options.namespace) {
      query = query.where('namespace', '==', options.namespace);
    }
    if (options.layer) {
      query = query.where('layer', '==', options.layer);
    }
    if (options.tags?.length) {
      // Firestore supports array-contains-any (up to 30 values)
      query = query.where('tags', 'array-contains-any', options.tags.slice(0, 30));
    }

    // Order
    const orderBy = options.orderBy || 'createdAt';
    const order = options.order || 'desc';
    try {
      query = query.orderBy(orderBy, order);
    } catch {
      // Composite index may not exist — fetch unordered and sort in JS
    }

    // Limit (with offset consideration)
    const limit = (options.limit || 50) + (options.offset || 0);
    query = query.limit(limit);

    try {
      const snapshot = await query.get();
      let entries: MemoryEntry[] = [];

      snapshot.forEach((doc: any) => {
        entries.push(this.documentToEntry(doc.id, doc.data()));
      });

      // Filter expired
      entries = entries.filter(e => !e.expiresAt || e.expiresAt > new Date().toISOString());

      // Sort in JS (in case Firestore couldn't apply orderBy)
      entries.sort((a: MemoryEntry, b: MemoryEntry) => {
        const aVal = orderBy === 'relevance' ? a.relevance : (a as any)[orderBy] || '';
        const bVal = orderBy === 'relevance' ? b.relevance : (b as any)[orderBy] || '';
        if (order === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return bVal < aVal ? -1 : bVal > aVal ? 1 : 0;
      });

      const offset = options.offset || 0;
      return entries.slice(offset, offset + (options.limit || 50));
    } catch {
      // If query fails (missing index), fallback to simple fetch
      const allEntries = await this.queryWithFilter({
        namespace: options.namespace,
        layer: options.layer,
        tags: options.tags,
      });

      let entries = allEntries.filter(e => !e.expiresAt || e.expiresAt > new Date().toISOString());

      entries.sort((a: MemoryEntry, b: MemoryEntry) => {
        const aVal = orderBy === 'relevance' ? a.relevance : (a as any)[orderBy] || '';
        const bVal = orderBy === 'relevance' ? b.relevance : (b as any)[orderBy] || '';
        if (order === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return bVal < aVal ? -1 : bVal > aVal ? 1 : 0;
      });

      const offset = options.offset || 0;
      return entries.slice(offset, offset + (options.limit || 50));
    }
  }

  async expireEntries(): Promise<number> {
    // Firestore TTL policies handle this automatically when configured,
    // but we can also manually clean up
    const now = new Date().toISOString();

    try {
      const snapshot = await this.collectionRef
        .where('expiresAt', '<=', now)
        .where('expiresAt', '!=', '')
        .get();

      const ids: string[] = [];
      snapshot.forEach((doc: any) => {
        ids.push(doc.id);
      });

      if (ids.length === 0) return 0;
      await this.deleteBatch(ids);
      return ids.length;
    } catch {
      // Index may not exist for this query — do a full scan
      const snapshot = await this.collectionRef.get();
      const expiredIds: string[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data.expiresAt && data.expiresAt !== '' && data.expiresAt <= now) {
          expiredIds.push(doc.id);
        }
      });

      if (expiredIds.length === 0) return 0;
      await this.deleteBatch(expiredIds);
      return expiredIds.length;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.terminate();
      } catch {
        // Client may not support terminate
      }
      this.db = null;
      this.collectionRef = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private entryToDocument(entry: MemoryEntry): Record<string, any> {
    const doc: Record<string, any> = {
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: entry.tags || [],
      metadata: entry.metadata || {},
      relevance: entry.relevance ?? 0.7,
      confidence: entry.confidence ?? 0.8,
      accessCount: entry.accessCount || 0,
      lastAccessedAt: entry.lastAccessedAt || new Date().toISOString(),
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      ttl: entry.ttl || 0,
      expiresAt: entry.expiresAt || '',
    };

    if (entry.embedding?.length) {
      doc.embedding = entry.embedding;
    }

    return doc;
  }

  private documentToEntry(id: string, data: any): MemoryEntry {
    let embedding: number[] | undefined;
    if (Array.isArray(data.embedding) && data.embedding.length > 0) {
      embedding = data.embedding;
    }

    return {
      id,
      content: data.content || '',
      layer: (data.layer || 'longterm') as MemoryLayer,
      namespace: data.namespace || 'default',
      tags: Array.isArray(data.tags) ? data.tags : [],
      metadata: data.metadata || {},
      embedding,
      relevance: data.relevance ?? 0.7,
      confidence: data.confidence ?? 0.8,
      accessCount: data.accessCount || 0,
      lastAccessedAt: data.lastAccessedAt || '',
      createdAt: data.createdAt || '',
      updatedAt: data.updatedAt || '',
      ttl: data.ttl || null,
      expiresAt: data.expiresAt || null,
    };
  }

  private buildFirestoreQuery(filter: MemoryFilter): any {
    let query: any = this.collectionRef;

    if (filter.namespace) {
      query = query.where('namespace', '==', filter.namespace);
    }
    if (filter.layer) {
      query = query.where('layer', '==', filter.layer);
    }
    if (filter.tags?.length) {
      query = query.where('tags', 'array-contains-any', filter.tags.slice(0, 30));
    }
    if (filter.olderThan) {
      query = query.where('createdAt', '<', filter.olderThan);
    }
    if (filter.newerThan) {
      query = query.where('createdAt', '>', filter.newerThan);
    }

    return query;
  }

  private async queryWithFilter(
    filter: MemoryFilter | { namespace?: string; layer?: MemoryLayer; tags?: string[] },
    limit = 5000
  ): Promise<MemoryEntry[]> {
    try {
      let query: any = this.collectionRef;

      if (filter.namespace) {
        query = query.where('namespace', '==', filter.namespace);
      }
      if (filter.layer) {
        query = query.where('layer', '==', filter.layer);
      }
      if (filter.tags?.length) {
        query = query.where('tags', 'array-contains-any', filter.tags.slice(0, 30));
      }

      query = query.limit(limit);
      const snapshot = await query.get();

      const entries: MemoryEntry[] = [];
      snapshot.forEach((doc: any) => {
        entries.push(this.documentToEntry(doc.id, doc.data()));
      });

      return entries;
    } catch {
      // If compound query fails (missing composite index), fetch all and filter in JS
      const snapshot = await this.collectionRef.limit(limit).get();
      const entries: MemoryEntry[] = [];

      snapshot.forEach((doc: any) => {
        const entry = this.documentToEntry(doc.id, doc.data());
        if (filter.namespace && entry.namespace !== filter.namespace) return;
        if (filter.layer && entry.layer !== filter.layer) return;
        if (filter.tags?.length && !filter.tags.some(t => entry.tags.includes(t))) return;
        entries.push(entry);
      });

      return entries;
    }
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────

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
