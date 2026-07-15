/**
 * Built-in Memory Adapters
 *
 * Kernova ships these adapters out of the box:
 *   - PostgreSQL + pgvector (production, recommended)
 *   - SQLite + FTS5 (local development, zero-config)
 *   - In-Memory (testing, prototyping)
 *
 * Developers can implement the MemoryAdapter interface for:
 *   - Pinecone, Qdrant, Weaviate, Milvus
 *   - MongoDB, DynamoDB, Firestore
 *   - Turso/Libsql (edge)
 *   - Supabase (hosted PG)
 *   - Redis (for ephemeral/cache layers)
 *   - Any custom storage
 */

export { PostgresMemoryAdapter } from './postgres.js';
export type { PostgresAdapterConfig } from './postgres.js';

export { SqliteMemoryAdapter } from './sqlite.js';
export type { SqliteAdapterConfig } from './sqlite.js';

export { InMemoryAdapter } from './in-memory.js';
export type { InMemoryAdapterConfig } from './in-memory.js';
