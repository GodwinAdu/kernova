/**
 * Built-in Memory Adapters
 *
 * Kernova ships these adapters out of the box:
 *   - PostgreSQL + pgvector (production, recommended)
 *   - SQLite + FTS5 (local development, zero-config)
 *   - In-Memory (testing, prototyping)
 *   - Redis (ephemeral/cache layers)
 *   - MongoDB (document-based, Atlas Vector Search)
 *   - Qdrant (vector-native, highest performance semantic retrieval)
 *   - Turso/LibSQL (edge-compatible SQLite)
 *   - Supabase (hosted PostgreSQL with pgvector)
 *
 * Developers can implement the MemoryAdapter interface for any custom storage.
 */

export { PostgresMemoryAdapter } from './postgres.js';
export type { PostgresAdapterConfig } from './postgres.js';

export { SqliteMemoryAdapter } from './sqlite.js';
export type { SqliteAdapterConfig } from './sqlite.js';

export { InMemoryAdapter } from './in-memory.js';
export type { InMemoryAdapterConfig } from './in-memory.js';

export { RedisMemoryAdapter } from './redis.js';
export type { RedisAdapterConfig } from './redis.js';

export { MongoDBMemoryAdapter } from './mongodb.js';
export type { MongoDBAdapterConfig } from './mongodb.js';

export { QdrantMemoryAdapter } from './qdrant.js';
export type { QdrantAdapterConfig } from './qdrant.js';

export { TursoMemoryAdapter } from './turso.js';
export type { TursoAdapterConfig } from './turso.js';

export { SupabaseMemoryAdapter } from './supabase.js';
export type { SupabaseAdapterConfig } from './supabase.js';

export { PineconeMemoryAdapter } from './pinecone.js';
export type { PineconeAdapterConfig } from './pinecone.js';

export { WeaviateMemoryAdapter } from './weaviate.js';
export type { WeaviateAdapterConfig } from './weaviate.js';

export { DynamoDBMemoryAdapter } from './dynamodb.js';
export type { DynamoDBAdapterConfig } from './dynamodb.js';

export { FirestoreMemoryAdapter } from './firestore.js';
export type { FirestoreAdapterConfig } from './firestore.js';
