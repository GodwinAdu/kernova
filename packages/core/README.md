# @kernova/core

The **Kernova Runtime Engine** — the kernel that powers AI agent applications.

> **Most developers should use `@kernova/framework` or `@kernova/sdk` instead.** This package is for advanced use cases where you need full control over the runtime.

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
- **Studio** — Web dashboard for inspection

## Quick Start

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

// Create the runtime
const kernel = new KernovaKernel({
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
| `KernovaKernel` | The runtime kernel — start, submit, stop |
| `defineAgent()` | Define agents with instructions and optional custom logic |
| `kernel.events` | Event bus — subscribe, query, stream |
| `kernel.memoryEngine` | Memory — store, query, decay |
| `kernel.plugins` | Plugin registry — tools, middleware |
| `kernel.workflows` | Workflow engine — define, execute, approve |
| `kernel.identity` | Identity — users, keys, sessions, permissions |
| `kernel.budget` | Budget — limits, tracking, enforcement |
| `kernel.models` | Model router — complete, stream, embed |
| `kernel.gateway` | Agent Gateway API server |
| `kernel.scheduler` | Cron job scheduler |
| `kernel.taskQueue` | Priority task queue with retries |
| `kernel.channels` | Inbound/outbound messaging adapters |
| `kernel.triggers` | Event-driven proactive triggers |
| `DevServer` | Development server with hot-reload |

## For a Simpler API

Use `@kernova/sdk` for less boilerplate:

```typescript
import { Kernova } from '@kernova/sdk';
const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are helpful.' });
const { answer } = await app.ask('Hello!');
await app.close();
```

Or use `@kernova/framework` for a full-stack app:

```bash
npx create-kernova-app my-app
```

## Documentation

Full docs at [kernova.dev](https://kernova.dev)
