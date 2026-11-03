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
    smart: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
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
  provider: 'openai',     // 'openai' | 'anthropic' | 'gemini' | 'ollama' | ...
  model: 'gpt-4o',        // Model identifier
  apiKeyEnv: 'OPENAI_API_KEY',  // Which env var holds the API key (default: the provider's usual one)
  baseUrl: undefined,      // Override API base URL (for proxies/local models)
  options: undefined,      // Provider-specific settings (cloud platforms; see below)
}
```

This is the default model used by agents that don't specify their own. Without `model`, the first provider with an API key in the environment is used, with its own default model.

**Supported providers:** openai, anthropic, gemini (`google` works as an alias), deepseek, groq, mistral, cohere, xai, qwen, moonshot, zai, together, openrouter, huggingface, nvidia, fireworks, perplexity, cerebras, sambanova; the cloud platforms azure, bedrock, and vertex; and the local servers ollama, lmstudio, vllm, llamacpp. Local servers need no key; set `baseUrl` if they don't run on their default port. Any other name with a `baseUrl` is treated as an OpenAI-compatible API. See [Model Providers](/guides/providers/) for each provider's environment variable.

```typescript
// Local model with Ollama
model: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' }

// Cloud platforms: settings go in options (credentials come from the environment)
model: { provider: 'azure', model: 'my-gpt-deployment', options: { endpoint: 'https://my-resource.openai.azure.com' } }
model: { provider: 'bedrock', model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', options: { region: 'us-east-1', profile: 'prod' } }
model: { provider: 'vertex', model: 'gemini-3-flash-preview', options: { project: 'my-project', location: 'global' } }
```

`options` by provider: azure `{ endpoint, apiVersion?, tenantId?, clientId?, managedIdentity? }`; bedrock `{ region, profile?, instanceMetadata?, embeddingModel?, additionalModelRequestFields? }`; vertex `{ project, location?, keyFile?, embeddingModel? }`; OpenAI-compatible APIs `{ embeddingModel?, reasoningFormat?, replayReasoning?, streamUsage? }`.

---

### `models`

Define multiple named models:

```typescript
models: {
  fast: { provider: 'openai', model: 'gpt-4o-mini' },
  smart: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
}
```

Use in agents:
```typescript
defineAgent({
  model: 'fast', // ← references the named model
  // ...
});
```

An agent's `model` can also be a plain model ID (`model: 'gpt-4o-mini'`), which is sent to the default provider. Agents without `model` use the default.

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
plugins: ['my-kernova-plugin']
```

npm packages whose default export is a Kernova plugin (`{ id, name, version, type, tools }`, as passed to `kernel.plugins.register()`). Their tools are registered at startup; list them in an agent's `tools` to use them. A package that fails to load is logged and skipped.

---

### `builtInTools`

```typescript
builtInTools: {
  enabled: ['http-fetch', 'date-time', 'file-read'], // default: the safe tools
  sandboxDir: './workspace',                           // default: kernova-data/workspace
  httpFetch: { allowPrivateNetwork: false },
}
```

Kernova's built-in tools. `http-fetch`, `date-time`, `json-parse`, `math-eval`, `regex-match`, and `image-describe` are on by default. `shell-exec`, `code-eval`, `file-read`, `file-write`, and `database-query` run code or touch files, so they're off unless listed in `enabled`. See [Built-in Tools](/guides/built-in-tools) for every option.

---

### `toolPolicy`

```typescript
toolPolicy: { deny: ['shell-exec', 'github_delete_*'] }
```

Allow/deny lists of tool IDs (`*` globs work) applied to every agent, including MCP and plugin tools.

---

### Gateway notes

- `gateway.rateLimit` limits requests per caller: the request body's `user.id`, or the client IP when there's none
- `gateway.openaiCompat` serves `POST /v1/chat/completions`. The request's `model` picks the agent by route (default: the first agent). The reply comes back in one piece, also when `stream: true`

---

### `reflection`

```typescript
reflection: { enabled: true, threshold: 0.7, maxAttempts: 2 }
```

Self-reflection: after each answer, an extra model call grades it and answers scoring below `threshold` are regenerated (up to `maxAttempts` times). Off by default, because it adds at least one model call per answer. An agent can turn it on or off for itself with its own `reflection` field. Streaming answers (`/agents/:name/stream` without tool calls) aren't graded.
