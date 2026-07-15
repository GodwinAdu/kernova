---
title: "Memory System"
description: "Give your agents intelligent memory — store, recall, and forget information using a three-layer architecture with scored retrieval."
---

# Memory System

Kernova's memory system gives your agents the ability to remember information across conversations, sessions, and time. It's designed as a **three-layer architecture** that developers can configure from zero-config to fully custom.

## Architecture

```
┌─ Working Memory ─────────────────────────────────────┐
│  In-process cache (RAM). Task state, tool outputs.   │
│  TTL-based. Dies with the process.                   │
└──────────────────────────────────────────────────────┘
┌─ Session Memory ─────────────────────────────────────┐
│  Per-conversation thread. Messages + summaries.      │
│  Auto-compacts long conversations.                   │
└──────────────────────────────────────────────────────┘
┌─ Long-term Memory ───────────────────────────────────┐
│  Vector-indexed facts. Scored retrieval.             │
│  Namespaced. Never expires unless you tell it to.    │
└──────────────────────────────────────────────────────┘
```

Each layer serves a distinct purpose:

| Layer | What it stores | Lifecycle | Storage |
|-------|---------------|-----------|---------|
| **Working** | Current task state, tool outputs, temp calculations | Dies with process | In-process Map (RAM) |
| **Session** | Conversation messages, auto-summaries | Per-thread, auto-compacted | PostgreSQL / SQLite |
| **Long-term** | Facts, preferences, knowledge, episodes | Forever (configurable TTL) | PostgreSQL+pgvector / SQLite |

## Quick Start

### Basic Configuration (kernova.config.ts)

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'my-app',
  model: { provider: 'openai', model: 'gpt-4o' },
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    autoRecall: true,      // Inject memories into every prompt
    autoSave: true,        // Auto-detect important info and save
    contextMessages: 20,   // Include last 20 messages as context
  },
});
```

That's it for basic usage. The framework handles embedding, retrieval, and injection automatically.

### Advanced Configuration

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'my-app',
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,

    // Embedding model for vector search
    embedding: {
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },

    // Scoring weights (must sum to ~1.0)
    scoring: {
      similarityWeight: 0.45,   // How semantically close
      recencyWeight: 0.25,      // How recent
      frequencyWeight: 0.15,    // How often accessed
      relevanceWeight: 0.15,    // Base importance
      recencyHalfLife: 336,     // Hours until recency score = 0.5
    },

    // Auto-compact long conversations
    compaction: {
      enabled: true,
      threshold: 50,    // Compact after 50 messages
      keepRecent: 10,   // Keep last 10 intact
    },

    defaultNamespace: 'default',
    autoRecall: true,
    autoSave: true,
    contextMessages: 20,
  },
});
```

---

## Retrieval Scoring Algorithm

When your agent recalls memories, they're scored using four signals:

```
score = (similarity × w1) + (recency × w2) + (frequency × w3) + (relevance × w4)
```

| Signal | What it measures | Formula |
|--------|-----------------|---------|
| **Similarity** | How semantically close to the query | Cosine distance (0-1) |
| **Recency** | How recently created/updated | `e^(-ageHours / halfLife)` |
| **Frequency** | How often recalled before | `log(1 + count) / log(1 + cap)` |
| **Relevance** | Base importance set at storage | Direct value (0-1) |

This ensures:
- A memory about the user's name (high relevance) surfaces even if it's months old
- Frequently accessed memories get a boost (they matter)
- Recent memories win when similarity scores are close
- The system scales — scoring happens at retrieval time, not storage

### Custom Scoring

```typescript
memory: {
  scoring: {
    // For a personal assistant (long-term facts matter most):
    similarityWeight: 0.45,
    recencyWeight: 0.20,
    frequencyWeight: 0.15,
    relevanceWeight: 0.20,
    recencyHalfLife: 672,  // 4 weeks (personal facts age slowly)
  },
}
```

```typescript
memory: {
  scoring: {
    // For a news/research agent (recency matters most):
    similarityWeight: 0.35,
    recencyWeight: 0.40,
    frequencyWeight: 0.10,
    relevanceWeight: 0.15,
    recencyHalfLife: 24,  // 1 day (old news is irrelevant)
  },
}
```

---

## Storage Adapters

Kernova ships **8 built-in adapters**. You can also implement your own.

### PostgreSQL + pgvector (Recommended for Production)

```typescript
memory: {
  version: 2,
  provider: 'postgres',
  url: process.env.DATABASE_URL,
}
```

Features: Native vector search (cosine similarity), full-text search (tsvector + GIN), JSONB metadata, automatic indexes.

Works with: Neon, Supabase, AWS RDS, any PostgreSQL 14+.

### SQLite (Local Development)

