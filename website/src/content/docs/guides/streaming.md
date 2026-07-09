---
title: Streaming Responses
description: Real-time token-by-token streaming from LLMs.
---

# Streaming Responses

Kernova supports streaming LLM responses token-by-token so users see output immediately instead of waiting for the full response.

## SDK Streaming

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('writer', { instructions: 'You write engaging stories.' });

// Stream tokens as they arrive
for await (const token of app.stream('Write a short story about a robot')) {
  process.stdout.write(token);
}

await app.close();
```

## Agent Executor Streaming

Inside custom agent executors:

```typescript
async execute(intent, context, tools) {
  let fullResponse = '';

  // Stream from the LLM
  for await (const token of tools.stream(intent.goal)) {
    fullResponse += token;
    // Could send to a websocket, update UI, etc.
  }

  return {
    success: true,
    summary: fullResponse,
    evidence: { sources: [], confidence: 0.85 },
    durationMs: 0,
  };
}
```

## Collect Stream as String

If you want streaming performance but don't need to process each token:

```typescript
const response = await tools.streamToString(intent.goal);
```

This streams internally (fast first-token) but returns the complete string.

## How It Works

1. Kernova sends the request to the model provider with `stream: true`
2. Provider returns Server-Sent Events (SSE) with partial responses
3. Each chunk is parsed and yielded as a string token
4. Token usage is reported in the final chunk

## Provider Support

| Provider | Streaming |
|----------|-----------|
| OpenAI | ✓ Native SSE |
| OpenAI-compatible (DeepSeek, Groq, etc.) | ✓ Native SSE |
| Anthropic | Simulated (word-by-word from full response) |
| Gemini | Simulated |
| Ollama | Simulated |

Providers without native streaming still work — the router simulates streaming by splitting the full response into chunks.

## Stream Chunks (Advanced)

For low-level control, use the ModelRouter directly:

```typescript
const router = kernel.models;

for await (const chunk of router.stream({
  messages: [{ role: 'user', content: 'Hello' }],
  model: 'gpt-4o',
})) {
  // chunk.content — text in this chunk
  // chunk.done — is this the last chunk?
  // chunk.usage — token counts (only in final chunk)
  // chunk.finishReason — 'stop', 'length', 'tool_call'
}
```
