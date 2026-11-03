# Configuration

## kernova.config.json

Every Kernova project has a `kernova.config.json` at its root:

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "runtime": {
    "environment": "development",
    "debug": true
  },
  "agents": [],
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
    }
  },
  "providers": [],
  "budget": {
    "maxTokens": 1000000,
    "maxCostUsd": 50.00,
    "requestsPerMinute": 60
  }
}
```

## Environment Variables

| Variable | Provider |
|---|---|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GEMINI_API_KEY` | Google Gemini |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `TOGETHER_API_KEY` | Together AI |
| `MISTRAL_API_KEY` | Mistral AI |
| `COHERE_API_KEY` | Cohere |
| `XAI_API_KEY` | xAI (Grok) |
| `OPENROUTER_API_KEY` | OpenRouter |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `PERPLEXITY_API_KEY` | Perplexity |
| `CEREBRAS_API_KEY` | Cerebras |
| `SAMBANOVA_API_KEY` | SambaNova |

Local providers (Ollama, LM Studio, vLLM) don't require API keys.

## Custom Providers

Add any OpenAI-compatible provider in `kernova.config.json`:

```json
{
  "providers": [
    {
      "id": "my-provider",
      "name": "My Custom LLM",
      "adapter": "openai",
      "baseUrl": "https://my-llm.example.com/v1",
      "apiKeyEnv": "MY_PROVIDER_KEY",
      "defaultModel": "my-model"
    }
  ]
}
```

## Data Directory

Kernova stores persistent data (events, memory, embeddings) in `./kernova-data/` by default. Configure with:

```typescript
new KernovaKernel({ dataDir: '/custom/path' });
```

Or disable persistence entirely:

```typescript
new KernovaKernel({ ephemeral: true });
```
