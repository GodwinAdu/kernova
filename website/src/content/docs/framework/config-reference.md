---
title: Configuration Reference
description: All options for kernova.config.ts explained.
---

# Configuration Reference

The `kernova.config.ts` file at the root of your project configures the framework behavior.

## Full Example

```typescript
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  // Required: project name (used as deploy slug)
  name: 'my-support-app',

  // Optional: version
  version: '1.0.0',

  // Default model for all agents
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',   // env var name (default)
  },

  // Additional named models (agents can reference by name)
  models: {
    fast: { provider: 'openai', model: 'gpt-4o-mini' },
    smart: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    local: { provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434' },
  },

  // Memory configuration
  memory: {
    provider: 'local',           // 'local' (SQLite) or 'cloud' (Kernova Cloud)
    embeddingModel: 'text-embedding-3-small',
  },

  // API Gateway settings
  gateway: {
    openaiCompat: true,          // Enable /v1/chat/completions endpoint
    cors: ['*'],                 // Allowed origins (* = all)
    rateLimit: {
      requests: 100,             // Max requests...
      window: '1m',              // ...per this time window
    },
  },

  // Deploy settings
  deploy: {
    region: 'us-east-1',        // Default deploy region
    domain: 'my-app.kernova.app', // Custom domain (set after first deploy)
    env: {},                     // Extra env vars for production
    scale: {
      minInstances: 1,
      maxInstances: 10,
      concurrency: 50,           // Max concurrent requests per instance
    },
  },

  // Frontend framework
  app: {
    framework: 'next',           // 'next', 'react', or 'none'
    port: 3000,                  // Dev server port
  },

  // Plugins to load
  plugins: [],
});
```

## Options Reference

### `name` (required)

```typescript
name: 'my-app'
```

The project identifier. Used as:
- The deploy slug (`https://{name}.kernova.app`)
- The Render service name (`kn-{name}`)
- Display name in the Kernova Cloud dashboard

Must be lowercase, alphanumeric with hyphens only.

---

### `model`

```typescript
model: {
  provider: 'openai',     // 'openai' | 'anthropic' | 'google' | 'ollama' | ...
  model: 'gpt-4o',        // Model identifier
  apiKeyEnv: 'OPENAI_API_KEY',  // Which env var holds the API key
  baseUrl: undefined,      // Override API base URL (for proxies/local models)
}
```

This is the default model used by agents that don't specify their own.

**Supported providers:** openai, anthropic, google, deepseek, groq, mistral, cohere, xai, together, openrouter, fireworks, perplexity, ollama, lmstudio

---

### `models`

Define multiple named models:

```typescript
models: {
  fast: { provider: 'openai', model: 'gpt-4o-mini' },
  smart: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
}
```

Use in agents:
```typescript
defineAgent({
  model: 'fast', // ← references the named model
  // ...
});
```

---

### `memory`

```typescript
memory: {
  provider: 'local',                    // 'local' or 'cloud'
  embeddingModel: 'text-embedding-3-small', // For vector search
}
```

- `local` — Uses SQLite + FTS5. Data stored in `kernova-data/` directory.
- `cloud` — Uses Kernova Cloud's managed memory (when deployed).

---

### `gateway`

```typescript
gateway: {
  openaiCompat: true,    // Serve /v1/chat/completions (drop-in OpenAI replacement)
  cors: ['https://myapp.com', 'http://localhost:3000'],
  rateLimit: {
    requests: 100,
    window: '1m',        // '30s', '1m', '5m', '1h'
  },
}
```

---

### `deploy`

```typescript
deploy: {
  region: 'us-east-1',
  scale: {
    minInstances: 1,     // Min running containers
    maxInstances: 10,    // Max containers during traffic spikes
    concurrency: 50,     // Requests per container before scaling
  },
}
```

Regions: `us-east-1` (Ohio), `us-west-2` (Oregon), `eu-west-1` (Frankfurt), `ap-southeast-1` (Singapore)

---

### `app`

```typescript
app: {
  framework: 'next',  // 'next' | 'react' | 'none'
  port: 3000,         // Dev server port
}
```

- `next` — Uses Next.js 16 for the frontend
- `react` — Uses Vite + React (lighter, no SSR)
- `none` — No frontend, agents only

---

### `plugins`

```typescript
plugins: ['@kernova/github', '@kernova/slack']
```

Load community or official plugins that add tools, middleware, or channels.
