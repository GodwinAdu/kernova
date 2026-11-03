---
title: "Context & Memory"
description: How Kernova assembles context for agents — five-layer memory, context computation, pluggable context engines, conversation threads, and RAG retrieval.
---

Agents are only as good as the context they receive. Without memory of who's asking, what they already know, and what's relevant to the current task, even the most capable model produces generic, unhelpful responses. Kernova solves this with a multi-layered memory system and a context computation pipeline that assembles the right information for every intent — automatically.

This guide covers the five tightly-coupled modules that power Kernova's context system:

- **MemoryEngine** — 5-layer persistent memory with FTS5 full-text search and vector embeddings
- **ContextEngine** — computes context from memory layers for each intent
- **ContextEngineManager** — pluggable architecture for custom context strategies
- **ConversationManager** — named threads with sliding window and summarization
- **RAGPipeline** — document ingestion and semantic retrieval

---

## Overview

### The Problem

Every time an agent receives a goal, it needs to know: who is asking (identity, preferences), what they already know (conversation history), and what's relevant (domain knowledge, documentation). Without these answers, agents hallucinate, repeat themselves, and ignore user context.

### Kernova's Answer: Context Is Computed, Not Stored

Kernova doesn't store a single "context blob" that grows forever. Instead, context is **assembled fresh** for each intent from multiple sources. This means context is always relevant, within token budgets, and reflects the latest memory state.

### The Pipeline

When an intent arrives, the context assembly pipeline runs automatically:

1. **Intent arrives** → ContextEngine queries MemoryEngine across all layers
2. **ComputedContext assembled** → Memories prioritized, deduplicated, token-counted
3. **RAG enrichment** → Relevant document chunks retrieved and appended
4. **Conversation context** → Thread summary and recent messages included
5. **Agent receives full context** → Everything packaged as `ComputedContext`

This happens transparently on every `kernel.submit()` call.


---

## Memory Engine (5 Layers)

The `MemoryEngine` is Kernova's persistent knowledge store. It organizes memories into five layers, each with a distinct purpose and lifecycle. This layered architecture ensures that short-lived task notes don't pollute long-term user preferences, and organizational knowledge doesn't expire with a session.

### Layer Architecture

| Layer | Purpose | TTL | Example |
|-------|---------|-----|---------|
| `working` | Current task scratchpad | Minutes | "Currently analyzing file X" |
| `session` | Current conversation context | Hours (3600s default) | "User asked about deployment" |
| `longterm` | Persistent user knowledge | Months/years | "User prefers TypeScript" |
| `organizational` | Shared team knowledge | Indefinite | "Company uses PostgreSQL" |
| `global` | System-wide facts | Indefinite | "The API base URL is..." |

**Layer priority** (highest to lowest): `working` → `session` → `longterm` → `organizational` → `global`. Higher-priority layers override lower ones during context assembly.

### Storing Memories

```typescript
await kernel.memoryEngine.store({
  content: 'User prefers concise responses under 200 words',
  layer: 'longterm',
  tags: ['preference', 'style'],
  owner: 'user-123',
});
```

Each memory entry includes:

- **content** — The information to remember (string)
- **layer** — Which memory layer to store in
- **tags** — Categorization labels for filtering
- **owner** — The user or entity this memory belongs to
- **relevance** — Relevance score (0.0–1.0, defaults to 1.0)
- **confidence** — Certainty score (0.0–1.0)


### Querying Memories

```typescript
const results = await kernel.memoryEngine.query({
  query: 'communication preferences',  // semantic search text
  layers: ['longterm', 'session'],      // which layers to search
  ownerId: 'user-123',                  // scope to this user
  limit: 10,                            // max results
});
// Returns MemoryEntry[] sorted by relevance
```

### Search Capabilities

The memory engine provides three search modes:

- **FTS5 Full-Text Search** — Keyword-based matching using SQLite's FTS5 engine. Fast and exact.
- **Vector Embeddings** — Semantic similarity via the ModelRouter. Finds conceptually related memories even when keywords don't match.
- **Hybrid Mode (default)** — Tries semantic search first, falls back to FTS5 if unavailable.

