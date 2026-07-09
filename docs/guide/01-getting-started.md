# Getting Started with Nexus

This guide takes you from zero to a working intelligent application in under 5 minutes.

## Prerequisites

- Node.js 20+
- An LLM API key (OpenAI, Anthropic, DeepSeek, or any supported provider)

## Installation

```bash
npm install @nexus/sdk @nexus/types
```

Or install the full stack:

```bash
npm install @nexus/core @nexus/types @nexus/cli
```

## Quick Start (SDK)

The fastest way to build with Nexus:

```typescript
import { Nexus } from '@nexus/sdk';

// 1. Create the runtime
const app = await Nexus.create();

// 2. Define an agent
app.agent('assistant', {
  instructions: 'You are a helpful, concise assistant.',
});

// 3. Ask a question
const result = await app.ask('What is the capital of France?');
console.log(result.answer);

// 4. Clean up
await app.close();
```

Set your API key:
```bash
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

## Quick Start (CLI)

For project-based development with hot reload:

```bash
# Install CLI globally
npm install -g @nexus/cli

# Create a project
nexus init my-app
cd my-app
npm install

# Start development (with hot reload + Studio dashboard)
nexus dev
```

Open http://localhost:4200 for the Studio dashboard.

## Adding Tools

Give your agent the ability to call functions:

```typescript
app.tool('search', {
  description: 'Search for information',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute: async ({ query }) => {
    // Your search logic here
    return { results: [`Found info about ${query}`] };
  },
});
```

The agent will automatically decide when to use this tool during reasoning.

## Using Memory

Nexus remembers things across sessions:

```typescript
// Store
await app.remember('User prefers TypeScript over JavaScript', 'longterm');

// Recall (semantic search)
const memories = await app.recall('programming language preference');
// → [{ content: 'User prefers TypeScript over JavaScript', ... }]
```

## Multi-Agent

Agents can delegate to each other:

```typescript
app.agent('researcher', {
  instructions: 'You research topics thoroughly.',
});

app.agent('writer', {
  instructions: 'You write clear, concise content.',
  async execute(intent, context, tools) {
    const research = await tools.delegate('researcher', intent.goal);
    const article = await tools.complete(`Write about: ${research.response}`);
    return { success: true, summary: article, evidence: {...}, durationMs: 0 };
  },
});
```

## Next Steps

- [Architecture Guide](../ARCHITECTURE.md)
- [Protocol Specification](../protocols/NP-000-overview.md)
- [API Reference](./02-api-reference.md)
- [Examples](../../examples/)
