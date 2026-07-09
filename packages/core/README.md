# @kernova/core

The **Kernova Intelligent Systems Runtime** — the kernel that powers AI-driven applications.

## Installation

```bash
npm install @kernova/core @kernova/types
```

## What It Does

`@kernova/core` is the full runtime engine. It handles:

- **Intent processing** — Submit structured goals, get results with evidence
- **Agent orchestration** — Register agents, score capabilities, route intents
- **Memory** — Five-layer persistent storage with full-text + semantic search
- **Events** — Every action tracked in SQLite, queryable, streamable
- **Tools & Plugins** — Register functions agents can call autonomously
- **Workflows** — Multi-step execution with human approval and compensation
- **Identity** — API keys, sessions, roles, permissions, organizations
- **Budgets** — Token limits, rate limiting, cost caps
- **Models** — 20+ providers, auto-detected, with fallback chains
- **Streaming** — Token-by-token response streaming
- **Multi-agent** — Delegation, ask, broadcast between agents
- **Studio** — Web dashboard (localhost:4200) for inspection

## Quick Start

```typescript
import { NexusKernel, defineAgent } from '@kernova/core';

// Create the runtime
const kernel = new NexusKernel({
  environment: 'development',
  debug: true,
});

// Define an agent
const assistant = defineAgent({
  name: 'assistant',
  description: 'A helpful assistant',
  capabilities: [{ id: 'general', name: 'General', description: 'General help', confidence: 0.9 }],
  tools: [],
  instructions: 'You are helpful and concise.',
});

// Register and start
kernel.agentRegistry.register(assistant.definition, assistant.executor);
await kernel.start();

// Submit an intent
const result = await kernel.submit({ goal: 'What is 2+2?', intentType: 'query' });
console.log(result.result?.summary);

// Stop
await kernel.stop();
```

## Environment Variables

Set at least one model provider key:

```bash
export OPENAI_API_KEY=sk-...        # or
export ANTHROPIC_API_KEY=sk-ant-... # or
export DEEPSEEK_API_KEY=sk-...      # or any of 20+ providers
```

## Key APIs

| API | Description |
|-----|-------------|
| `NexusKernel` | The runtime kernel — start, submit, stop |
| `defineAgent()` | Define agents with instructions and optional custom logic |
| `createProvider()` | Create model providers from presets |
| `kernel.events` | Event bus — subscribe, query, stream |
| `kernel.memoryEngine` | Memory — store, query, decay |
| `kernel.plugins` | Plugin registry — tools, middleware |
| `kernel.workflows` | Workflow engine — define, execute, approve |
| `kernel.identity` | Identity — users, keys, sessions, permissions |
| `kernel.budget` | Budget — limits, tracking, enforcement |
| `kernel.models` | Model router — complete, stream, embed |
| `DevServer` | Development server with hot-reload + Studio |
| `StudioServer` | Web dashboard server |

## For a Simpler API

If you want less boilerplate, use `@kernova/sdk` instead:

```bash
npm install @kernova/sdk
```

```typescript
import { Nexus } from '@kernova/sdk';
const app = await Nexus.create();
app.agent('assistant', { instructions: 'You are helpful.' });
const { answer } = await app.ask('Hello!');
await app.close();
```

## Documentation

Full docs at [kernova.dev](https://kernova.dev)
