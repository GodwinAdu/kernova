---
title: Memory
description: Understand the five-layer memory system — how Nexus remembers.
---

# Memory

Most AI applications have no memory. Each request starts from zero. Nexus gives your agents a **five-layer persistent memory system** that works like human memory — with short-term context, long-term knowledge, and shared organizational information.

## Why Five Layers?

Because not all knowledge is the same:

- "The user just asked about login bugs" → **Working memory** (forget in 5 minutes)
- "We've been discussing the auth system" → **Session memory** (forget after this conversation)
- "The user prefers TypeScript" → **Long-term memory** (remember for months)
- "Our company uses PostgreSQL for all projects" → **Organizational memory** (everyone knows this)
- "TypeScript is a programming language" → **Global knowledge** (universal facts)

Mixing these into one database creates a mess. Separating them lets you control privacy, relevance, and lifetime independently.

## The Five Layers

| Layer | Scope | Lifetime | Example | Access |
|-------|-------|----------|---------|--------|
| `working` | Current task | Minutes | "Analyzing the users table" | Only the current agent |
| `session` | Current conversation | Hours | "User asked 3 questions about auth" | Agents in this session |
| `longterm` | Per user/project | Months–years | "User prefers concise answers" | User's agents |
| `organizational` | Company-wide | Years | "All APIs must return JSON" | All team members |
| `global` | Universal | Permanent | "HTTP 200 means success" | Everyone |

## Storing Memories

### SDK (simple)

```typescript
// Store with layer and optional tags
await app.remember('User prefers dark mode', 'longterm', ['preference', 'ui']);
await app.remember('Current sprint goal: ship auth feature', 'session');
await app.remember('Company policy: all errors must be logged', 'organizational');
```

### Core (full control)

```typescript
await kernel.memoryEngine.store({
  content: 'Q2 revenue was $4.2M, up 23% from Q1',
  layer: 'organizational',
  memoryType: 'fact',
  tags: ['revenue', 'q2', '2026', 'financial'],
  confidence: 0.95,
  owner: 'org_123',
});
```

## Searching Memories

### Text search (keyword)

```typescript
const results = await app.recall('dark mode preference');
// Finds: "User prefers dark mode"
```

### Semantic search (meaning)

When you have an embedding provider configured, Nexus also searches by meaning:

```typescript
const results = await app.recall('UI theme choice');
// Finds: "User prefers dark mode" — even though "theme" doesn't appear in the text
```

This uses vector embeddings (cosine similarity) under the hood.

### Filtered search

```typescript
const results = await kernel.memoryEngine.query({
  query: 'authentication',      // Text to search for
  layers: ['longterm', 'organizational'], // Which layers
  ownerId: 'user_123',         // Whose memories
  minConfidence: 0.7,          // Minimum confidence
  limit: 10,                   // Max results
});
```

## How Memory Becomes Context

When an agent handles an intent, Nexus automatically assembles relevant memories into the context:

```
User asks: "How should I handle auth tokens?"

Context assembled:
  Working: (empty — new task)
  Session: "User is building a REST API"
  Long-term: "User prefers TypeScript", "User's project uses Express"
  Organizational: "Company standard: JWT with 1-hour expiry"
  Global: (not queried for this intent)
```

This context is passed to the LLM alongside the user's question. The agent doesn't need to know about memory — it just has the right context automatically.

**Important:** Context is computed fresh for each intent. It's never stored as a giant blob. This keeps prompts small and relevant.

## Memory Decay

Memories that aren't accessed lose relevance over time:

```typescript
// Apply decay: reduce relevance by 5% for memories not accessed in 24 hours
await kernel.memoryEngine.decay({
  factor: 0.95,          // Multiply relevance by this
  minRelevance: 0.1,     // Never go below this
  olderThanMs: 86400000, // Only decay if unused for 24h
});
```

**Why decay?** Without it, old irrelevant memories would pollute every context. Decay ensures that frequently-accessed memories stay strong while forgotten ones fade — just like human memory.

## Memory Persistence

All memories persist to SQLite. They survive:
- Process restarts
- Server reboots
- Application redeployments

The database lives in `./nexus-data/nexus.db`. Back it up like any other database.

## In Agent Code

Agents can remember and recall directly:

```typescript
async execute(intent, context, tools) {
  // Recall relevant memories
  const memories = await tools.recall('user preferences');
  
  // Do work using the LLM
  const response = await tools.complete(`
    Based on: ${memories.join(', ')}
    Answer: ${intent.goal}
  `);
  
  // Store new learning
  await tools.remember(`User asked about: ${intent.goal}`, 'session');
  
  return { success: true, summary: response, ... };
}
```

## Best Practices

1. **Be specific when storing** — "User prefers TypeScript" is better than "TypeScript"
2. **Use appropriate layers** — Don't put temporary info in long-term memory
3. **Tag memories** — Makes filtered retrieval much faster
4. **Run decay periodically** — Call `decay()` daily or on a cron schedule
5. **Set confidence** — If you're not sure about something, store it with lower confidence
