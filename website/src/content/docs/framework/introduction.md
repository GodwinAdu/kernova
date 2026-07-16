---
title: Kernova Framework
description: Full-stack AI agent framework — build frontends and agent backends in one project.
---

# Kernova Framework

The Kernova Framework is a **full-stack AI agent framework** built on top of Next.js and `@kernova/core`. It lets you define agents, tools, and a React frontend in a single project — then deploy everything with one command.

Think of it like Next.js, but for AI agents:

| Next.js | Kernova Framework |
|---------|-------------------|
| `pages/` → routes | `agents/` → agent endpoints |
| `pages/api/` → API routes | `agents/tools/` → custom tools |
| `next dev` → starts frontend | `kernova dev` → starts frontend + agents |
| `vercel deploy` → deploys to Vercel | `kernova deploy` → deploys to Kernova Cloud |

## Quick Start

```bash
npx create-kernova-app my-app
cd my-app
kernova dev
```

This gives you:
- A React frontend at `http://localhost:3000`
- An agent API at `http://localhost:3000/api/agents/*`
- Hot reload for both

## Project Structure

```
my-app/
├── app/                      # Frontend (Next.js 16)
│   ├── layout.tsx            # Root layout with KernovaProvider
│   ├── page.tsx              # Landing page
│   └── chat/
│       └── page.tsx          # Chat UI (auto-connected to agents)
├── agents/                   # Agent backend (file-based routing)
│   ├── assistant.agent.ts    # → POST /api/agents/assistant
│   ├── support.agent.ts      # → POST /api/agents/support
│   └── tools/
│       ├── web-search.ts     # Custom tool
│       └── create-ticket.ts  # Custom tool
├── memory/                   # Memory schemas
│   └── conversations.ts
├── middleware/               # Agent pipeline middleware
│   └── auth.ts
├── kernova.config.ts         # Project configuration
├── next.config.ts            # Next.js config (auto-generated)
└── package.json
```

## How It Works

The framework runs two things behind a single URL:

1. **Next.js** serves your frontend (`app/` directory) — pages, components, styling
2. **Kernova agent server** runs your agents (`agents/` directory) — LLM calls, tools, memory

In development, Next.js proxies `/api/agents/*` requests to the agent server. In production on Kernova Cloud, a gateway handles the routing. You never deal with CORS or multiple URLs.

## One URL, Like Next.js

```
http://localhost:3000
├── /              → Your frontend (app/page.tsx)
├── /chat          → Chat UI (app/chat/page.tsx)
├── /api/agents/*  → Agent endpoints (agents/*.agent.ts)
├── /v1/intents    → Generic intent API
└── /health        → Health check
```

## Next Steps

- [Create your first project →](/framework/create-project)
- [Define agents →](/framework/agents)
- [React hooks →](/framework/react-hooks)
- [Deploy to Kernova Cloud →](/framework/deploy)

---

## What Kernova Is (And Isn't)

Kernova is purpose-built for **AI agent applications** — software where artificial intelligence needs to reason, remember, act, and learn. Every primitive in the framework exists to support this:

| Primitive | Purpose |
|-----------|---------|
| **Agents** | AI entities that receive goals, reason about them, and produce outputs |
| **Tools** | Functions the AI can call to interact with the real world (APIs, databases, services) |
| **Memory** | Persistent knowledge that lets the AI remember across conversations and time |
| **Teams** | Multiple agents collaborating, delegating, and coordinating on complex goals |
| **Triggers** | Scheduled or event-driven goals that fire autonomously without user input |
| **Model Router** | Intelligent routing between LLM providers (OpenAI, Anthropic, Gemini, Ollama) |
| **Agent Loop** | Iterative execution for multi-step tasks that require multiple tool calls |

### When To Use Kernova

✅ **Kernova is the right choice when you're building:**

- **Personal AI assistants** — like Aura: knows you, manages your life, acts on your behalf
- **Customer support agents** — understands context, searches knowledge bases, escalates intelligently
- **Code review bots** — analyzes PRs, suggests improvements, tracks patterns over time
- **Research agents** — searches multiple sources, synthesizes findings, remembers past research
- **Workflow automation with AI reasoning** — not just "if X then Y" but "understand X, decide the best action, then do it"
- **Multi-agent systems** — teams of specialists that delegate, collaborate, and share context
- **Any application where AI needs to take actions** — not just generate text, but actually DO things (send emails, create issues, book meetings, manage data)

### When NOT To Use Kernova

❌ **Kernova adds unnecessary complexity if you're building:**

- A standard CRUD application (use Next.js, Express, or Rails)
- An e-commerce site (use Shopify, Medusa, or Saleor)
- A REST API without AI reasoning (use Fastify, Hono, or Express)
- A static website or blog (use Astro, Hugo, or WordPress)
- A mobile app without AI features (use React Native or Flutter directly)

### The Key Distinction

The difference between "software that uses AI" and "an AI agent" is **agency** — the ability to decide, act, and learn:

| Regular AI Integration | Kernova AI Agent |
|----------------------|-----------------|
| User asks → AI responds with text | User sets a goal → Agent reasons, acts, and reports back |
| One-shot (no memory between calls) | Persistent memory (remembers everything, forever) |
| Developer writes all the logic | Agent decides which tools to use and when |
| Fixed workflows | Adaptive behavior based on context and learning |
| Single model call | Multi-step reasoning with tool calling and self-evaluation |

**Example:** A chatbot that answers FAQ questions is "software that uses AI." An agent that monitors your inbox, decides which emails need replies, drafts contextual responses, sends them, and learns your preferences over time — that's a Kernova agent.

### Standalone Components

While Kernova is designed as a complete AI agent framework, some components work independently:

- **Memory v2** (12 database adapters with vector search) — usable as a standalone smart data layer via `createMemoryEngine()`
- **Cron scheduler** — works for any scheduled jobs, not just AI triggers
- **WebSocket server** — usable for any real-time application
- **Event bus** — standard pub/sub pattern

However, these are better served by dedicated libraries (Prisma, node-cron, ws, EventEmitter) if you don't need the AI agent layer. Kernova's value is the full integrated system — memory + reasoning + tools + autonomy working together.
