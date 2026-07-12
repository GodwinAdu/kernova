---
title: "Step 5: Add Memory"
description: "Give your agent persistent memory so it remembers users across sessions."
---

# Step 5: Add Memory

Right now, if you close the browser and come back, the agent has no memory of your previous conversation. Let's fix that.

## How Memory Works

The framework supports three memory types:

| Type | Behavior | Use Case |
|------|----------|----------|
| `none` | No memory, every request is independent | Stateless tools, one-shot queries |
| `conversational` | Remembers within a thread, expires after TTL | Chat bots, support agents |
| `persistent` | Long-term storage, searchable | User preferences, learned facts |

We already set `memory: { type: 'conversational', ttl: '7d' }` on our agent. This means:
- Messages within a conversation thread are remembered
- After 7 days of inactivity, the memory is cleared

## Define a Memory Schema

The `memory/` directory holds structured memory schemas. Open `memory/conversations.ts`:

```typescript
// memory/conversations.ts
import { defineMemory } from '@kernova/framework';

export default defineMemory({
  name: 'conversations',
  schema: {
    summary: { type: 'text', indexed: true },
    userId: { type: 'text', indexed: true, required: true },
    sentiment: { type: 'text' },
    topics: { type: 'json' },
    resolved: { type: 'boolean' },
  },
  ttl: '30d',
  autoSummarize: true,
});
```

This schema tells Kernova what to remember about each conversation:
- **summary** — A text summary of what was discussed
- **userId** — Who was talking (for per-user memory)
- **sentiment** — Was the user happy, frustrated, etc.
- **topics** — What subjects came up (as JSON array)
- **resolved** — Was their issue resolved?

## Using Memory from the Frontend

You can also interact with memory from your React components using the `useMemory` hook:

```tsx
'use client';
import { useMemory } from '@kernova/framework/react';

export default function PreviousChatsPage() {
  const { entries, search, isLoading } = useMemory('conversations');
  const [query, setQuery] = useState('');

  const handleSearch = () => {
    search(query, 10); // search for up to 10 results
  };

  return (
    <div>
      <h2>Previous Conversations</h2>
      
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search past conversations..."
      />
      <button onClick={handleSearch} disabled={isLoading}>Search</button>

      {entries.map((entry) => (
        <div key={entry.id}>
          <p>{entry.content}</p>
          <small>{entry.createdAt}</small>
        </div>
      ))}
    </div>
  );
}
```

## Test Memory Persistence

1. Open [http://localhost:3000/chat](http://localhost:3000/chat)
2. Have a conversation: "What are the pricing plans?"
3. Note the agent's response
4. Send another message in the same thread: "Which one do you recommend for a team of 5?"

The agent should remember you were asking about pricing and give a recommendation based on the context — it didn't need you to repeat yourself.

## What You Learned

- Memory is configured per-agent with the `memory` field
- `conversational` memory auto-tracks the conversation thread
- `defineMemory` creates structured schemas for stored knowledge
- `useMemory` hook lets the frontend read/search memory
- The TTL (`7d`, `30d`, etc.) controls how long memories persist

---

[Continue to Step 6: Deploy to Production →](/framework/tutorial/06-deploy)
