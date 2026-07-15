---
title: Build a Personal AI OS
description: Learn to build Aura — a full personal AI operating system with 11 specialist agents, 29 tools, and autonomous capabilities using Kernova.
---

## What You'll Build

By the end of this 10-part course, you'll have **Aura** — a personal AI operating system that:

- Knows you deeply through persistent memory
- Manages your email, calendar, GitHub, Notion, Slack, and WhatsApp
- Has 10 specialist agents (finance, health, productivity, and more)
- Acts autonomously (checks email, prepares for meetings, sends briefings)
- Runs agent loops for complex multi-step tasks
- Has a full Next.js chat UI with memory browser and settings

This isn't a chatbot. It's a personal operating system that manages your life.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                    YOU                        │
│              (Chat UI / WhatsApp)             │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│              AURA (Lead Agent)               │
│   Personality · Memory · Delegation · Loop   │
└────┬───────┬───────┬───────┬───────┬────────┘
     │       │       │       │       │
┌────▼──┐ ┌──▼───┐ ┌▼────┐ ┌▼────┐ ┌▼─────┐
│Produc.│ │Finan.│ │Heal.│ │Know.│ │ +6   │
│Agent  │ │Agent │ │Agent│ │Agent│ │more  │
└───────┘ └──────┘ └─────┘ └─────┘ └──────┘
     │
┌────▼────────────────────────────────────────┐
│              29 TOOLS                        │
│  Gmail · Calendar · GitHub · Weather · ...   │
└─────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────┐
│           9 AUTONOMOUS TRIGGERS              │
│  Email monitor · Morning briefing · ...      │
└─────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────┐
│         MEMORY (PostgreSQL + Vectors)        │
│  Scored retrieval · Auto-save · Compaction   │
└─────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js 18+** and npm
- **PostgreSQL** (local or [Neon](https://neon.tech) for serverless)
- **OpenAI API key** (for GPT-4o and embeddings)
- Optional: Google OAuth credentials, GitHub token, Tavily API key

## Create the Project

```bash
npx create-kernova-app aura --next
cd aura
npm install pg googleapis
```

This scaffolds a Kernova project with Next.js frontend integration. Your structure looks like:

```
aura/
├── agents/           # Agent definitions
│   ├── tools/        # Tool implementations
│   ├── triggers/     # Autonomous scheduled goals
│   ├── teams/        # Team definitions
│   └── workflows/    # Multi-step workflows
├── app/              # Next.js frontend
├── memory/           # Memory schema definitions
├── kernova.config.ts # Central configuration
├── .env.local        # API keys and secrets
└── package.json
```

## Configure Kernova

Create `kernova.config.ts` — this is the brain of your project:

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'aura',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
  },
  memory: {
    version: 2,
    provider: 'postgres',
    url: process.env.DATABASE_URL,
    embedding: {
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    vectorSearch: true,
    scoring: {
      similarityWeight: 0.45,
      recencyWeight: 0.25,
      frequencyWeight: 0.15,
      relevanceWeight: 0.15,
      recencyHalfLife: 336,
    },
    compaction: {
      enabled: true,
      threshold: 50,
      keepRecent: 10,
    },
    autoRecall: true,
    autoSave: true,
    contextMessages: 20,
  },
  gateway: {
    openaiCompat: true,
    cors: ['*'],
    rateLimit: { requests: 100, window: '1m' },
  },
  app: {
    framework: 'next',
    port: 3000,
  },
});
```

**Why these settings?** A personal AI needs high similarity weight (0.45) because recalling the *right* memory matters most. The recency half-life of 336 hours (2 weeks) means personal facts stay relevant longer than in a support bot. Auto-recall injects memories into every prompt so Aura always knows who she's talking to.

## Environment Variables

Create `.env.local`:

```bash
# Required
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://user:pass@host:5432/aura

# Optional (add as you build)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_TOKEN=
TAVILY_API_KEY=
GNEWS_API_KEY=
```

## Run It

```bash
kernova dev
```

You should see:

```
🚀 Kernova dev server running
   Backend:  http://localhost:4555
   Frontend: http://localhost:3000
   Agents:   1 loaded (assistant)
   Memory:   PostgreSQL (v2)
```

Open `http://localhost:3000` — you'll see the chat UI. It won't do much yet (we haven't built the agent), but the infrastructure is live.

## What's Next

Over the next 9 parts, we'll build every layer of Aura:

1. ~~Introduction & Setup~~ ✓
2. **The Lead Agent** — Aura's personality and onboarding
3. **Memory System** — persistent knowledge with scored retrieval
4. **Core Tools** — notes, reminders, habits, weather, search
5. **Integrations** — Gmail, Calendar, GitHub, Notion, Slack, WhatsApp
6. **Specialist Agents** — 10 domain experts
7. **Team & Delegation** — hierarchical task routing
8. **Agent Loops** — iterative multi-step execution
9. **Autonomous Triggers** — scheduled proactive behaviors
10. **Chat UI & Deployment** — frontend and production

## Exercise

Before moving on:

1. Run `kernova dev` and confirm the backend starts on port 4555
2. Visit `http://localhost:3000` and verify the frontend loads
3. Check that your PostgreSQL connection works (you'll see a "Memory: PostgreSQL" log)
4. Explore the project structure — open `agents/`, `app/`, and `memory/`

Ready? Let's build Aura's personality in Part 2.
