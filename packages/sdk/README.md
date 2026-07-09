# @kernova/sdk

The **simplest way to build intelligent applications** with Kernova.

5 lines from zero to a working AI app with memory, tools, and multi-agent coordination.

## Installation

```bash
npm install @kernova/sdk
```

## Quick Start

```typescript
import { Nexus } from '@kernova/sdk';

const app = await Nexus.create();
app.agent('assistant', { instructions: 'You are helpful and concise.' });

const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "Paris"

await app.close();
```

Set your API key: `export OPENAI_API_KEY=sk-...`

## Features

### Define Agents (1 line)

```typescript
app.agent('writer', {
  instructions: 'You write clear, engaging technical content.',
});
```

### Add Tools (agents use them automatically)

```typescript
app.tool('search', {
  description: 'Search the web for information',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async ({ query }) => fetchSearchResults(query),
});

// Agent decides when to call search — no manual wiring needed
const { answer } = await app.ask('What happened in tech news today?');
```

### Persistent Memory (survives restarts)

```typescript
await app.remember('User prefers TypeScript over JavaScript', 'longterm');
await app.remember('Project uses PostgreSQL', 'longterm');

// Later — agent automatically has this context
const { answer } = await app.ask('Suggest a tech stack for my API');
// → Recommends TypeScript + PostgreSQL
```

### Search Memories

```typescript
const memories = await app.recall('programming preferences');
```

### Stream Responses (token by token)

```typescript
for await (const token of app.stream('Write a haiku about coding')) {
  process.stdout.write(token);
}
```

### Multi-Agent Delegation

```typescript
app.agent('researcher', { instructions: 'Research topics thoroughly.' });
app.agent('editor', {
  instructions: 'Coordinate research and writing.',
  async execute(intent, context, tools) {
    const research = await tools.delegate('researcher', intent.goal);
    const article = await tools.complete(`Write about: ${research.response}`);
    return { success: true, summary: article, evidence: { sources: [], confidence: 0.9 }, durationMs: 0 };
  },
});
```

### Budget Control

```typescript
const kernel = app.getKernel();
kernel.budget.setGlobalBudget({ maxTokens: 100_000, maxCostUsd: 5.00 });
```

## Full API

| Method | Description |
|--------|-------------|
| `Nexus.create(config?)` | Create and start a Kernova instance |
| `app.agent(name, spec)` | Register an agent |
| `app.tool(name, spec)` | Register a tool |
| `app.ask(goal, options?)` | Submit an intent, get an answer |
| `app.stream(goal)` | Stream response tokens |
| `app.remember(content, layer?, tags?)` | Store a memory |
| `app.recall(query, options?)` | Search memories |
| `app.workflow(definition)` | Register a workflow |
| `app.runWorkflow(id, input?)` | Execute a workflow |
| `app.getKernel()` | Access the underlying kernel |
| `app.close()` | Shut down gracefully |

## Supported Providers (20+)

Set any of these environment variables — Kernova auto-detects:

`OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `GEMINI_API_KEY` · `DEEPSEEK_API_KEY` · `GROQ_API_KEY` · `MISTRAL_API_KEY` · `TOGETHER_API_KEY` · `OPENROUTER_API_KEY` · `XAI_API_KEY` · `COHERE_API_KEY` · `FIREWORKS_API_KEY` · `PERPLEXITY_API_KEY`

Local (no key): Ollama · LM Studio · vLLM · llama.cpp

## Requirements

- Node.js 20+
- At least one AI model provider (or Ollama for local)

## Documentation

Full docs, guides, and API reference at [kernova.dev](https://kernova.dev)