### Filtering Options

```typescript
const results = await kernel.memoryEngine.query({
  query: 'deployment preferences',
  layers: ['longterm', 'organizational'],  // Specific layers
  ownerId: 'user-123',                     // Scope to owner
  tags: ['infrastructure'],                // Must have tag
  minRelevance: 0.5,                       // Minimum relevance
  minConfidence: 0.7,                      // Minimum confidence
  limit: 20,                               // Max results
});
```

### Memory Decay

Memories don't stay equally relevant forever. Memory decay gradually reduces relevance scores of older memories, letting fresh information naturally surface above stale data.

```typescript
await kernel.memoryEngine.decay({
  factor: 0.95,           // Reduce relevance by 5% each cycle
  minRelevance: 0.1,      // Floor — never go below 10%
  olderThanMs: 86400000,  // Only decay memories older than 24h
});
```

Run decay on a schedule (daily or hourly) to keep your memory store fresh. Memories that are re-confirmed (re-stored with same content) reset their relevance to 1.0, naturally resisting decay.


---

## Context Computation

The `ContextEngine` is the bridge between raw memories and actionable agent context. For every intent, it queries the memory engine across all layers, prioritizes results, and packages them into a structured `ComputedContext`.

### Context Assembly Sequence

1. Query `working` memory for the owner (limit: 10)
2. Query `session` memory for the owner (limit: 20)
3. Query `longterm` memory with the goal as search text (limit: 10)
4. Query `organizational` memory with the goal (limit: 5)
5. Combine with priority: working > session > longterm > organizational
6. Estimate token count and trim if needed
7. Return `ComputedContext`


### The ComputedContext Interface

```typescript
interface ComputedContext {
  intentId: string;           // The intent this context was built for
  memories: MemoryEntry[];    // All retrieved memories, priority-ordered
  user: {
    userId: string;
    role: string;
    preferences: Record<string, unknown>;
  };
  permissions: string[];      // What the user is allowed to do
  policies: string[];         // Active policies that constrain behavior
  knowledge: MemoryEntry[];   // Organizational + global knowledge
  estimatedTokens: number;    // Total token estimate for budgeting
  computedAt: string;         // ISO timestamp of computation
}
```

### Automatic Context in Action

You don't need to call the context engine manually — it runs on every intent:

```typescript
const result = await kernel.submit({
  goal: 'How should I structure my database migrations?',
  owner: 'user-123',
});
// The agent received ComputedContext with:
// - Working: what the user is currently doing
// - Session: what they've discussed this session
// - Longterm: "User uses PostgreSQL", "User prefers Prisma"
// - Organizational: "Team uses migration-based schema management"
```

### Manual Context Assembly

For testing or custom pipelines, compute context directly:

```typescript
import { ContextEngine } from '@kernova/core';

const engine = new ContextEngine(kernel.memoryEngine);
const context = await engine.compute({
  intentId: 'intent-abc-123',
  goal: 'Optimize the database queries',
  ownerId: 'user-123',
});
console.log(`${context.memories.length} memories, ~${context.estimatedTokens} tokens`);
```

### Token Budget Management

The context engine is token-aware. It estimates token count and ensures context doesn't exceed model limits:

1. Lower-priority memories are dropped first (organizational before longterm)
2. Within a layer, lower-relevance memories are dropped first
3. The `estimatedTokens` field reflects the final assembled size

Agents never receive context that would blow their token window — the engine handles truncation intelligently.


---

## Pluggable Context Engines

The default context engine works for most applications. For specialized context assembly — external vector databases, domain-specific ranking, or proprietary knowledge systems — the `ContextEngineManager` provides a plugin architecture.

### ContextEngineManager

```typescript
// List available engines
const engines = kernel.contextEngines.listEngines();
// [{ id: 'default', name: 'Default Context Engine', isDefault: true }]

// Register a custom engine
kernel.contextEngines.register(myCustomEngine);

// Set as default
kernel.contextEngines.setDefault('my-engine-id');

// Assemble context manually
const result = await kernel.contextEngines.assemble(
  sessionId, messages, tokenBudget, { prompt: 'System prompt' }
);
```

