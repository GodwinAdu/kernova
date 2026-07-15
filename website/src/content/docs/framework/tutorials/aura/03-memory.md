---
title: Memory System
description: Give your AI persistent memory — PostgreSQL with vector search, conversation history, and scored retrieval.
---

## What You'll Build

A three-layer memory system that turns Aura from a stateless chatbot into a personal AI that knows you. By the end of this part, Aura will remember facts across sessions, recall relevant context automatically, and compress old conversations without losing meaning.

## Why Memory Matters

Without memory, every conversation starts from zero. The user has to re-explain who they are, what they're working on, and what they need. That's not a personal AI — that's a search engine.

With memory:
- "I started a new job" → remembered forever
- "What did I say about my goals?" → instantly recalled
- Two weeks later: "How's the new job going?" → proactive

## Three-Layer Architecture

```
┌─────────────────────────────────────┐
│  WORKING MEMORY (contextMessages)    │  Last 20 messages
│  The current conversation thread     │  in-memory, fast
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼──────────────────┐
│  SESSION MEMORY (compaction)         │  Summarized older
│  Compressed conversation history     │  messages from thread
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼──────────────────┐
│  LONG-TERM MEMORY (vectorSearch)     │  Saved facts, notes,
│  PostgreSQL + pgvector embeddings    │  scored retrieval
└─────────────────────────────────────┘
```

**Working memory** is the last 20 messages — cheap, fast, always available. **Session memory** kicks in when conversations get long (50+ messages) — older messages get compressed into summaries. **Long-term memory** is the permanent store — facts, preferences, and goals saved via tools and auto-detection.

## Configure Memory v2

This is already in your `kernova.config.ts`, but let's understand each setting:

```typescript
memory: {
  version: 2,
  provider: 'postgres',
  url: process.env.DATABASE_URL,

  embedding: {
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  vectorSearch: true,

  scoring: {
    similarityWeight: 0.45,   // How relevant is this memory to the current query?
    recencyWeight: 0.25,      // How recently was this memory created/accessed?
    frequencyWeight: 0.15,    // How often has this memory been recalled?
    relevanceWeight: 0.15,    // Base importance score (set when saving)
    recencyHalfLife: 336,     // Hours until recency score halves (2 weeks)
  },

  compaction: {
    enabled: true,
    threshold: 50,    // Compress after 50 messages
    keepRecent: 10,   // Always keep last 10 messages intact
  },

  autoRecall: true,      // Inject relevant memories into every prompt
  autoSave: true,        // Detect personal info and save automatically
  contextMessages: 20,   // Include last 20 messages as working memory
},
```

### Scoring Weights Explained

The scoring algorithm determines which memories appear in the prompt. Every memory gets a composite score:

```
score = (similarity × 0.45) + (recency × 0.25) + (frequency × 0.15) + (relevance × 0.15)
```

**Example:** User says "Help me with my budget"

| Memory | Similarity | Recency | Frequency | Relevance | Final |
|--------|-----------|---------|-----------|-----------|-------|
| "User earns $5000/month" | 0.82 | 0.90 | 0.20 | 0.80 | **0.72** |
| "User's name is Marcus" | 0.15 | 0.95 | 0.90 | 0.70 | **0.52** |
| "User likes spicy food" | 0.05 | 0.40 | 0.10 | 0.30 | **0.16** |

The budget-related memory wins because similarity (what the user is asking about) has the highest weight.

### Why 336-Hour Half-Life?

For a support bot, you'd use a short half-life (24h) — conversations are ephemeral. For a personal AI, facts like "user's name" or "user works at Google" stay relevant for months. A 2-week half-life means recent memories get a boost, but older ones don't disappear.

## Define the Memory Schema

Create `memory/conversations.ts`:

```typescript
import { defineMemory } from '@kernova/framework';

export default defineMemory({
  name: 'life-memory',
  schema: {
    content: { type: 'text', indexed: true },
    category: { type: 'text', indexed: true },
    userId: { type: 'text', indexed: true, required: true },
    tags: { type: 'json' },
    sentiment: { type: 'text' },
    importance: { type: 'text' },
    domain: { type: 'text', indexed: true },
  },
  ttl: '365d',
  autoSummarize: true,
});
```

**Why this schema?** The `category` and `domain` fields let you filter memories by type (personal, finance, health). The `tags` field enables the agents to store structured metadata. The `importance` field feeds into the relevance score.

## How Auto-Recall Works

Every time the user sends a message, Kernova:

1. Embeds the message using `text-embedding-3-small`
2. Queries PostgreSQL's pgvector index for similar memories
3. Scores each result using the weighted algorithm
4. Takes the top 5-10 memories
5. Injects them into the prompt as "THINGS I REMEMBER ABOUT YOU"

The agent sees this before its instructions, so it can reference memories naturally.

## How Auto-Save Works

When `autoSave: true`, Kernova watches for patterns in the agent's responses that indicate personal information was shared. It detects:

- Names, locations, jobs
- Stated preferences
- Goals and plans
- Relationships and contacts

This happens in addition to explicit `save-note` calls from the agent.

## Test It

```bash
kernova dev
```

Chat with Aura:
```
You:  Hey, I'm Sarah and I work at Stripe as a PM
Aura: Nice to meet you, Sarah! Product management at Stripe —
      that's exciting. What are you working on these days?
```

Now close the browser entirely. Open it again:
```
You:  Hey
Aura: Hey Sarah! How's it going at Stripe?
```

Check the terminal logs — you'll see the memory recall:
```
[memory] Recalled 3 memories (score: 0.78, 0.65, 0.51)
  → "User's name is Sarah"
  → "User works at Stripe as a Product Manager"
  → "User is interested in AI products"
```

## Exercise

1. Tell Aura 5 facts about yourself over multiple messages
2. Close and reopen the chat — verify all facts are recalled
3. Ask about something specific you mentioned before — see if the right memory surfaces
4. Try adjusting `similarityWeight` to 0.7 and `recencyWeight` to 0.1 — notice how recall changes
5. Check your PostgreSQL database — look at the `memories` table to see what's stored

Next: we'll build the core tools that give Aura actual capabilities.
