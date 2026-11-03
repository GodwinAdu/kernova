<div align="center">

# ◆ Kernova

**The full-stack AI agent platform for TypeScript.**

Build, deploy, and operate intelligent agent applications. Define agents and frontends in one project and ship both with one command.

[![CI](https://github.com/GodwinAdu/kernova/actions/workflows/ci.yml/badge.svg)](https://github.com/GodwinAdu/kernova/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kernova/framework.svg?label=%40kernova%2Fframework)](https://www.npmjs.com/package/@kernova/framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docs](https://img.shields.io/badge/docs-kernova2026.vercel.app-black.svg)](https://kernova2026.vercel.app)

**[Documentation](https://kernova2026.vercel.app)** · [Quick start](https://kernova2026.vercel.app/getting-started/quick-start/) · [Packages](#packages) · [Examples](https://kernova2026.vercel.app/guides/examples/) · [Contributing](CONTRIBUTING.md) · [Report a bug](https://github.com/GodwinAdu/kernova/issues/new/choose)

</div>

---

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are helpful.' });

const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "Paris"

await app.close();
```

## Quick start

**Full-stack app (recommended):**

```bash
npx create-kernova-app my-app
cd my-app
npm run dev
```

That gives you:

- A React frontend at `http://localhost:3000`, with a chat page already wired to your agent
- An agent API at `http://localhost:3000/api/agents/*`
- Hot reload for both
- One-command deploy with `kernova deploy`

**Backend only:**

```bash
npm install @kernova/sdk
export OPENAI_API_KEY=sk-...
```

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`create-kernova-app`](packages/create-kernova-app) | [![npm](https://img.shields.io/npm/v/create-kernova-app.svg)](https://www.npmjs.com/package/create-kernova-app) | Scaffold a new project |
| [`@kernova/framework`](packages/framework) | [![npm](https://img.shields.io/npm/v/@kernova/framework.svg)](https://www.npmjs.com/package/@kernova/framework) | Full-stack framework: file-based agents + React hooks |
| [`@kernova/sdk`](packages/sdk) | [![npm](https://img.shields.io/npm/v/@kernova/sdk.svg)](https://www.npmjs.com/package/@kernova/sdk) | High-level API for agent backends |
| [`@kernova/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@kernova/core.svg)](https://www.npmjs.com/package/@kernova/core) | Runtime kernel, for full control |
| [`@kernova/cli`](packages/cli) | [![npm](https://img.shields.io/npm/v/@kernova/cli.svg)](https://www.npmjs.com/package/@kernova/cli) | `kernova dev`, `build`, `deploy`, `doctor`, `studio` |
| [`kernova`](packages/kernova) | [![npm](https://img.shields.io/npm/v/kernova.svg)](https://www.npmjs.com/package/kernova) | Alias for `@kernova/cli`, so `npx kernova` works |
| [`@kernova/types`](packages/types) | [![npm](https://img.shields.io/npm/v/@kernova/types.svg)](https://www.npmjs.com/package/@kernova/types) | Shared TypeScript types |
| [`@kernova/studio`](packages/studio) | private | Admin dashboard, bundled into `@kernova/cli` |

```
@kernova/types  ←  @kernova/core  ←  @kernova/sdk
                                  ←  @kernova/framework  ←  create-kernova-app
                                  ←  @kernova/cli  ←  kernova
```

HTTP client SDKs for the Gateway API also live in [`sdks/`](sdks): Python, Go, Rust, Java, C#, and Swift.

## A full-stack project

```
my-app/
├── app/                     # Frontend (Next.js)
│   └── chat/page.tsx        # useAgentStream('support')
├── agents/                  # Backend (file-based routing)
│   ├── support.agent.ts     # → POST /api/agents/support
│   └── tools/
│       └── search-kb.ts     # Custom tool
├── memory/                  # Memory schemas
├── kernova.config.ts        # Configuration
└── package.json
```

```typescript
// agents/support.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  instructions: 'You help customers with their issues.',
  tools: ['search-kb'],
});
```

```tsx
// app/chat/page.tsx
'use client';
import { useAgentStream } from '@kernova/framework/react';

export default function Chat() {
  const { messages, send, isStreaming, streamingContent } = useAgentStream('support');
  // ...render messages and call send(text)
}
```

## Why Kernova?

| Without Kernova | With Kernova |
|-----------------|--------------|
| Build memory from scratch | `app.remember()` / `app.recall()`: persistent and searchable |
| Implement function calling yourself | `app.tool()`: agents call tools automatically |
| Wire the frontend to the backend by hand | `useAgent('support')` connects automatically |
| Deploy frontend and backend separately | `kernova deploy` ships both |
| Build auth and rate limiting | Built in: API keys, roles, budgets |
| No observability | Every action emits an event, viewable in Studio |
| Locked to one LLM | 26 providers, including Azure OpenAI, AWS Bedrock, and Vertex AI, switched with an env var |

## Features

- **Full-stack framework.** Agents and React in one project, served from one URL
- **File-based agent routing.** `agents/support.agent.ts` becomes `/api/agents/support`
- **React hooks.** `useAgent`, `useAgentStream`, `useMemory`, `useThread`, `useTeam`
- **26 model providers.** OpenAI, Anthropic, Gemini, Azure OpenAI, AWS Bedrock, Google Vertex AI, DeepSeek, Groq, Mistral, Qwen, Ollama, and more, with structured output, reasoning controls, prompt caching, and image, audio, and PDF input
- **Five-layer memory.** Persistent, with full-text and vector search and 12 storage adapters
- **Tool calling.** Agents reason about and call your functions
- **Multi-agent.** Delegation, teams, pipelines, and parallel execution
- **Streaming.** Token-by-token responses with abort
- **Autonomy.** Cron scheduling, persistent task queues, event triggers, daemon mode
- **Channels.** Webhooks, WebSocket, Slack, Discord, Telegram, Email, and more
- **MCP.** Connect Model Context Protocol servers declaratively
- **Event-native.** Every action is tracked, queryable, and streamable
- **Identity and governance.** API keys, sessions, roles, permissions, budgets, rate limits
- **One-command deploy.** To [Kernova Cloud](https://kernova-cloud.vercel.app), or self-host with Docker

## Commands

```bash
npx create-kernova-app my-app   # scaffold a project
kernova dev                     # start development (one URL)
kernova doctor                  # test your AI providers
kernova build                   # build for production
kernova start                   # run production locally
kernova login                   # authenticate with Kernova Cloud
kernova deploy                  # deploy to production
```

## Documentation

Full documentation lives at **[kernova2026.vercel.app](https://kernova2026.vercel.app)**.

| | |
|-|-|
| [Quick start](https://kernova2026.vercel.app/getting-started/quick-start/) | Install and build your first agent |
| [Framework guide](https://kernova2026.vercel.app/framework/introduction/) | File-based agents, tools, memory, React hooks, teams |
| [Tutorial: build a support bot](https://kernova2026.vercel.app/framework/tutorial/01-setup/) | From scaffold to production, step by step |
| [SDK API](https://kernova2026.vercel.app/api/sdk/) · [Core API](https://kernova2026.vercel.app/api/core/) · [CLI](https://kernova2026.vercel.app/framework/cli-reference/) | API references |
| [Model providers](https://kernova2026.vercel.app/guides/providers/) | Configure any of the 26 supported providers |
| [Autonomy](https://kernova2026.vercel.app/guides/autonomy/) | Scheduler, queues, triggers, channels, daemon mode |
| [Deploy](https://kernova2026.vercel.app/framework/deploy/) · [Self-hosting](https://kernova2026.vercel.app/framework/self-hosting/) | Shipping to production |
| [Concepts](https://kernova2026.vercel.app/concepts/intents/) · [Protocol specs](https://kernova2026.vercel.app/protocol/overview/) | How Kernova works |

The docs site is built from [`website/`](website). Design documents for contributors live in [`docs/`](docs): [Vision](docs/VISION.md) · [Architecture](docs/ARCHITECTURE.md) · [Specs](docs/specs) · [Decision records](docs/decisions)

## Contributing

We welcome contributions of all sizes, from typo fixes to new providers. To get set up:

```bash
git clone https://github.com/<your-username>/kernova.git
cd kernova
npm install
npm run build
npm test
```

Read the [contributing guide](CONTRIBUTING.md) for the branch workflow, coding standards, and PR process. Look for issues labeled [`good first issue`](https://github.com/GodwinAdu/kernova/labels/good%20first%20issue) to get started.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md), not in public issues.

## Repository layout

```
kernova/
├── packages/        # npm packages (TypeScript, npm workspaces + Turborepo)
├── sdks/            # HTTP client SDKs for other languages
├── examples/        # Runnable examples (npx tsx examples/hello-kernova.ts)
├── docs/            # Guides, specs, protocols, ADRs
└── website/         # Documentation site (Astro)
```

## License

[MIT](LICENSE) © Kernova contributors
