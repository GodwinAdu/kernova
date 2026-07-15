/**
 * MongoDB Memory Adapter — Document-based implementation of MemoryAdapter.
 *
 * Features:
 *   - MongoDB Atlas Search for full-text search
 *   - Atlas Vector Search ($vectorSearch) when configured, brute-force fallback
 *   - TTL index on expiresAt for automatic cleanup
 *   - Flexible BSON document mapping
 *   - Tag-based filtering via $in queries
 *   - BSON-native metadata storage
 *
 * Requires: mongodb (optional peer dependency).
 * Works with: MongoDB Atlas, self-hosted MongoDB 6+, CosmosDB (Mongo API).
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface MongoDBAdapterConfig {
  /** MongoDB connection URL (e.g., mongodb+srv://...) */
  url: string;
  /** Database name (default: 'kernova') */
  database?: string;
  /** Collection name (default: 'memories') */
  collection?: string;
  /** Atlas vector search index name (optional — enables native vector search) */
  vectorIndex?: string;
}

export class MongoDBMemoryAdapter implements MemoryAdapter {
  readonly name = 'mongodb';
  private client: any = null;
  private db: any = null;
  private col: any = null;
  private config: MongoDBAdapterConfig;
  private collectionName: string;
  private databaseName: string;
  private vectorIndex: string | null;

  constructor(config: MongoDBAdapterConfig) {
    this.config = config;
    this.databaseName = config.database || 'kernova';
    this.collectionName = config.collection || 'memories';
    this.vectorIndex = config.vectorIndex || null;
  }

  async initialize(): Promise<void> {
    let mongodb: any;
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      mongodb = require('mongodb');
    } catch {
      try {
        mongodb = await (Function('m', 'return import(m)')('mongodb'));
      } catch {
        throw new Error('MongoDB adapter requires "mongodb" package. Install: npm install mongodb');
      }
    }

    const MongoClient = mongodb.MongoClient || mongodb.default?.MongoClient;
    this.client = new MongoClient(this.config.url);
    await this.client.connect();

    this.db = this.client.db(this.databaseName);
    this.col = this.db.collection(this.collectionName);

    // Create indexes
    try {
      await this.col.createIndex({ namespace: 1, layer: 1 });
      await this.col.createIndex({ tags: 1 });
      await this.col.createIndex({ createdAt: -1 });
      await this.col.createIndex({ lastAccessedAt: -1 });
      await this.col.createIndex({ layer: 1 });
      await this.col.createIndex({ namespace: 1 });
      // TTL index — MongoDB automatically removes documents when expiresAt is reached
      await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
      // Text index for full-text search
      await this.col.createIndex({ content: 'text' });
    } catch {
      // Indexes may already exist
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    const doc = this.entryToDocument(entry);
    await this.col.updateOne(
      { _id: entry.id },
      { $set: doc },
      { upsert: true }
    );
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const operations = entries.map(entry => ({
      updateOne: {
        filter: { _id: entry.id },
        update: { $set: this.entryToDocument(entry) },
        upsert: true,
      }
    }));
    await this.col.bulkWrite(operations);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const doc = await this.col.findOne({ _id: id });
    return doc ? this.documentToEntry(doc) : null;
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const docs = await this.col.find({ _id: { $in: ids } }).toArray();
    return docs.map((d: any) => this.documentToEntry(d));
  }

  async delete(id: string): Promise<void> {
    await this.col.deleteOne({ _id: id });
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.col.deleteMany({ _id: { $in: ids } });
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const query = this.buildFilterQuery(filter);
    const result = await this.col.deleteMany(query);
    return result.deletedCount || 0;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const sets: Record<string, any> = { updatedAt: new Date().toISOString() };

    if (updates.content !== undefined) sets.content = updates.content;
    if (updates.tags !== undefined) sets.tags = updates.tags;
    if (updates.metadata !== undefined) sets.metadata = updates.metadata;
    if (updates.relevance !== undefined) sets.relevance = updates.relevance;
    if (updates.confidence !== undefined) sets.confidence = updates.confidence;
    if (updates.accessCount !== undefined) sets.accessCount = updates.accessCount;
    if (updates.lastAccessedAt !== undefined) sets.lastAccessedAt = updates.lastAccessedAt;
    if (updates.namespace !== undefined) sets.namespace = updates.namespace;
    if (updates.embedding !== undefined) sets.embedding = updates.embedding;

    await this.col.updateOne({ _id: id }, { $set: sets });
  }