### The ContextEnginePlugin Interface

```typescript
interface ContextEnginePlugin {
  info: ContextEngineInfo;
  bootstrap?(params): Promise<BootstrapResult>;     // One-time setup
  ingest?(params): Promise<IngestResult>;           // Ingest new content
  assemble(params): Promise<AssembleResult>;        // Build context (REQUIRED)
  compact(params): Promise<CompactResult>;          // Summarize/reduce (REQUIRED)
  maintain?(params): Promise<MaintenanceResult>;    // Periodic maintenance
  afterTurn?(params): Promise<void>;                // Post-turn state updates
  dispose?(): Promise<void>;                        // Cleanup on shutdown
}
```


### Building a Custom Context Engine

Here's a context engine that uses Pinecone as its vector store:

```typescript
import type { ContextEnginePlugin, AssembleParams, CompactParams } from '@kernova/core';

class PineconeContextEngine implements ContextEnginePlugin {
  info = { id: 'pinecone', name: 'Pinecone Context Engine', version: '1.0.0' };
  private pineconeIndex: any;

  async bootstrap(params) {
    const { Pinecone } = await import('@pinecone-database/pinecone');
    const client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    this.pineconeIndex = client.index('kernova-context');
    return { success: true };
  }

  async assemble(params: AssembleParams) {
    const { sessionId, messages, tokenBudget } = params;
    const lastMessage = messages[messages.length - 1];
    const queryEmbedding = await this.embed(lastMessage.content);

    const results = await this.pineconeIndex.query({
      vector: queryEmbedding, topK: 20, includeMetadata: true, filter: { sessionId },
    });

    const contextMessages = results.matches.map((m: any) => ({
      role: 'system' as const, content: m.metadata.content,
    }));
    return { messages: contextMessages, estimatedTokens: this.countTokens(contextMessages) };
  }

  async compact(params: CompactParams) {
    const { messages } = params;
    const summary = await this.summarize(messages);
    return { compacted: true, summary, tokensBefore: this.countTokens(messages), tokensAfter: 100 };
  }

  private async embed(text: string): Promise<number[]> { /* ... */ return []; }
  private countTokens(msgs: any[]): number { return msgs.reduce((s, m) => s + m.content.length / 4, 0); }
  private async summarize(msgs: any[]): Promise<string> { return 'Summary...'; }
}
```


### Registering the Custom Engine

```typescript
const pineconeEngine = new PineconeContextEngine();
kernel.contextEngines.register(pineconeEngine);
kernel.contextEngines.setDefault('pinecone');  // Optional: set as default for all intents
```

### When to Build a Custom Engine

Use the default engine unless you need external vector stores (Pinecone, Weaviate, Qdrant), domain-specific ranking, multi-source aggregation, compliance/audit requirements, or performance optimization with pre-computed context.

---

## Conversation Threads

The `ConversationManager` provides named threads with sliding-window management and LLM-powered summarization — conversational continuity without unbounded context growth.

Intents join a thread through `metadata.threadId` (`app.ask(goal, { threadId })` in the SDK). The agent then sees the thread's summary and recent turns, and each successful exchange is added to the thread. Intents without a `threadId` are independent: nothing is shared between them, which keeps different users' conversations apart.

### Creating and Using Threads

```typescript
// Create a new thread (or retrieve an existing one)
kernel.conversation.create('support-ticket-123');

// Add messages as the conversation progresses
await kernel.conversation.addMessageToThread(
  'support-ticket-123', 'user',
  'My application crashes on startup with an OOM error'
);
await kernel.conversation.addMessageToThread(
  'support-ticket-123', 'assistant',
  'Let me check the memory configuration. What\'s your heap size set to?'
);
await kernel.conversation.addMessageToThread(
  'support-ticket-123', 'user',
  'It\'s set to 512MB but we process large CSV files'
);
```


### Getting Thread Context