```typescript
memory: {
  version: 2,
  provider: 'sqlite',
  path: './data/memory.db',
}
```

Features: FTS5 full-text search, cosine similarity in JS, single-file database, zero config.

### In-Memory (Testing)

```typescript
memory: {
  version: 2,
  provider: 'memory',
}
```

Features: Zero dependencies, instant, lost on restart. Perfect for unit tests.

### Redis (Cache / Ephemeral Layer)

```typescript
import { RedisMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new RedisMemoryAdapter({
    url: 'redis://localhost:6379',
    prefix: 'myapp:memory',
  }),
});
```

Features: Native TTL via EXPIRE, sorted set indexes, RediSearch full-text when available. Best for working memory, cache layers.

Install: `npm install ioredis`

### MongoDB (Document-Based)

```typescript
import { MongoDBMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new MongoDBMemoryAdapter({
    url: 'mongodb+srv://user:pass@cluster.mongodb.net',
    database: 'myapp',
    collection: 'memories',
    vectorIndex: 'vector_index', // Optional: Atlas Vector Search
  }),
});
```

Features: Atlas Vector Search (when configured), TTL index (auto-cleanup), text index, flexible BSON documents.

Install: `npm install mongodb`

### Qdrant (Vector-Native, Highest Performance)

```typescript
import { QdrantMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new QdrantMemoryAdapter({
    url: 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY, // For Qdrant Cloud
    collectionName: 'memories',
    vectorSize: 1536,
  }),
});
```

Features: Native HNSW vector search (fastest semantic retrieval), payload filtering, automatic collection creation. Best for large-scale AI applications.

Install: `npm install @qdrant/js-client-rest`

### Turso / LibSQL (Edge-Compatible)

```typescript
import { TursoMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new TursoMemoryAdapter({
    url: 'libsql://your-db.turso.io',
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});
```

Features: Edge-compatible SQLite, globally replicated, FTS5 text search, works in Cloudflare Workers and Deno Deploy.

Install: `npm install @libsql/client`

### Supabase (Hosted PostgreSQL)

```typescript
import { SupabaseMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new SupabaseMemoryAdapter({
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY, // For DDL operations
  }),
});
```

Features: pgvector via Supabase RPC, auto-creates match function, PostgreSQL full-text search, Row Level Security compatible.

Install: `npm install @supabase/supabase-js`

### Custom Adapter

Implement the `MemoryAdapter` interface to use any database:

```typescript
import type { MemoryAdapter, MemoryEntry, MemoryLayer } from '@kernova/core';

class PineconeAdapter implements MemoryAdapter {
  readonly name = 'pinecone';

  async initialize() { /* connect to Pinecone */ }

  async store(entry: MemoryEntry) { /* upsert vector */ }

  async searchByVector(embedding: number[], options) {
    // Query Pinecone index
    const results = await this.index.query({
      vector: embedding,
      topK: options.limit,
      filter: { namespace: options.namespace },
    });
    return results.matches.map(m => ({
      entry: this.toEntry(m),
      similarity: m.score,
    }));
  }

  async searchByText(query: string, options) {
    // Pinecone doesn't do text search natively
    // You could embed the query first, or return empty
    return [];
  }

  async list(options) { /* list from metadata store */ }
  async get(id: string) { /* fetch by ID */ }
  async delete(id: string) { /* delete vector */ }
  async update(id: string, updates) { /* update metadata */ }
  async count(filter?) { /* count vectors */ }
  async close() { /* cleanup */ }
}
```

Then use it in config:

```typescript
import { defineConfig } from '@kernova/framework/config';
import { PineconeAdapter } from './adapters/pinecone';

export default defineConfig({
  memory: {
    version: 2,
    adapter: new PineconeAdapter({ apiKey: process.env.PINECONE_KEY }),
  },
});
```

---

## Using the Memory Engine Directly

For advanced use cases, you can access the memory engine directly in custom tools or handlers:

```typescript
import { createMemoryEngine, PostgresMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new PostgresMemoryAdapter({ url: process.env.DATABASE_URL }),
  embed: async (text) => {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return res.data[0].embedding;
  },
});

// Store a memory
await engine.store("User prefers dark mode and Python for backend", {
  layer: 'longterm',
  namespace: 'user-preferences',
  tags: ['preference', 'ui', 'programming'],
  relevance: 0.9,
});

// Recall relevant memories
const results = await engine.recall("what theme does the user like?", {
  limit: 5,
  namespace: 'user-preferences',
});

console.log(results[0].entry.content);
// → "User prefers dark mode and Python for backend"
console.log(results[0].score);
// → 0.87 (combined similarity + recency + frequency + relevance)
console.log(results[0].scoreBreakdown);
// → { similarity: 0.92, recency: 0.95, frequency: 0.1, relevance: 0.9 }
```

