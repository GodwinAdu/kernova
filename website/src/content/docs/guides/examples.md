---
title: Examples
description: Common patterns and recipes for building with Kernova.
---

# Examples

## Simple Q&A Bot

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are helpful and concise.' });

const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "Paris"
await app.close();
```

## Agent with Web Search

```typescript
const app = await Kernova.create();

app.agent('researcher', {
  instructions: 'You research topics. Always use the search tool for current info.',
});

app.tool('search', {
  description: 'Search the web for current information',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async ({ query }) => {
    const res = await fetch(`https://api.search.com?q=${query}`);
    return res.json();
  },
});

const { answer } = await app.ask('What happened in tech news today?');
```

## Multi-Agent Pipeline

```typescript
const app = await Kernova.create();

app.agent('researcher', { instructions: 'Research the given topic thoroughly.' });
app.agent('writer', { instructions: 'Write clear, engaging articles.' });
app.agent('editor', {
  instructions: 'Coordinate research and writing.',
  async execute(intent, ctx, tools) {
    const research = await tools.delegate('researcher', `Research: ${intent.goal}`);
    const article = await tools.delegate('writer', `Write about: ${research.response}`);
    return { success: true, summary: article.response, evidence: { sources: [], confidence: 0.9 }, durationMs: 0 };
  },
});

const { answer } = await app.ask('The future of renewable energy');
```

## Persistent Memory Assistant

```typescript
const app = await Kernova.create(); // Memory persists in Kernova-data/

// First run — store preferences
await app.remember('User prefers Python over JavaScript', 'longterm');
await app.remember('User works at a startup', 'longterm');

// Later (even after restart) — context automatically includes memories
const { answer } = await app.ask('Suggest a tech stack for my next project');
// Response considers the user's Python preference and startup context
```

## Code Review Agent

```typescript
app.agent('reviewer', {
  instructions: `Review code for:
- Security vulnerabilities
- Performance issues
- Logic errors
- Style improvements
Format as a numbered list.`,
});

const { answer } = await app.ask(`
Review this code:
function login(user, pass) {
  const query = "SELECT * FROM users WHERE name='" + user + "'";
  return db.exec(query);
}
`);
// Will identify SQL injection, suggest parameterized queries, etc.
```

## Budget-Controlled Agent

```typescript
const app = await Kernova.create();

// Limit spending
const kernel = app.getKernel();
kernel.budget.setGlobalBudget({
  maxTokens: 50_000,
  maxCostUsd: 1.00,
  requestsPerMinute: 10,
});

app.agent('assistant', { instructions: 'Be concise to save tokens.' });

const { answer } = await app.ask('Summarize quantum computing in one paragraph');
console.log('Usage:', kernel.budget.getGlobalUsage());
```

## Real-Time Event Monitoring

```typescript
const kernel = app.getKernel();

// Subscribe to all events
kernel.events.subscribe(['*'], (event) => {
  console.log(`[${event.timestamp}] ${event.eventType}`, event.data);
});

// Submit intent — events stream in real-time
await app.ask('Hello');
// Output:
// [2026-07-08T20:15:36.853Z] intent.created { intentId: '...' }
// [2026-07-08T20:15:36.854Z] intent.planning { ... }
// [2026-07-08T20:15:36.855Z] intent.executing { ... }
// [2026-07-08T20:15:37.123Z] intent.completed { ... }
```

## Local Model (Ollama)

```typescript
import { Kernova } from '@kernova/sdk';
import { createProvider } from '@kernova/core';

// No API key needed — runs locally
const app = await Kernova.create();
app.agent('local', { instructions: 'You run entirely on local hardware.' });

const { answer } = await app.ask('Explain how transformers work');
```

Requires Ollama running: `ollama serve && ollama pull llama3.1`