  async count(filter?: MemoryFilter): Promise<number> {
    const query = filter ? this.buildFilterQuery(filter) : {};
    return this.col.countDocuments(query);
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // Try Atlas Vector Search if configured
    if (this.vectorIndex) {
      try {
        const filter: Record<string, any> = {};
        if (options.namespace) filter.namespace = options.namespace;
        if (options.layer) filter.layer = options.layer;
        if (options.tags?.length) filter.tags = { $in: options.tags };

        const pipeline: any[] = [
          {
            $vectorSearch: {
              index: this.vectorIndex,
              path: 'embedding',
              queryVector: embedding,
              numCandidates: options.limit * 10,
              limit: options.limit,
              filter: Object.keys(filter).length > 0 ? filter : undefined,
            }
          },
          {
            $addFields: {
              similarity: { $meta: 'vectorSearchScore' }
            }
          }
        ];

        if (options.minScore) {
          pipeline.push({ $match: { similarity: { $gte: options.minScore } } });
        }

        const docs = await this.col.aggregate(pipeline).toArray();
        return docs.map((d: any) => ({
          entry: this.documentToEntry(d),
          similarity: d.similarity || 0,
        }));
      } catch {
        // Fall through to brute-force
      }
    }

    // Brute-force: load all entries with embeddings and compute cosine similarity in JS
    const query: Record<string, any> = { embedding: { $exists: true, $ne: null } };
    if (options.namespace) query.namespace = options.namespace;
    if (options.layer) query.layer = options.layer;
    if (options.tags?.length) query.tags = { $in: options.tags };

    // Exclude expired
    query.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date().toISOString() } },
    ];

    const docs = await this.col.find(query).toArray();
    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];

    for (const doc of docs) {
      if (!doc.embedding?.length) continue;
      const similarity = cosineSimilarity(embedding, doc.embedding);
      if (similarity >= (options.minScore || 0)) {
        results.push({ entry: this.documentToEntry(doc), similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }

  async searchByText(
    query: string,
    options: { limit: number; namespace?: string; layer?: MemoryLayer; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    // Try MongoDB text search first
    try {
      const filter: Record<string, any> = {
        $text: { $search: query },
      };
      if (options.namespace) filter.namespace = options.namespace;
      if (options.layer) filter.layer = options.layer;
      if (options.tags?.length) filter.tags = { $in: options.tags };

      // Exclude expired
      filter.$or = [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date().toISOString() } },
      ];

      const docs = await this.col.find(filter, { projection: { score: { $meta: 'textScore' } } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(options.limit)
        .toArray();

      if (docs.length > 0) {
        return docs.map((d: any) => ({
          entry: this.documentToEntry(d),
          score: Math.min(d.score / 5, 1), // Normalize MongoDB text score
        }));
      }
    } catch {
      // Text index may not exist; fall through
    }

    // Fallback to regex search
    const filter: Record<string, any> = {
      content: { $regex: query, $options: 'i' },
    };
    if (options.namespace) filter.namespace = options.namespace;
    if (options.layer) filter.layer = options.layer;
    if (options.tags?.length) filter.tags = { $in: options.tags };

    filter.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date().toISOString() } },
    ];

    const docs = await this.col.find(filter)
      .sort({ createdAt: -1 })
      .limit(options.limit)
      .toArray();

    return docs.map((d: any) => ({ entry: this.documentToEntry(d), score: 0.4 }));
  }

  async list(options: {
    namespace?: string; layer?: MemoryLayer; tags?: string[];
    limit?: number; offset?: number;
    orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'relevance';
    order?: 'asc' | 'desc';
  }): Promise<MemoryEntry[]> {
    const query: Record<string, any> = {
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date().toISOString() } },
      ],
    };

    if (options.namespace) query.namespace = options.namespace;
    if (options.layer) query.layer = options.layer;
    if (options.tags?.length) query.tags = { $in: options.tags };

    const sortField = options.orderBy || 'createdAt';
    const sortDir = options.order === 'asc' ? 1 : -1;

    const docs = await this.col.find(query)
      .sort({ [sortField]: sortDir })
      .skip(options.offset || 0)
      .limit(options.limit || 50)
      .toArray();

    return docs.map((d: any) => this.documentToEntry(d));
  }

  async expireEntries(): Promise<number> {
    // MongoDB TTL index handles this automatically, but we can also manually clean
    const result = await this.col.deleteMany({
      expiresAt: { $ne: null, $lte: new Date().toISOString() },
    });
    return result.deletedCount || 0;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.col = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private entryToDocument(entry: MemoryEntry): Record<string, any> {
    return {
      _id: entry.id,
      content: entry.content,
      layer: entry.layer,
      namespace: entry.namespace,
      tags: entry.tags || [],
      metadata: entry.metadata || {},
      embedding: entry.embedding || null,
      relevance: entry.relevance ?? 0.7,
      confidence: entry.confidence ?? 0.8,
      accessCount: entry.accessCount || 0,
      lastAccessedAt: entry.lastAccessedAt || new Date().toISOString(),
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      ttl: entry.ttl || null,
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
    };
  }

  private documentToEntry(doc: any): MemoryEntry {
    return {
      id: doc._id,
      content: doc.content || '',
      layer: (doc.layer || 'longterm') as MemoryLayer,
      namespace: doc.namespace || 'default',
      tags: doc.tags || [],
      metadata: doc.metadata || {},
      embedding: doc.embedding || undefined,
      relevance: doc.relevance ?? 0.7,
      confidence: doc.confidence ?? 0.8,
      accessCount: doc.accessCount || 0,
      lastAccessedAt: doc.lastAccessedAt instanceof Date ? doc.lastAccessedAt.toISOString() : (doc.lastAccessedAt || ''),
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : (doc.createdAt || ''),
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : (doc.updatedAt || ''),
      ttl: doc.ttl || null,
      expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.toISOString() : (doc.expiresAt || null),
    };
  }

  private buildFilterQuery(filter: MemoryFilter): Record<string, any> {
    const query: Record<string, any> = {};
    if (filter.namespace) query.namespace = filter.namespace;
    if (filter.layer) query.layer = filter.layer;
    if (filter.tags?.length) query.tags = { $in: filter.tags };
    if (filter.olderThan) query.createdAt = { $lt: filter.olderThan };
    if (filter.newerThan) query.createdAt = { ...query.createdAt, $gt: filter.newerThan };
    return query;
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