```typescript
const ctx = kernel.conversation.getThreadContext('support-ticket-123');
// ctx.summary  → LLM-generated summary of older messages
// ctx.messages → Recent messages within the sliding window
```

### Sliding Window Mechanics

- **Default window size:** 50 messages
- **When exceeded:** Oldest messages beyond the window are summarized using the LLM
- **Summary prepended:** Agents see the summary before the recent messages
- **Recent preserved in full:** Messages within the window are never truncated

A 200-message conversation still fits within token limits — the agent sees a summary of messages 1–150 and full content of messages 151–200.

```
┌─────────────────────────────────────┐
│  Summary of messages 1–150          │  ← LLM-generated summary
├─────────────────────────────────────┤
│  Message 151 (full text)            │
│  ...                                │  ← Sliding window (50 msgs)
│  Message 200 (full text)            │
└─────────────────────────────────────┘
```

### Thread Management

```typescript
// List active threads
const threads = kernel.conversation.listThreads();

// Archive (preserves data, removes from active context)
kernel.conversation.archive('support-ticket-123');

// Inspect a thread
const thread = kernel.conversation.retrieve('support-ticket-123');
console.log(thread?.messages.length);   // 24
console.log(thread?.summaries.length);  // 1 once older messages were summarized
console.log(thread?.status);            // 'active' | 'archived'
```

### Multi-Thread Patterns

Use separate threads for different concerns:

```typescript
kernel.conversation.create('user-123-main');             // Main conversation
kernel.conversation.create('user-123-deployment-task');   // Long-running task
kernel.conversation.create('user-123-code-review-pr-42'); // Specific sub-topic
```

This keeps context focused — when handling the deployment task, the agent only sees deployment-related history.


---

## RAG Pipeline

The `RAGPipeline` handles document ingestion, chunking, embedding, and retrieval — giving agents access to your documentation and knowledge bases without stuffing everything into the prompt.

### Ingesting Documents

```typescript
// Basic ingestion
await kernel.rag.ingest(documentContent, 'architecture.md', { category: 'docs' });

// With explicit chunking options
await kernel.rag.ingest(longDocument, 'api-reference.md', {
  category: 'api-docs',
  chunkStrategy: 'recursive',  // How to split the document
  chunkSize: 512,              // Tokens per chunk
  chunkOverlap: 50,            // Overlap between chunks
});
```

### Chunking Strategies

The RAG pipeline supports four chunking strategies:

| Strategy | Behavior | Best For |
|----------|----------|----------|
| `fixed` | Split every N tokens regardless of content | Uniform chunk sizes, simple docs |
| `recursive` | Split on headers, paragraphs, then sentences | **Default** — Markdown, technical docs |
| `sentence` | Split on sentence boundaries | Prose, articles, natural text |
| `paragraph` | Split on paragraph boundaries | Well-structured documents |

The `recursive` strategy (default) respects document structure — splits at headers first, then paragraphs, then sentences — producing semantically coherent chunks.

### Retrieving Context

```typescript
// Retrieve relevant chunks for a query
const chunks = await kernel.rag.retrieve('How does authentication work?', { topK: 5 });

for (const chunk of chunks) {
  console.log(`[${chunk.source}] (score: ${chunk.score.toFixed(2)}) ${chunk.content.slice(0, 80)}...`);
}
```


### Pre-Formatted Context

For convenience, get a formatted string ready to inject into prompts:

```typescript
const ragContext = await kernel.rag.getContext('authentication flow', { topK: 3 });
// Returns concatenated relevant chunks as a formatted string
```

### How RAG Enriches Agent Context

During `kernel.executeIntent()`, if documents have been ingested, the kernel automatically:

1. Uses the intent's goal as a retrieval query
2. Retrieves top-K relevant chunks (default: 5)
3. Appends chunks to the agent's context as supplementary knowledge

You ingest documents once, and every agent automatically benefits:

