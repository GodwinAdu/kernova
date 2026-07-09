---
title: Configuration
description: Complete reference for nexus.config.json and environment setup.
---

# Configuration

## nexus.config.json

Every Nexus project has a configuration file at its root:

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "runtime": {
    "environment": "development",
    "debug": true
  },
  "memory": {
    "provider": "local",
    "layers": {
      "working": { "maxItems": 50 },
      "session": { "ttlSeconds": 3600 },
      "longterm": { "provider": "local" }
    }
  },
  "models": {
    "default": {
      "provider": "openai",
      "model": "gpt-4o"
    },
    "fallback": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "providers": [],
  "budget": {
    "maxTokens": 1000000,
    "maxCostUsd": 50.00,
    "requestsPerMinute": 60,
    "maxTokensPerIntent": 10000
  },
  "studio": {
    "port": 4200,
    "requireAuth": false
  }
}
```

## Configuration Fields

### `runtime`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `environment` | string | `"development"` | `development`, `staging`, or `production` |
| `debug` | boolean | `false` | Enable debug logging |

### `models`

| Field | Type | Description |
|-------|------|-------------|
| `default.provider` | string | Default model provider ID |
| `default.model` | string | Default model name |
| `fallback.provider` | string | Fallback provider if default fails |
| `fallback.model` | string | Fallback model name |

### `providers` (custom)

Add any OpenAI-compatible provider:

```json
{
  "providers": [
    {
      "id": "my-provider",
      "name": "My Custom LLM",
      "adapter": "openai",
      "baseUrl": "https://api.example.com/v1",
      "apiKeyEnv": "MY_API_KEY",
      "defaultModel": "my-model",
      "timeoutMs": 30000
    }
  ]
}
```

Adapter types: `openai`, `anthropic`, `gemini`, `ollama`, `custom`

### `budget`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxTokens` | number | unlimited | Total token cap |
| `maxCostUsd` | number | unlimited | USD spending cap |
| `requestsPerMinute` | number | unlimited | Global rate limit |
| `maxTokensPerIntent` | number | unlimited | Per-intent token limit |

### `studio`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `4200` | Studio HTTP port |
| `requireAuth` | boolean | `false` | Require API key for API access |
| `tlsCert` | string | — | Path to TLS certificate |
| `tlsKey` | string | — | Path to TLS private key |

## Environment Variables

### Model Provider Keys

| Variable | Provider |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI (GPT-4o) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `GEMINI_API_KEY` | Google Gemini |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral AI |
| `TOGETHER_API_KEY` | Together AI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `XAI_API_KEY` | xAI (Grok) |
| `COHERE_API_KEY` | Cohere |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `PERPLEXITY_API_KEY` | Perplexity |
| `CEREBRAS_API_KEY` | Cerebras |
| `SAMBANOVA_API_KEY` | SambaNova |

### Runtime Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Studio/API port | `4200` |
| `NEXUS_DATA_DIR` | Persistence directory | `./nexus-data` |
| `NEXUS_AUTH` | Require auth in production | `true` |
| `NODE_ENV` | Environment mode | `development` |

## Data Directory

Nexus stores SQLite databases in `./nexus-data/`:

```
nexus-data/
  nexus.db       ← Events, memories, API keys, identities
  nexus.db-wal   ← Write-ahead log (performance)
  nexus.db-shm   ← Shared memory (performance)
```

Override the location:
```typescript
new NexusKernel({ dataDir: '/custom/path' });
```

Disable persistence entirely:
```typescript
new NexusKernel({ ephemeral: true });
```

## TypeScript Configuration

Nexus uses ESM modules. Your `tsconfig.json` should include:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true
  }
}
```
