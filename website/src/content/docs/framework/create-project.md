---
title: Create a Project
description: Scaffold a new full-stack Kernova project in seconds.
---

# Create a Project

## Using npx (recommended)

```bash
npx create-kernova-app my-app
cd my-app
kernova dev
```

This scaffolds a complete project with a Next.js frontend and agent backend.

## Options

```bash
# Default template (1 agent + chat UI)
npx create-kernova-app my-app

# Multi-agent template (support + researcher agents)
npx create-kernova-app my-app --template multi-agent

# Agents only (no frontend)
npx create-kernova-app my-app --no-frontend

# Skip npm install
npx create-kernova-app my-app --no-install
```

## Using the CLI

If you already have `@kernova/cli` installed globally:

```bash
kernova create my-app
kernova create my-app --template multi-agent
kernova create my-app --no-frontend
```

## What You Get

After running `create-kernova-app`, you'll have:

```
my-app/
├── app/
│   ├── layout.tsx         # Wraps your app with KernovaProvider
│   ├── page.tsx           # Landing page
│   ├── globals.css        # Starter styles
│   └── chat/
│       └── page.tsx       # Chat page using useAgentStream
├── agents/
│   ├── assistant.agent.ts # Your first agent
│   └── tools/
│       └── web-search.ts  # Example tool
├── memory/
│   └── conversations.ts   # Memory schema
├── kernova.config.ts      # Project configuration
├── next.config.ts         # Next.js rewrites (auto-configured)
├── .env.local             # Your API keys go here
├── package.json
└── tsconfig.json
```

## Configuration

The `kernova.config.ts` file defines your project settings:

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'my-app',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
  },
  memory: {
    provider: 'local',
    embeddingModel: 'text-embedding-3-small',
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

## Environment Variables

Add your API keys to `.env.local`:

```
OPENAI_API_KEY=sk-...
```

That's it. Run `kernova dev` and your agent is ready to talk.

## Development Commands

| Command | What It Does |
|---------|-------------|
| `kernova dev` | Start frontend + agents (one URL) |
| `kernova build` | Build for production |
| `kernova start` | Run production server locally |
| `kernova deploy` | Deploy to Kernova Cloud |