### Store with TTL (Auto-expires)

```typescript
// Working memory — task state, expires in 5 minutes
await engine.store("Currently searching flights to Paris", {
  layer: 'working',
  ttl: 300,  // seconds
  tags: ['task', 'flight-search'],
});

// Session memory — important for this conversation, expires in 24h
await engine.store("User wants to book for 2 adults", {
  layer: 'session',
  ttl: 86400,
  tags: ['booking', 'context'],
});

// Long-term — never expires
await engine.store("User's birthday is March 15", {
  layer: 'longterm',
  tags: ['personal', 'birthday'],
  relevance: 1.0,  // Very important
});
```

### Working Memory (Ephemeral)

```typescript
// No database needed — lives in RAM
engine.working.set('current_task', {
  type: 'flight_search',
  destination: 'Paris',
  dates: { depart: '2025-08-01', return: '2025-08-08' },
  passengers: 2,
}, 300); // TTL: 5 minutes

// Retrieve later in the same process
const task = engine.working.get('current_task');
// → { type: 'flight_search', destination: 'Paris', ... }

// Check if still alive
engine.working.has('current_task'); // → true (if within TTL)

// Group by prefix
engine.working.set('tool:gmail:result', { emails: [...] }, 60);
engine.working.set('tool:calendar:result', { events: [...] }, 60);
const toolResults = engine.working.getByPrefix('tool:');
// → [{ key: 'tool:gmail:result', value: {...} }, { key: 'tool:calendar:result', value: {...} }]
```

### Namespaces

Partition memories by any key — user, topic, agent, or custom:

```typescript
// Store in different namespaces
await engine.store("Name is Godwin Adu", {
  namespace: 'user-profile',
  tags: ['identity'],
});

await engine.store("Prefers casual communication style", {
  namespace: 'user-preferences',
  tags: ['communication'],
});

await engine.store("Sprint ends Friday, need to deploy auth module", {
  namespace: 'work-context',
  tags: ['sprint', 'deadline'],
});

// Recall from specific namespace only
const prefs = await engine.recall("how should I talk to the user?", {
  namespace: 'user-preferences',
});

// Recall across all namespaces
const everything = await engine.recall("what do I know about this user?");
```

### Forget (Delete)

```typescript
// Delete a specific memory
await engine.forget('mem_abc123');

// Delete all memories in a namespace
await engine.forgetWhere({ namespace: 'temp-data' });

// Delete old memories
await engine.forgetWhere({
  olderThan: new Date(Date.now() - 90 * 86400000).toISOString(), // > 90 days
  layer: 'session',
});

// Delete by tag
await engine.forgetWhere({ tags: ['deprecated'] });
```

---

## Lifecycle Hooks

Control what gets stored, retrieved, and forgotten:

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    hooks: {
      // Filter what gets stored
      onBeforeStore: async (entry) => {
        // Don't store passwords or tokens
        if (entry.content.match(/password|token|secret|api.key/i)) {
          return null; // Prevent storage
        }
        // Auto-tag personal info
        if (entry.content.match(/my name|i am|i live|i work/i)) {
          entry.tags.push('personal');
          entry.relevance = 0.95;
        }
        return entry;
      },

      // Custom reranking after retrieval
      onAfterRecall: async (results, query) => {
        // Boost results tagged as 'important'
        return results.map(r => {
          if (r.entry.tags.includes('important')) {
            return { ...r, score: Math.min(r.score * 1.2, 1.0) };
          }
          return r;
        }).sort((a, b) => b.score - a.score);
      },

      // Log when memories are forgotten
      onForget: async (entry, reason) => {
        console.log(`Forgot: "${entry.content.slice(0, 50)}" (${reason})`);
      },
    },
  },
});
```

---

## Auto-Compaction

When conversations get long, the system automatically summarizes older messages and extracts key facts into long-term memory.

```typescript
memory: {
  compaction: {
    enabled: true,
    threshold: 50,    // Start compacting after 50 messages
    keepRecent: 10,   // Always keep the last 10 messages uncompacted
  },
}
```

**What happens during compaction:**

1. Thread has 60 messages → triggers compaction
2. The oldest 50 messages are sent to the LLM for summarization
3. The LLM produces:
   - A brief summary (2-3 sentences)
   - Key topics discussed
   - Important facts about the user
4. Key facts are stored as long-term memories (auto-tagged)
5. The compacted messages are replaced with the summary
6. Last 10 messages remain intact

**Result:** The agent's context window stays manageable while important information is preserved forever.

---

## Examples

### Personal AI Assistant

```typescript
// kernova.config.ts
export default defineConfig({
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    scoring: {
      similarityWeight: 0.45,
      recencyWeight: 0.20,
      frequencyWeight: 0.15,
      relevanceWeight: 0.20,
      recencyHalfLife: 672,  // 4 weeks
    },
    compaction: { enabled: true, threshold: 50 },
    autoRecall: true,
    autoSave: true,
  },
});
```

### Customer Support Bot

```typescript
// Shorter memory, faster decay, no auto-save
export default defineConfig({
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    scoring: {
      similarityWeight: 0.6,
      recencyWeight: 0.3,
      frequencyWeight: 0.0,   // Don't boost frequent memories
      relevanceWeight: 0.1,
      recencyHalfLife: 48,    // 2 days
    },
    autoRecall: true,
    autoSave: false,  // Support bot shouldn't save personal info
    contextMessages: 10,
  },
});
```

### Knowledge Base / RAG Agent

```typescript
// Heavy on similarity, light on recency (knowledge doesn't age)
export default defineConfig({
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    scoring: {
      similarityWeight: 0.7,
      recencyWeight: 0.05,
      frequencyWeight: 0.1,
      relevanceWeight: 0.15,
      recencyHalfLife: 8760,  // 1 year (knowledge is evergreen)
    },
    autoRecall: true,
    autoSave: false,
    defaultNamespace: 'knowledge-base',
  },
});
```

### Multi-tenant SaaS (Per-user Memory)

```typescript
// Use namespace = user ID to isolate memory per user
import { createMemoryEngine, PostgresMemoryAdapter } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: new PostgresMemoryAdapter({ url: process.env.DATABASE_URL }),
  embed,
});

