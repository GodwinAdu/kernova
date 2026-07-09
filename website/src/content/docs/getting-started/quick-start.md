---
title: Quick Start
description: Build a working intelligent application in 5 minutes.
---

# Quick Start

Let's build a real application — a coding assistant that can search documentation, remember your preferences, and explain code.

## The Goal

By the end of this page, you'll have an AI assistant that:
1. Answers questions using an LLM
2. Searches your docs when it needs information (tool)
3. Remembers things you tell it (persistent memory)
4. Streams responses in real-time

## Step 1: Create the app

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
```

This starts the Kernova runtime with:
- A connection to your configured LLM provider
- Persistent SQLite storage for memory and events
- Event tracking for every action

## Step 2: Define an agent

```typescript
app.agent('coding-assistant', {
  instructions: `You are a senior software engineer helping a developer.
You have access to documentation search. Use it when asked about specific APIs.
Be concise. Show code examples when helpful.
If you're not sure about something, say so.`,
});
```

**Why this matters:** The instructions shape how the AI behaves. Unlike raw API calls, this is declarative — you describe *what* the agent is, not *how* it should respond to each message.

## Step 3: Give it a tool

```typescript
app.tool('search_docs', {
  description: 'Search the project documentation for relevant information',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in the docs',
      },
    },
    required: ['query'],
  },
  execute: async ({ query }) => {
    // In a real app, this would search your actual docs
    // For now, return a mock result
    return {
      results: [
        { title: 'Authentication Guide', snippet: `Configure auth using JWT tokens...` },
        { title: 'API Reference', snippet: `The ${query} endpoint accepts POST requests...` },
      ],
    };
  },
});
```

**How tool calling works:**
1. You submit a question
2. The LLM reads the tool description and decides: "I should search for this"
3. Kernova executes your `execute` function
4. The result is sent back to the LLM
5. The LLM writes a final answer incorporating the search results

You don't need to write any of the routing logic. The LLM decides when to use tools based on the descriptions you provide.

## Step 4: Add memory

```typescript
// Store something the agent should remember
await app.remember(
  'This project uses Express.js with TypeScript and PostgreSQL',
  'longterm'
);

await app.remember(
  'The user prefers functional programming patterns over OOP',
  'longterm'
);
```

These memories persist to disk. Even if you restart your application, the agent remembers. They're automatically included in the context when relevant.

## Step 5: Ask questions

```typescript
const result = await app.ask('How should I structure my API routes?');
console.log(result.answer);
// The agent knows you use Express + TypeScript + prefer functional patterns
// It tailors its advice accordingly
```

```typescript
const result2 = await app.ask('How do I authenticate users?');
console.log(result2.answer);
// The agent searches docs (tool) + uses your project context (memory)
```

## Step 6: Stream responses

For a better UX, stream tokens as they arrive:

```typescript
process.stdout.write('Assistant: ');
for await (const token of app.stream('Explain async/await in TypeScript')) {
  process.stdout.write(token);
}
console.log(); // newline at end
```

## Complete Example

Here's the full working application:

```typescript
import { Kernova } from '@kernova/sdk';

async function main() {
  const app = await Kernova.create();

  // Define the agent
  app.agent('coding-assistant', {
    instructions: `You are a senior software engineer. Be concise and show code.`,
  });

  // Add a tool
  app.tool('search_docs', {
    description: 'Search project documentation',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async ({ query }) => ({ results: [`Documentation about ${query}...`] }),
  });

  // Add memory
  await app.remember('Project uses TypeScript and Express', 'longterm');

  // Ask a question
  const { answer, durationMs } = await app.ask('How do I add middleware in Express?');
  console.log(answer);
  console.log(`(${durationMs}ms)`);

  await app.close();
}

main();
```

Run: `npx tsx app.ts`

## What happened behind the scenes?

When you called `app.ask()`:

1. **Intent created** — Your question became a structured Intent object
2. **Permission check** — Runtime verified the caller has `intent:submit` permission
3. **Budget check** — Runtime verified token budget isn't exceeded
4. **Agent selected** — The kernel scored all agents and picked `coding-assistant`
5. **Context computed** — Relevant memories assembled (your project uses TypeScript + Express)
6. **LLM called** — Agent's instructions + context + your question sent to the model
7. **Tool called** — LLM decided to search docs, runtime executed the tool
8. **Result returned** — Final answer with evidence trail
9. **Events emitted** — `intent.created`, `intent.executing`, `intent.completed`
10. **All persisted** — Events and any new memories saved to SQLite

You get all of this with `app.ask()`. No boilerplate.

## Next Steps

- [Build a custom agent →](/getting-started/first-agent/) — Add your own logic
- [Learn about memory →](/concepts/memory/) — Understand the five layers
- [Deploy to production →](/guides/deployment/) — Docker and Node.js deployment
