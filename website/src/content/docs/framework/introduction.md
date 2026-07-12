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