// Store for specific user
await engine.store("Prefers email notifications", {
  namespace: `user:${userId}`,
  tags: ['preference'],
});

// Recall only that user's memories
const results = await engine.recall("notification preferences", {
  namespace: `user:${userId}`,
});
```

---

## Migrating from Memory v1

If you're already using the v1 memory system (`createMemoryProvider`), v2 is a drop-in upgrade. Just add `version: 2` to your config:

```diff
  memory: {
+   version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    autoRecall: true,
    autoSave: true,
  }
```

Your existing data in `agent_memories` remains accessible. The v2 engine creates a new table (`kernova_memories`) for new entries, and the v1 system remains as a fallback.

---

## API Reference

### `createMemoryEngine(config)`

Creates a new memory engine instance.

```typescript
import { createMemoryEngine } from '@kernova/core';

const engine = await createMemoryEngine({
  adapter: MemoryAdapter,     // Required: storage backend
  embed?: (text) => number[], // Optional: embedding function
  scoring?: ScoringConfig,    // Optional: retrieval weights
  compaction?: CompactionConfig,
  hooks?: MemoryHooks,
  defaultNamespace?: string,  // Default: 'default'
  workingMemoryTTL?: number,  // Default: 3600 (1 hour)
  debug?: boolean,
});
```

### `engine.store(content, options?)`

Store a memory.

```typescript
const id = await engine.store("User likes hiking", {
  layer: 'longterm',          // 'working' | 'session' | 'longterm'
  namespace: 'hobbies',
  tags: ['hobby', 'outdoor'],
  metadata: { source: 'conversation', threadId: 'abc' },
  relevance: 0.8,            // 0-1, how important
  confidence: 0.9,           // 0-1, how certain
  ttl: null,                 // seconds, or null for forever
});
```

### `engine.recall(query, options?)`

Retrieve relevant memories using scored retrieval.

```typescript
const results = await engine.recall("what hobbies does the user have?", {
  limit: 10,
  namespace: 'hobbies',      // Optional: filter by namespace
  layer: 'longterm',         // Optional: filter by layer
  tags: ['hobby'],           // Optional: filter by tags
  minScore: 0.3,             // Optional: minimum combined score
});

// results[0].entry.content → "User likes hiking"
// results[0].score → 0.85
// results[0].scoreBreakdown → { similarity, recency, frequency, relevance }
```

### `engine.forget(id)` / `engine.forgetWhere(filter)`

Delete memories.

```typescript
await engine.forget('mem_abc123');
await engine.forgetWhere({ namespace: 'old-data', olderThan: '2024-01-01' });
```

### `engine.working`

Working memory (ephemeral, in-process).

```typescript
engine.working.set(key, value, ttlSeconds?);
engine.working.get<T>(key);
engine.working.has(key);
engine.working.delete(key);
engine.working.getByPrefix<T>(prefix);
engine.working.size();
engine.working.clear();
```

### `defineMemoryConfig(config)`

Framework helper for typed memory configuration.

```typescript
import { defineMemoryConfig } from '@kernova/framework';

export default defineMemoryConfig({
  adapter: 'postgres',
  url: process.env.DATABASE_URL,
  embedding: { model: 'text-embedding-3-small' },
  scoring: { similarityWeight: 0.5 },
});
```
