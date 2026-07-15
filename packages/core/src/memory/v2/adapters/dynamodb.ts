/**
 * DynamoDB Memory Adapter — AWS document-based implementation of MemoryAdapter.
 *
 * Features:
 *   - DynamoDB table with partition key = id
 *   - GSI (namespace-layer-index) for namespace + layer queries
 *   - Native TTL via DynamoDB TTL feature (expiresAtEpoch field)
 *   - Embeddings stored as List of Numbers
 *   - Vector search via brute-force cosine similarity in JS (DynamoDB has no native vector search)
 *   - Text search via Scan with FilterExpression (NOTE: not efficient for large tables)
 *   - Auto-creates table on initialize
 *   - DynamoDB Local support via custom endpoint
 *
 * Requires: @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb (optional peer deps).
 * Best for: AWS-native deployments, serverless architectures, pay-per-request scaling.
 *
 * LIMITATION: DynamoDB does not support native vector search. For large datasets,
 * vector search will be slow as it requires scanning and computing similarity in JS.
 * Consider Pinecone, Qdrant, or pgvector for heavy semantic search workloads.
 */

import type { MemoryAdapter, MemoryEntry, MemoryLayer, MemoryFilter } from '../types.js';

export interface DynamoDBAdapterConfig {
  /** AWS region (e.g., 'us-east-1') */
  region: string;
  /** Table name (default: 'kernova_memories') */
  tableName?: string;
  /** Custom endpoint (for DynamoDB Local, e.g., http://localhost:8000) */
  endpoint?: string;
  /** AWS credentials (optional — uses default credential chain if omitted) */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class DynamoDBMemoryAdapter implements MemoryAdapter {
  readonly name = 'dynamodb';
  private docClient: any = null;
  private ddbClient: any = null;
  private config: DynamoDBAdapterConfig;
  private tableName: string;
  private libs: { DynamoDBClient: any; CreateTableCommand: any; DescribeTableCommand: any; DynamoDBDocumentClient: any; PutCommand: any; GetCommand: any; DeleteCommand: any; UpdateCommand: any; QueryCommand: any; ScanCommand: any; BatchWriteCommand: any } | null = null;

  constructor(config: DynamoDBAdapterConfig) {
    this.config = config;
    this.tableName = config.tableName || 'kernova_memories';
  }

  async initialize(): Promise<void> {
    let clientDdb: any;
    let libDdb: any;

    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      clientDdb = require('@aws-sdk/client-dynamodb');
      libDdb = require('@aws-sdk/lib-dynamodb');
    } catch {
      try {
        clientDdb = await (Function('m', 'return import(m)')('@aws-sdk/client-dynamodb'));
        libDdb = await (Function('m', 'return import(m)')('@aws-sdk/lib-dynamodb'));
      } catch {
        throw new Error(
          'DynamoDB adapter requires "@aws-sdk/client-dynamodb" and "@aws-sdk/lib-dynamodb" packages. ' +
          'Install: npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb'
        );
      }
    }

    const DynamoDBClient = clientDdb.DynamoDBClient || clientDdb.default?.DynamoDBClient;
    const CreateTableCommand = clientDdb.CreateTableCommand || clientDdb.default?.CreateTableCommand;
    const DescribeTableCommand = clientDdb.DescribeTableCommand || clientDdb.default?.DescribeTableCommand;
    const DynamoDBDocumentClient = libDdb.DynamoDBDocumentClient || libDdb.default?.DynamoDBDocumentClient;
    const PutCommand = libDdb.PutCommand || libDdb.default?.PutCommand;
    const GetCommand = libDdb.GetCommand || libDdb.default?.GetCommand;
    const DeleteCommand = libDdb.DeleteCommand || libDdb.default?.DeleteCommand;
    const UpdateCommand = libDdb.UpdateCommand || libDdb.default?.UpdateCommand;
    const QueryCommand = libDdb.QueryCommand || libDdb.default?.QueryCommand;
    const ScanCommand = libDdb.ScanCommand || libDdb.default?.ScanCommand;
    const BatchWriteCommand = libDdb.BatchWriteCommand || libDdb.default?.BatchWriteCommand;

    this.libs = {
      DynamoDBClient, CreateTableCommand, DescribeTableCommand,
      DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand,
      UpdateCommand, QueryCommand, ScanCommand, BatchWriteCommand,
    };

    const clientConfig: any = { region: this.config.region };
    if (this.config.endpoint) clientConfig.endpoint = this.config.endpoint;
    if (this.config.credentials) clientConfig.credentials = this.config.credentials;

    this.ddbClient = new DynamoDBClient(clientConfig);
    this.docClient = DynamoDBDocumentClient.from(this.ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    // Create table if it doesn't exist
    await this.ensureTable();
  }

  async store(entry: MemoryEntry): Promise<void> {
    const { PutCommand } = this.libs!;
    const item = this.entryToItem(entry);

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const { BatchWriteCommand } = this.libs!;

    // DynamoDB BatchWrite supports max 25 items per request
    const batchSize = 25;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const requestItems = batch.map(entry => ({
        PutRequest: { Item: this.entryToItem(entry) },
      }));

      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: requestItems,
        },
      }));
    }
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const { GetCommand } = this.libs!;
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { id },
    }));

    if (!result.Item) return null;
    return this.itemToEntry(result.Item);
  }

  async getMany(ids: string[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    // DynamoDB BatchGetItem is more efficient but complex — use sequential for simplicity
    const results: MemoryEntry[] = [];
    for (const id of ids) {
      const entry = await this.get(id);
      if (entry) results.push(entry);
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    const { DeleteCommand } = this.libs!;
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { id },
    }));
  }

  async deleteBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { BatchWriteCommand } = this.libs!;

    const batchSize = 25;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const requestItems = batch.map(id => ({
        DeleteRequest: { Key: { id } },
      }));

      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: requestItems,
        },
      }));
    }
  }

  async deleteWhere(filter: MemoryFilter): Promise<number> {
    const entries = await this.scanWithFilter(filter);
    if (entries.length === 0) return 0;

    await this.deleteBatch(entries.map(e => e.id));
    return entries.length;
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const merged: MemoryEntry = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.store(merged);
  }

  async count(filter?: MemoryFilter): Promise<number> {
    if (!filter) {
      const { ScanCommand } = this.libs!;
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName,
        Select: 'COUNT',
      }));
      return result.Count || 0;
    }

    const entries = await this.scanWithFilter(filter);
    return entries.length;
  }

  async searchByVector(
    embedding: number[],
    options: { limit: number; namespace?: string; layer?: MemoryLayer; minScore?: number; tags?: string[] }
  ): Promise<Array<{ entry: MemoryEntry; similarity: number }>> {
    // DynamoDB has no native vector search — load entries and compute cosine in JS
    const filter: MemoryFilter = {};
    if (options.namespace) filter.namespace = options.namespace;
    if (options.layer) filter.layer = options.layer;
    if (options.tags?.length) filter.tags = options.tags;

    const entries = await this.scanWithFilter(filter, true);
    const results: Array<{ entry: MemoryEntry; similarity: number }> = [];

    for (const entry of entries) {
      if (!entry.embedding?.length) continue;
      // Skip expired
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
    // DynamoDB text search: Scan with contains filter
    // NOTE: This is NOT efficient for large tables — documented limitation
    const { ScanCommand } = this.libs!;

    const expressionParts: string[] = ['contains(content, :query)'];
    const expressionValues: Record<string, any> = { ':query': query };
    const expressionNames: Record<string, string> = {};

    if (options.namespace) {
      expressionParts.push('#ns = :ns');
      expressionValues[':ns'] = options.namespace;
      expressionNames['#ns'] = 'namespace';
    }
    if (options.layer) {
      expressionParts.push('#ly = :ly');
      expressionValues[':ly'] = options.layer;
      expressionNames['#ly'] = 'layer';
    }

    const params: any = {
      TableName: this.tableName,
      FilterExpression: expressionParts.join(' AND '),
      ExpressionAttributeValues: expressionValues,
    };

    if (Object.keys(expressionNames).length > 0) {
      params.ExpressionAttributeNames = expressionNames;
    }

    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const result = await this.docClient.send(new ScanCommand(params));
      allItems.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey && allItems.length < options.limit * 5);

    const queryLower = query.toLowerCase();
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const item of allItems) {
      const entry = this.itemToEntry(item);
      // Skip expired
      if (entry.expiresAt && entry.expiresAt <= new Date().toISOString()) continue;
      // Filter by tags in JS
      if (options.tags?.length && !options.tags.some(t => entry.tags.includes(t))) continue;

      const contentLower = entry.content.toLowerCase();
      const idx = contentLower.indexOf(queryLower);
      if (idx >= 0) {
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
    let entries: MemoryEntry[];

    // If filtering by namespace+layer, try the GSI
    if (options.namespace) {
      entries = await this.queryByNamespace(options.namespace, options.layer);
    } else {
      const filter: MemoryFilter = {};
      if (options.layer) filter.layer = options.layer;
      if (options.tags?.length) filter.tags = options.tags;
      entries = await this.scanWithFilter(filter);
    }

    // Apply tag filter
    if (options.tags?.length) {
      entries = entries.filter(e => options.tags!.some(t => e.tags.includes(t)));
    }

    // Filter expired
    entries = entries.filter(e => !e.expiresAt || e.expiresAt > new Date().toISOString());

    // Sort
    const orderBy = options.orderBy || 'createdAt';
    const order = options.order || 'desc';
    entries.sort((a: MemoryEntry, b: MemoryEntry) => {
      const aVal = orderBy === 'relevance' ? a.relevance : (a as any)[orderBy] || '';
      const bVal = orderBy === 'relevance' ? b.relevance : (b as any)[orderBy] || '';
      if (order === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return bVal < aVal ? -1 : bVal > aVal ? 1 : 0;
    });

    const offset = options.offset || 0;
    return entries.slice(offset, offset + (options.limit || 50));
  }

  async expireEntries(): Promise<number> {
    // DynamoDB TTL handles this automatically via expiresAtEpoch,
    // but we can also manually clean up entries where expiresAt has passed
    const now = new Date().toISOString();
    const { ScanCommand } = this.libs!;

    const params: any = {
      TableName: this.tableName,
      FilterExpression: 'attribute_exists(expiresAt) AND expiresAt <= :now AND expiresAt <> :empty',
      ExpressionAttributeValues: { ':now': now, ':empty': '' },
    };

    const result = await this.docClient.send(new ScanCommand(params));
    const items = result.Items || [];
    if (items.length === 0) return 0;

    const ids = items.map((item: any) => item.id);
    await this.deleteBatch(ids);
    return ids.length;
  }

  async close(): Promise<void> {
    if (this.ddbClient) {
      this.ddbClient.destroy();
      this.ddbClient = null;
      this.docClient = null;
    }
  }

  // ─── Private ───────────────────────────────────────────

  private async ensureTable(): Promise<void> {
    const { CreateTableCommand, DescribeTableCommand } = this.libs!;

    try {
      await this.ddbClient.send(new DescribeTableCommand({ TableName: this.tableName }));
      // Table exists
      return;
    } catch (err: any) {
      if (err.name !== 'ResourceNotFoundException') {
        // Some other error — table might exist but we can't describe it
        return;
      }
    }

    // Create table with GSI
    try {
      await this.ddbClient.send(new CreateTableCommand({
        TableName: this.tableName,
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'namespace', AttributeType: 'S' },
          { AttributeName: 'layer', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'namespace-layer-index',
            KeySchema: [
              { AttributeName: 'namespace', KeyType: 'HASH' },
              { AttributeName: 'layer', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        TimeToLiveSpecification: {
          AttributeName: 'expiresAtEpoch',
          Enabled: true,
        },
      }));

      // Wait for table to become active
      let active = false;
      for (let i = 0; i < 30; i++) {
        try {
          const desc = await this.ddbClient.send(new DescribeTableCommand({ TableName: this.tableName }));
          if (desc.Table?.TableStatus === 'ACTIVE') {
            active = true;
            break;
          }
        } catch {
          // Continue waiting
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!active) {
        console.warn(`[DynamoDBAdapter] Table "${this.tableName}" created but may not be active yet.`);
      }
    } catch (err: any) {
      if (!err.message?.includes('already exists') && err.name !== 'ResourceInUseException') {
        console.error(`[DynamoDBAdapter] Table creation warning:`, err.message);
      }
    }
  }

  private async queryByNamespace(namespace: string, layer?: MemoryLayer): Promise<MemoryEntry[]> {
    const { QueryCommand } = this.libs!;

    const params: any = {
      TableName: this.tableName,
      IndexName: 'namespace-layer-index',
      KeyConditionExpression: layer
        ? '#ns = :ns AND #ly = :ly'
        : '#ns = :ns',
      ExpressionAttributeNames: { '#ns': 'namespace', ...(layer ? { '#ly': 'layer' } : {}) },
      ExpressionAttributeValues: { ':ns': namespace, ...(layer ? { ':ly': layer } : {}) },
    };

    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const result = await this.docClient.send(new QueryCommand(params));
      allItems.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allItems.map((item: any) => this.itemToEntry(item));
  }

  private async scanWithFilter(filter: MemoryFilter, includeEmbedding = false): Promise<MemoryEntry[]> {
    const { ScanCommand } = this.libs!;

    const expressionParts: string[] = [];
    const expressionValues: Record<string, any> = {};
    const expressionNames: Record<string, string> = {};

    if (filter.namespace) {
      expressionParts.push('#ns = :ns');
      expressionValues[':ns'] = filter.namespace;
      expressionNames['#ns'] = 'namespace';
    }
    if (filter.layer) {
      expressionParts.push('#ly = :ly');
      expressionValues[':ly'] = filter.layer;
      expressionNames['#ly'] = 'layer';
    }
    if (filter.olderThan) {
      expressionParts.push('createdAt < :older');
      expressionValues[':older'] = filter.olderThan;
    }
    if (filter.newerThan) {
      expressionParts.push('createdAt > :newer');
      expressionValues[':newer'] = filter.newerThan;
    }

    const params: any = { TableName: this.tableName };
    if (expressionParts.length > 0) {
      params.FilterExpression = expressionParts.join(' AND ');
      params.ExpressionAttributeValues = expressionValues;
      if (Object.keys(expressionNames).length > 0) {
        params.ExpressionAttributeNames = expressionNames;
      }
    }

    const allItems: any[] = [];
    let lastKey: any = undefined;

    do {
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const result = await this.docClient.send(new ScanCommand(params));
      allItems.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    let entries = allItems.map((item: any) => this.itemToEntry(item, includeEmbedding));

    // Apply tag filter in JS (DynamoDB doesn't have great array-contains support)
    if (filter.tags?.length) {
      entries = entries.filter(e => filter.tags!.some(t => e.tags.includes(t)));
    }

    return entries;
  }

  private entryToItem(entry: MemoryEntry): Record<string, any> {
    const item: Record<string, any> = {
      id: entry.id,
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
      item.embedding = entry.embedding;
    }

    // DynamoDB native TTL field (epoch seconds)
    if (entry.expiresAt) {
      item.expiresAtEpoch = Math.floor(new Date(entry.expiresAt).getTime() / 1000);
    }

    return item;
  }

  private itemToEntry(item: any, includeEmbedding = true): MemoryEntry {
    let embedding: number[] | undefined;
    if (includeEmbedding && Array.isArray(item.embedding) && item.embedding.length > 0) {
      embedding = item.embedding;
    }

    return {
      id: item.id,
      content: item.content || '',
      layer: (item.layer || 'longterm') as MemoryLayer,
      namespace: item.namespace || 'default',
      tags: Array.isArray(item.tags) ? item.tags : [],
      metadata: item.metadata || {},
      embedding,
      relevance: item.relevance ?? 0.7,
      confidence: item.confidence ?? 0.8,
      accessCount: item.accessCount || 0,
      lastAccessedAt: item.lastAccessedAt || '',
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || '',
      ttl: item.ttl || null,
      expiresAt: item.expiresAt || null,
    };
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
