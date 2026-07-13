---
title: "Step 3: Add Persistent Memory"
description: "Make your assistant remember across sessions — names, preferences, and context."
---

# Step 3: Add Persistent Memory

The most important feature that separates a useful assistant from a toy chatbot: **memory that persists**.

## How Memory Works in Kernova

There are three memory types:

| Type | What It Does | Use Case |
|------|-------------|----------|
| `none` | Forgets everything after each request | Stateless tools |
| `conversational` | Remembers within a thread, forgets after TTL | Support chats |
| `persistent` | Stores long-term knowledge, searchable | Personal assistants |

We're using `persistent` — the strongest level. Here's what happens:

1. Nova has a conversation with you
2. The kernel's memory engine detects important information (names, preferences, facts)
3. It stores them in SQLite with full-text search
4. Next time you chat, the context engine retrieves relevant memories
5. These memories are included in the LLM prompt, so Nova "remembers"

## Define the Memory Schema

The memory schema tells Kernova **what structure** to use when storing memories. Open `memory/conversations.ts` and replace it:

```typescript
import { defineMemory } from '@kernova/framework';

export default defineMemory({
  name: 'personal',
  schema: {
    // What the user told us (name, job, preferences)
    content: { type: 'text', indexed: true },
    
    // Category for easier retrieval
    category: { type: 'text', indexed: true },
    
    // How important is this memory (1-10)
    importance: { type: 'number' },
    
    // Who this memory is about
    userId: { type: 'text', indexed: true },
  },
  ttl: '90d',           // Memories expire after 90 days
  autoSummarize: true,  // Older memories get summarized to save space
});
```

### What each field means:

- **`content`** — The actual memory text ("User's name is Alex")
- **`category`** — Tags like "preference", "personal", "work" for filtering
- **`importance`** — Higher importance memories are retrieved first
- **`userId`** — Associate memories with specific users (for multi-user apps)
- **`indexed: true`** — Makes this field searchable

### What `autoSummarize` does:

When you have hundreds of memories, they'd consume too many tokens. `autoSummarize: true` tells the engine to periodically condense older memories into summaries:

```
Original (50 memories):
- User likes TypeScript
- User works at Acme Corp
- User asked about React on Monday
- User asked about Next.js on Tuesday
- User prefers dark mode
...

Summarized (1 memory):
"Alex works at Acme Corp as a developer. Prefers TypeScript, React, Next.js.
Uses dark mode. Often asks about web development."
```

This keeps context relevant without using too many tokens.

## Test Memory Persistence

Start the dev server:

```bash
kernova dev
```

Now have this conversation:

**You:** "My name is Alex and I work at Acme Corp as a frontend developer"

**Nova:** [responds acknowledging your info]

**You:** "I prefer React over Vue, and TypeScript over JavaScript"

**Nova:** [responds acknowledging preferences]

Now **stop the server** (Ctrl+C) and **restart it**:

```bash
kernova dev
```

Open the chat again and ask:

**You:** "What do you remember about me?"

If memory is working, Nova should recall your name, job, and preferences — even though the server was restarted.

## Where Memories Are Stored

Look in your project — there's now a `kernova-data/` directory:

```
kernova-data/
└── kernova.db          ← SQLite database
```

This file contains your events, memories, and conversation history. It persists across restarts.

**For production:** When deployed to Render, this data lives in the container's filesystem. For truly persistent data across deploys, you'd eventually want to connect an external database — but for development and basic production, SQLite works great.

## How the Agent Uses Memory

You don't need to write code to "read" memories. The framework does it automatically:

1. User sends a message
2. The **Context Engine** activates
3. It searches memory for anything relevant to the user's message
4. Relevant memories are injected into the LLM prompt
5. The LLM sees them and uses them naturally in its response

This is why Nova can say "Since you prefer TypeScript..." without you telling it again — the memory was retrieved and added to context.

## Memory vs Chat History

These are different things:

| | Chat History | Memory |
|---|---|---|
| **Scope** | Current conversation | All conversations, forever |
| **Content** | Every message verbatim | Extracted facts and preferences |
| **Size** | Can get very long | Summarized and compact |
| **Retrieval** | All included (sliding window) | Semantic search (most relevant) |

Chat history is "what was said in this session." Memory is "what the agent knows about you."

---

[Continue to Step 4: Customize the Chat UI →](/framework/tutorials/assistant/05-chat-ui)
