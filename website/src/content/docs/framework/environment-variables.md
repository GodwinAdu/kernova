---
title: Environment Variables
description: How to manage secrets and configuration across dev and production.
---

# Environment Variables

Environment variables hold your API keys, database URLs, and other secrets. Kernova loads them differently in development vs production.

## Development (Local)

In development, variables are loaded from `.env.local`:

```bash
# .env.local (git-ignored, never committed)
OPENAI_API_KEY=sk-proj-xxxxx
DATABASE_URL=postgresql://localhost:5432/mydb
MY_API_SECRET=secret123
```

These are available in your tools:

```typescript
// agents/tools/my-tool.ts
export default defineTool({
  name: 'my-tool',
  description: '...',
  parameters: {},
  execute: async (params, ctx) => {
    const apiKey = ctx.env.MY_API_SECRET; // ← loaded from .env.local
    // ...
  },
});
```

## Production (Kernova Cloud)

In production, variables come from your **Secrets Vault** in the Kernova Cloud dashboard:

1. Go to Dashboard → Secrets
2. Add each key-value pair
3. They're encrypted at rest and injected into your container on deploy

Your tool code doesn't change — `ctx.env.MY_API_SECRET` works the same way.

## Public vs Private Variables

| Variable | Available in | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Server only (agents/tools) | API keys |
| `DATABASE_URL` | Server only | Connection strings |
| `NEXT_PUBLIC_*` | Server AND browser | Feature flags, public URLs |

**Rule:** Anything starting with `NEXT_PUBLIC_` is exposed to the browser. Never put secrets there.

```bash
# .env.local
OPENAI_API_KEY=sk-xxx          # ← Only agents/tools can see this
NEXT_PUBLIC_APP_NAME=My App    # ← Browser JavaScript can see this
```

## Built-in Variables

These are automatically available in your agents:

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `development` or `production` | Current environment |
| `KERNOVA_URL` | `http://localhost:4555` or cloud URL | Agent backend URL |
| `KERNOVA_PORT` | `4555` | Port the agent server listens on |

## Loading Order

Variables are loaded in this order (later overrides earlier):

1. System environment variables
2. `.env` (shared defaults, committed to git)
3. `.env.local` (local overrides, git-ignored)
4. Kernova Cloud Secrets (production only)

## Using in `kernova.config.ts`

You can reference env vars in your config:

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'my-app',
  model: {
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
});
```

## Per-Project Secrets

On Kernova Cloud, you can scope secrets to specific projects:

- **Global secrets** (scope: "All projects") — shared across all projects in your org
- **Project secrets** — only available to a specific project

This is useful when different projects use different API keys.
