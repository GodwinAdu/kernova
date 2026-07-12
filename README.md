# ◆ Kernova

**The Full-Stack AI Agent Platform**

Build, deploy, and operate intelligent agent applications. Define agents and frontends in one project. Deploy with one command.

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are helpful.' });
const { answer } = await app.ask('What is the capital of France?');
console.log(answer);
await app.close();
```

## Install

```bash
# Full-stack framework (recommended)
npx create-kernova-app my-app

# Or SDK only
npm install @kernova/sdk
```

## The Kernova Ecosystem

| Package | Description | Use When |
|---------|-------------|----------|
| [`@kernova/framework`](./packages/framework) | Full-stack framework (agents + React frontend) | Building complete apps |
| [`@kernova/sdk`](./packages/sdk) | High-level API for agent backends | Backend-only or custom frontend |
| [`@kernova/core`](./packages/core) | Runtime kernel (full control) | Advanced/custom runtimes |
| [`@kernova/cli`](./packages/cli) | Developer tools (create, dev, build, deploy) | All projects |
| [`@kernova/types`](./packages/types) | TypeScript type definitions | All projects |
| [`@kernova/studio`](./packages/studio) | Admin dashboard | Monitoring & debugging |
| [`create-kernova-app`](./packages/create-kernova-app) | Project scaffolding | Starting new projects |

## Full-Stack Framework (Recommended)

```bash
npx create-kernova-app my-app
cd my-app
kernova dev
```

This gives you:
- React frontend at `http://localhost:3000`
- Agent API at `http://localhost:3000/api/agents/*`
- Hot reload for both
- One-command deploy to Kernova Cloud

```
my-app/
├── app/                 # Frontend (Next.js 16)
│   └── chat/page.tsx    # Chat UI with useAgentStream hook
├── agents/              # Backend (file-based routing)
│   ├── support.agent.ts # → POST /api/agents/support
│   └── tools/
│       └── search-kb.ts # Custom tool
├── memory/              # Memory schemas
├── kernova.config.ts    # Configuration
└── package.json
```

## Why Kernova?

| Without Kernova | With Kernova |
|----------------|-------------|
| Build memory from scratch | `app.remember()` / `app.recall()` — persistent, searchable |
| Implement function calling | `app.tool()` — agents call tools automatically |
| Wire frontend to backend manually | `useAgent('support')` — auto-connects |
| Deploy frontend + backend separately | `kernova deploy` — ships both in one command |
| Build auth, rate limiting | Built-in: API keys, roles, budgets |
| No observability | Every action emits events, viewable in Studio |
| Locked to one LLM | 20+ providers, switch with one env var |
| Months of infrastructure | `npx create-kernova-app` — done in seconds |

## Features

- **Full-Stack Framework** — Agents + React in one project, one URL
- **File-Based Agent Routing** — `agents/support.agent.ts` → `/api/agents/support`
- **React Hooks** — `useAgent`, `useAgentStream`, `useMemory` (zero config)
- **20+ Model Providers** — OpenAI, Anthropic, Gemini, DeepSeek, Groq, Ollama, and more
- **Five-Layer Memory** — Persistent, searchable, with semantic (vector) support
- **Tool Calling** — Agents reason about and call your functions
- **Multi-Agent** — Delegation, pipelines, parallel execution
- **Streaming** — Token-by-token response streaming with abort
- **One-Command Deploy** — `kernova deploy` to Kernova Cloud
- **Event-Native** — Every action tracked, queryable, streamable
- **Identity & Auth** — API keys, sessions, roles, permissions
- **Budget Control** — Token limits, rate limiting, cost caps
- **Hot Reload** — Edit agents or frontend, auto-reloads

## Commands

```bash
npx create-kernova-app my-app   # Scaffold a project
kernova dev                      # Start development (one URL)
kernova build                    # Build for production
kernova start                    # Run production locally
kernova login                    # Authenticate with Kernova Cloud
kernova deploy                   # Deploy to production
```

## Kernova Cloud

The managed platform for deploying Kernova apps. [cloud.kernova.app](https://cloud.kernova.app)

- Instant deploys from CLI
- Auto-scaling
- Secrets vault
- Custom domains
- Team collaboration
- Usage monitoring

## Documentation

Full documentation at [kernova.dev](https://kernova.dev)

## License

MIT