```typescript
// Ingest at startup
await kernel.rag.ingest(fs.readFileSync('./docs/deployment.md', 'utf-8'), 'deployment.md');
await kernel.rag.ingest(fs.readFileSync('./docs/architecture.md', 'utf-8'), 'architecture.md');

// Any related intent now gets relevant chunks in context
const result = await kernel.submit({ goal: 'How do I deploy to production?', owner: 'user-123' });
```

### RAG Pipeline Management

```typescript
const stats = kernel.rag.stats();
console.log(`Documents: ${stats.documents}, Chunks: ${stats.chunks}`);

// Remove a document by ID (ingest() returns it; listDocuments() lists them)
const outdated = kernel.rag.listDocuments().find(d => d.source === 'outdated-doc.md');
if (outdated) kernel.rag.remove(outdated.id);

kernel.rag.clear();  // Clear all documents
```

---

## How They All Work Together

Here's the complete flow when an intent arrives:

```
Intent arrives: "How do I deploy to ECS?"
    │
    ├─→ ContextEngine queries MemoryEngine
    │     ├─ working: "Currently looking at Dockerfile"
    │     ├─ session: "User asked about Docker earlier"
    │     ├─ longterm: "User uses AWS, prefers ECS over EKS"
    │     └─ organizational: "Company uses Terraform for infra"
    │
    ├─→ RAGPipeline retrieves relevant documents
    │     └─ "deployment.md: Section on ECS task definitions..."
    │
    ├─→ ConversationManager provides thread context
    │     └─ summary + recent messages
    │
    └─→ All assembled into ComputedContext → Agent
```


### End-to-End Example

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';
import fs from 'fs';

const kernel = new KernovaKernel({ ephemeral: false, dataDir: './kernova-data' });
await kernel.start();

// Ingest docs, store memories, set up thread
await kernel.rag.ingest(fs.readFileSync('./docs/deployment.md', 'utf-8'), 'deployment.md');
await kernel.memoryEngine.store({
  content: 'Company uses AWS ECS', layer: 'organizational', tags: ['infra'], owner: 'team',
});
await kernel.memoryEngine.store({
  content: 'User prefers TypeScript', layer: 'longterm', tags: ['pref'], owner: 'user-alice',
});
kernel.conversation.create('alice-deploy');
await kernel.conversation.addMessageToThread('alice-deploy', 'user', 'Help me deploy');

// Register agent and submit
const agent = defineAgent({
  name: 'deploy-assistant',
  description: 'Deployment help',
  capabilities: [{ id: 'deploy', name: 'Deploy', description: 'Deployment', confidence: 0.95 }],
  instructions: 'Help engineers deploy. Be concise.',
  tools: [],
});
kernel.agentRegistry.register(agent.definition, agent.executor);

const result = await kernel.submit({
  goal: 'How do I configure the ECS task definition?',
  owner: 'user-alice',
});
// Agent received: prefs + org knowledge + RAG docs + thread — all auto-assembled
```

---

## SDK Methods

The `@kernova/sdk` provides streamlined access to memory and context:

```typescript
import { readFileSync } from 'node:fs';
import { Kernova } from '@kernova/sdk';
const app = await Kernova.create();

// --- Memory ---
await app.remember('User likes TypeScript', 'longterm');
await app.remember('Currently on payment service', 'working');
const memories = await app.recall('programming preferences');

// --- Threads ---
const thread = app.thread('session-123');
await thread.addMessage('user', 'How do I set up auth?');
await thread.addMessage('assistant', 'I recommend JWT...');
const context = thread.getContext(); // { summary, messages }

// --- RAG (through the kernel) ---
const rag = app.getKernel().rag;
await rag.ingest(readFileSync('./docs/getting-started.md', 'utf8'), 'getting-started.md');
const results = await rag.retrieve('How do webhooks work?', { topK: 3 });

