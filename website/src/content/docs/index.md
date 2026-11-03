---
title: Kernova
description: The Intelligent Systems Runtime
sidebar:
  hidden: true
---

# Kernova — The Intelligent Systems Runtime

**Stop rebuilding AI infrastructure from scratch.** Kernova gives you everything you need to build intelligent applications — memory, agents, tools, events, auth, and orchestration — in one cohesive runtime.

## The Problem

Every team building AI-powered applications ends up rebuilding the same things:

- How do I give my AI memory?
- How do I let it call functions?
- How do I track what it did?
- How do I control costs?
- How do I coordinate multiple AI agents?
- How do I secure it for production?

Kernova solves all of these with one `npm install`.

## See It In Action

```typescript
import { Kernova } from '@kernova/sdk';

// Start in one line
const app = await Kernova.create();

// Give it personality
app.agent('assistant', {
  instructions: 'You are a helpful coding assistant. Be concise.',
});

// Give it abilities
app.tool('search_docs', {
  description: 'Search the documentation for relevant information',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  execute: async ({ query }) => searchMyDocs(query),
});

// Use it
const { answer } = await app.ask('How do I set up authentication in Express?');
console.log(answer);

// It remembers (persists across restarts)
await app.remember('User is building an Express app', 'longterm');

// Clean up
await app.close();
```

That's a working AI application with memory, tool use, and persistence. **5 minutes, not 5 weeks.**

## Why Kernova?

| Without Kernova | With Kernova |
|---------------|-----------|
| Pick an LLM SDK, build a wrapper | `app.agent('name', { instructions })` |
| Build a memory system from scratch | `app.remember()` / `app.recall()` — built-in, persistent |
| Implement function calling manually | `app.tool()` — agents use tools automatically |
| Build auth, rate limiting, budgets | Built-in: API keys, roles, token limits |
| No observability into AI decisions | Every action emits events, viewable in Studio |
| Locked to one model provider | 26 providers, including Azure OpenAI, AWS Bedrock, and Vertex AI, switch with zero code changes |
| Months of infrastructure work | `npm install @kernova/sdk` — done in minutes |

## Get Started

```bash
npm install @kernova/sdk
```

Then follow the [Getting Started guide →](/getting-started/introduction/)

## How It Compares

```
Node.js     = Runtime for JavaScript
Docker      = Runtime for Containers  
Kubernetes  = Runtime for Services
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Kernova       = Runtime for Intelligent Systems
```

Just as you don't write your own HTTP server to build a web app, you shouldn't write your own AI infrastructure to build an intelligent app.
