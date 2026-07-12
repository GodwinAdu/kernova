---
title: Migration Guide
description: Migrate from raw @kernova/core to the full-stack Kernova Framework.
---

# Migration Guide

If you're already using `@kernova/core` directly (like the `kernova init` workflow), this guide shows how to migrate to the full-stack framework.

## Why Migrate?

| Feature | @kernova/core (old) | @kernova/framework (new) |
|---------|-------------------|--------------------------|
| Frontend | Separate project | Built-in (Next.js) |
| Dev server | `kernova dev` (agents only) | `kernova dev` (frontend + agents, one URL) |
| Agent definition | `kernel.agentRegistry.register()` | `defineAgent()` in files |
| Tools | Plugin system | `defineTool()` in files |
| Deploy | Docker manually | `kernova deploy` (one command) |
| React hooks | Build yourself | Built-in (`useAgent`, `useAgentStream`) |

## Migration Steps

### Step 1: Create Framework Structure

In your existing project, create the framework directories:

```bash
mkdir agents
mkdir agents/tools
mkdir memory
mkdir app
```

### Step 2: Convert Agent Registrations to Files

**Before (core):**
```typescript
// src/main.ts
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });

kernel.agentRegistry.register({
  id: 'agent_assistant',
  name: 'Assistant',
  type: 'agent_definition',
  instructions: 'You are a helpful assistant...',
  capabilities: [{ id: 'general', name: 'General', description: 'General help', confidence: 0.8 }],
  tools: [],
  models: [{ id: 'gpt-4o', provider: 'openai', purpose: 'primary' }],
  // ... other required fields
}, async (intent, context, tools) => {
  const response = await tools.complete(intent.goal);
  return { success: true, summary: response, data: response, durationMs: 0, evidence: { sources: [], confidence: 0.9, reasoning: '' } };
});

await kernel.start();
```

**After (framework):**
```typescript
// agents/assistant.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Assistant',
  model: 'gpt-4o',
  instructions: 'You are a helpful assistant...',
  capabilities: ['general'],
});
```

That's it. The framework handles all the boilerplate (registration, executor creation, routing).

### Step 3: Convert Tools to Files

**Before:**
```typescript
// Registered via plugin system
kernel.plugins.register({
  id: 'my-tools',
  name: 'My Tools',
  version: '1.0.0',
  type: 'tool',
  tools: [{
    id: 'search',
    name: 'search',
    description: 'Search the database',
    parameters: { query: { type: 'string' } },
    execute: async (params) => { /* ... */ },
  }],
});
```

**After:**
```typescript
// agents/tools/search.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'search',
  description: 'Search the database',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
  },
  execute: async ({ query }, ctx) => {
    // Same implementation, now with ctx.env, ctx.log, etc.
  },
});
```

### Step 4: Add Configuration

**Before:** `kernova.config.json`
```json
{
  "name": "my-app",
  "runtime": { "environment": "development" },
  "models": { "default": { "provider": "openai", "model": "gpt-4o" } }
}
```

**After:** `kernova.config.ts`
```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'my-app',
  model: { provider: 'openai', model: 'gpt-4o' },
  app: { framework: 'next', port: 3000 },
});
```

### Step 5: Add Framework Dependencies

```bash
npm install @kernova/framework next react react-dom
npm install -D @types/react
```

Update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "kernova dev",
    "build": "kernova build",
    "start": "kernova start",
    "deploy": "kernova deploy"
  }
}
```

### Step 6: Add Frontend (Optional)

Create `app/layout.tsx`:
```tsx
import { KernovaProvider } from '@kernova/framework/react';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      <KernovaProvider>{children}</KernovaProvider>
    </body></html>
  );
}
```

Create `app/page.tsx`:
```tsx
'use client';
import { useAgentStream } from '@kernova/framework/react';

export default function Home() {
  const { messages, send } = useAgentStream('assistant');
  // Your UI here
}
```

Add `next.config.ts`:
```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/agents/:path*', destination: `${process.env.KERNOVA_URL || 'http://localhost:4555'}/agents/:path*` },
    ];
  },
};

export default nextConfig;
```

### Step 7: Delete Old Files

You can now remove:
- `src/main.ts` (framework handles startup)
- `kernova.config.json` (replaced by `kernova.config.ts`)
- Any custom server setup code

### Step 8: Run

```bash
kernova dev
```

Your agents now run with a frontend, hot reload, file-based routing, and one-command deploy.

## What Still Works

- All `@kernova/core` features are still available (memory, events, plugins, channels)
- The kernel is created and managed by the framework under the hood
- You can still access the kernel directly if needed (for advanced use cases)
- Existing SQLite data in `kernova-data/` is preserved

## What Changes

| Before | After |
|--------|-------|
| You create and start the kernel | Framework does it automatically |
| You register agents manually | Framework discovers from `agents/` directory |
| You build your own HTTP server | Framework provides it with file-based routing |
| You manage your own frontend | Next.js integrated, hooks auto-connect |
| You deploy with Docker manually | `kernova deploy` handles everything |
