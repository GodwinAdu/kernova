# ◆ Kernova

**The Intelligent Systems Runtime**

Build, operate, and govern intelligent software. 5 lines to start. 20+ model providers. Built-in memory, tools, events, multi-agent coordination, and production governance.

```typescript
import { Nexus } from '@kernova/sdk';

const app = await Nexus.create();
app.agent('assistant', { instructions: 'You are helpful.' });
const { answer } = await app.ask('What is the capital of France?');
console.log(answer);
await app.close();
```

## Install

```bash
npm install @kernova/sdk
```

## Why Kernova?

| Without Kernova | With Kernova |
|----------------|-------------|
| Build memory from scratch | `app.remember()` / `app.recall()` — persistent, searchable |
| Implement function calling | `app.tool()` — agents call tools automatically |
| Build auth, rate limiting | Built-in: API keys, roles, budgets |
| No observability | Every action emits events, viewable in Studio |
| Locked to one LLM | 20+ providers, switch with one env var |
| Months of infrastructure | `npm install @kernova/sdk` — done |

## Packages

| Package | Description |
|---------|-------------|
| [`@kernova/sdk`](./packages/sdk) | High-level API (start here) |
| [`@kernova/core`](./packages/core) | Runtime kernel (full control) |
| [`@kernova/cli`](./packages/cli) | Developer tools (init, dev, deploy) |
| [`@kernova/types`](./packages/types) | TypeScript type definitions |

## Features

- **20+ Model Providers** — OpenAI, Anthropic, Gemini, DeepSeek, Groq, Ollama, and more
- **Five-Layer Memory** — Persistent, searchable, with semantic (vector) support
- **Tool Calling** — Agents reason about and call your functions
- **Multi-Agent** — Delegation, orchestration, broadcast
- **Event-Native** — Every action tracked in SQLite, queryable, streamable
- **Kernova Studio** — Web dashboard at localhost:4200
- **Identity & Auth** — API keys, sessions, roles, permissions
- **Budget Control** — Token limits, rate limiting, cost caps
- **Workflows** — Multi-step execution with human approval
- **Streaming** — Token-by-token response streaming
- **Hot Reload** — Edit agents, auto-reloads (no restart)
- **Deploy** — Docker and Node.js production deployment

## Quick Start with CLI

```bash
npm install -g @kernova/cli
kernova init my-app
cd my-app && npm install
kernova dev
# → Studio at http://localhost:4200
```

## Documentation

Full documentation at [kernova.dev](https://kernova.dev)

## License

MIT