// --- Combined: memories and matching documents are added to every ask ---
await app.remember('Building a SaaS billing system', 'session');
await rag.ingest(billingDocs, 'billing.md', { category: 'domain' });
const { answer } = await app.ask('What about prorated charges?');
```

---

## Best Practices

### Memory Best Practices

- **Use `longterm` for persistent facts** — preferences, project info, learned patterns
- **Use `session` for current-task context** — auto-expires, no cleanup needed
- **Use `working` sparingly** — very short-lived, immediate task scratchpad only
- **Run `decay()` on a schedule** — daily/hourly keeps memory fresh
- **Use tags consistently** — establish a taxonomy (`preference`, `fact`, `task`, `finding`)
- **Store atomic facts** — one fact per entry, not paragraphs of mixed information

### Conversation Thread Best Practices

- **One topic per thread** — keeps context focused
- **Descriptive thread IDs** — `support-ticket-123` over `thread-1`
- **Archive completed threads** — preserve for potential memory extraction
- **Sub-threads for complex tasks** — deployment thread doesn't need code review messages


### RAG Best Practices

- **Ingest at startup** — load core documentation when the kernel starts
- **Use metadata** — categorize documents for filtered retrieval
- **Keep documents fresh** — re-ingest when docs change
- **Use `recursive` chunking for Markdown** — respects headers and structure

### Context Engine Best Practices

- **Trust the defaults** — the built-in engine handles most applications well
- **Monitor `estimatedTokens`** — if consistently near budget, be more selective with storage
- **Use custom engines for scale** — external vector DBs for thousands of documents or millions of memories

### Anti-Patterns

- ❌ Storing entire conversations as a single memory (store individual facts)
- ❌ Using `longterm` for ephemeral information (use `session` instead)
- ❌ Creating one thread per message (one thread per conversation)
- ❌ Ingesting huge files without chunking (let RAG handle splitting)
- ❌ Never running decay (old memories dilute relevance)

---

## Configuration

### Kernel Configuration

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({
  ephemeral: false,            // true = in-memory only, false = SQLite persistence
  dataDir: './kernova-data',   // Directory for SQLite database files
  environment: 'production',
});
await kernel.start();
```

When `ephemeral: false`, the kernel creates a SQLite database at `{dataDir}/kernova.db` with FTS5 virtual tables, vector embedding storage, and automatic schema migrations. When `ephemeral: true`, everything lives in memory and is lost on restart.

### Defaults Reference

| Component | Setting | Default |
|-----------|---------|---------|
| Memory | Session TTL | 3600s (1 hour) |
| Memory | Working TTL | 300s (5 minutes) |
| Memory | Decay factor | 0.95 |
| Memory | Min relevance | 0.1 |
| Memory | Search limit | 20 |
| Conversations | Window size | 50 messages |
| RAG | Chunk strategy | `recursive` |
| RAG | Chunk size | 512 tokens |
| RAG | Chunk overlap | 50 tokens |
| RAG | Top-K retrieval | 5 |

### Environment-Specific Configuration

```typescript
// Development — fast iteration, no persistence
const devKernel = new KernovaKernel({ ephemeral: true, environment: 'development' });

// Production — full persistence
const prodKernel = new KernovaKernel({
  ephemeral: false, dataDir: '/var/lib/kernova/data', environment: 'production',
});

// Testing — isolated, reproducible
const testKernel = new KernovaKernel({ ephemeral: true, environment: 'development' });
```

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Memories not in context | Verify `owner` matches intent owner; check relevance scores (decayed memories may be filtered) |
| RAG returning irrelevant results | Try `recursive` chunking; reduce chunk size; verify ingestion via `kernel.rag.stats()` |
| Summaries seem off | Summarization quality depends on LLM; check window size isn't too small |
| Context exceeding budget | Store fewer working/session memories; reduce RAG `topK`; use specific tags |
| Vector search not working | Ensure embedding model is configured in ModelRouter; set `ephemeral: false` |

---

## Next Steps

- [Building Agents](/guides/agents) — How agents use the context they receive
- [Intelligence Modules](/guides/intelligence) — Planning, reflection, and other cognitive capabilities
- [Multi-Agent Systems](/guides/multi-agent) — How context flows between coordinating agents
- [Configuration](/guides/configuration) — Full kernel configuration reference
- [Security](/guides/security) — Memory access control and data isolation
