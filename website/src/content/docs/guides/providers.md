---
title: Model Providers
description: Configure and use 20+ AI model providers with zero lock-in.
---

# Model Providers

Kernova is **model-agnostic**. Your application code doesn't change when you switch providers. Set an environment variable — that's it.

## Why This Matters

- **No vendor lock-in** — Switch from OpenAI to Anthropic by changing one env var
- **Cost optimization** — Use cheap models for simple tasks, expensive for complex
- **Resilience** — If one provider is down, fall back automatically
- **Local development** — Use Ollama (free, offline) while coding
- **Future-proof** — New providers work without code changes

## Supported Providers

### Cloud Providers (API key required)

| Provider | Variable | Default Model | Best For |
|----------|----------|---------------|----------|
| OpenAI | `OPENAI_API_KEY` | gpt-4o | General purpose, vision, tool calling |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4 | Long-form reasoning, code |
| Google Gemini | `GEMINI_API_KEY` | gemini-2.0-flash | Large context (1M tokens), multimodal |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat | Cost-effective reasoning |
| Groq | `GROQ_API_KEY` | llama-3.1-70b | Ultra-fast inference |
| Mistral | `MISTRAL_API_KEY` | mistral-large | European data residency |
| xAI (Grok) | `XAI_API_KEY` | grok-2 | Real-time information |
| Cohere | `COHERE_API_KEY` | command-r-plus | RAG and search |
| Together AI | `TOGETHER_API_KEY` | Llama 3.1 70B | 100+ open models |
| OpenRouter | `OPENROUTER_API_KEY` | Any model | Access everything through one API |
| Fireworks | `FIREWORKS_API_KEY` | Llama 3.1 70B | Fast open-model inference |
| Perplexity | `PERPLEXITY_API_KEY` | sonar-large | Search-augmented responses |
| Cerebras | `CEREBRAS_API_KEY` | llama3.1-70b | Ultra-fast inference |
| SambaNova | `SAMBANOVA_API_KEY` | Llama 3.1 70B | Fast inference |

### Local Providers (no key needed)

| Provider | Setup | Best For |
|----------|-------|----------|
| Ollama | `ollama serve && ollama pull llama3.1` | Free local development |
| LM Studio | Download from lmstudio.ai | GUI for local models |
| vLLM | `python -m vllm.entrypoints.openai.api_server` | Self-hosted production |
| llama.cpp | `./server -m model.gguf` | Minimal self-hosted |

## How Auto-Detection Works

When the kernel starts, it:
1. Scans all known environment variable names
2. Creates a provider for each one that's set
3. Registers them with the model router
4. Picks the first available as the default

```typescript
// You just set the env var — Kernova does the rest
// export OPENAI_API_KEY=sk-...
// export ANTHROPIC_API_KEY=sk-ant-...

const app = await Kernova.create();
// → Both OpenAI and Anthropic available
// → OpenAI used as default (first detected)
```

## Configuring Model Routing

### Default + fallback

```typescript
const kernel = new KernovaKernel({
  environment: 'development',
  models: {
    default: { provider: 'openai', model: 'gpt-4o' },
    fallback: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  },
});
```

If OpenAI fails (rate limit, outage), Kernova automatically tries Anthropic.

### Explicit provider creation

```typescript
import { createProvider } from '@kernova/core';

const deepseek = createProvider('deepseek');
const groq = createProvider('groq', { defaultModel: 'llama-3.1-8b-instant' });
const local = createProvider('ollama', { defaultModel: 'mistral' });
```

## Adding a Custom Provider

Any server that implements the OpenAI `/chat/completions` format works. Add to `Kernova.config.json`:

```json
{
  "providers": [
    {
      "id": "my-company-llm",
      "name": "Internal LLM",
      "adapter": "openai",
      "baseUrl": "https://llm.internal.company.com/v1",
      "apiKeyEnv": "INTERNAL_LLM_KEY",
      "defaultModel": "company-model-v2",
      "timeoutMs": 60000
    }
  ]
}
```

**Zero code change.** Just config.

## Programmatic Custom Provider

For providers that DON'T use the OpenAI format:

```typescript
import { OpenAICompatibleProvider } from '@kernova/core';

const custom = new OpenAICompatibleProvider({
  id: 'my-custom',
  name: 'My Custom Provider',
  baseUrl: 'https://api.custom.com/v1',
  apiKey: process.env.CUSTOM_KEY || '',
  defaultModel: 'custom-model',
  headers: { 'X-Custom-Header': 'value' },
});
```

## Token Tracking

Every model call tracks token usage:

```typescript
const status = kernel.getStatus();
console.log(status.modelUsage);
// {
//   usage: { promptTokens: 5000, completionTokens: 2000, totalTokens: 7000 },
//   requestCount: 15,
// }
```

This feeds into the [budget system](/guides/budgets/) for cost control.

## Streaming

All OpenAI-compatible providers support streaming natively (SSE parsing). Others simulate streaming by splitting the response into chunks:

```typescript
for await (const token of app.stream('Write a poem')) {
  process.stdout.write(token);
}
```

See the [Streaming guide](/guides/streaming/) for details.

## Best Practices

1. **Set multiple keys** — Gives you fallback when one provider has issues
2. **Use Ollama for development** — Free, fast, no API key hassles
3. **Use cheap models for simple tasks** — Not every question needs GPT-4o
4. **Monitor token usage** — Check `kernel.getStatus().modelUsage` regularly
5. **Test with different providers** — Ensure your prompts work across models
