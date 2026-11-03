---
title: Gateway & API Server
description: Deploy your agents as an HTTP API with OpenAI-compatible endpoints.
---

The Agent Gateway exposes your Kernova agents as a production HTTP service — complete with authentication, rate limiting, OpenAI-compatible chat API, and webhook support.

## Starting the Gateway

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'production' });
await kernel.start();

// Register your agents
const agent = defineAgent({
  name: 'assistant',
  description: 'Production assistant',
  capabilities: [{ id: 'general', name: 'General', description: 'Handles questions', confidence: 0.9 }],
  tools: [],
  instructions: 'You are a helpful production assistant.',
});
kernel.agentRegistry.register(agent.definition, agent.executor);

// Start the HTTP server (a bearer token is required; KERNOVA_API_KEY also works)
await kernel.gateway.start({ auth: { tokens: [process.env.GATEWAY_TOKEN!] } });
console.log(`🚀 Kernova gateway running on http://127.0.0.1:3000`);
```

Your agents are now accessible over HTTP. The gateway listens on `127.0.0.1` by default; set `host: '0.0.0.0'` to accept connections from other machines. See the [API Gateway guide](/guides/gateway-api/) for every option.

## Endpoints

### `POST /v1/intents` — Submit an Intent

The native Kernova API. Send a goal, get a result.

**Request:**
```json
{
  "goal": "What are the top 3 JavaScript frameworks in 2026?",
  "type": "query",
  "priority": "medium"
}
```

**Response:**
```json
{
  "id": "intent_a1b2c3",
  "status": "completed",
  "result": {
    "success": true,
    "summary": "The top 3 JavaScript frameworks in 2026 are...",
    "durationMs": 1850
  }
}
```

**cURL example:**
```bash
curl -X POST http://localhost:3000/v1/intents \
  -H "Authorization: Bearer sk-your-token" \
  -H "Content-Type: application/json" \
  -d '{"goal": "Explain quantum computing simply"}'
```

### `POST /v1/chat/completions` — OpenAI-Compatible

Drop-in replacement for the OpenAI chat API. Use any OpenAI client library.

**With the OpenAI SDK:**
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-your-token',
});

const response = await client.chat.completions.create({
  model: 'kernova',  // Model name is informational only
  messages: [
    { role: 'system', content: 'You are a code reviewer.' },
    { role: 'user', content: 'Review this function...' },
  ],
});

console.log(response.choices[0].message.content);
```

**With Python:**
```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="sk-your-token")
response = client.chat.completions.create(
    model="kernova",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### `GET /health` — Health Check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "running": true,
  "agents": 3,
  "activeIntents": 1
}
```

### `POST /hooks/:path` — Webhooks

Receives external webhooks and routes them to agents. See the [Webhooks section in Advanced Platform Features](/guides/advanced-platform/#webhook-router).

## Authentication

### Token-Based Auth

```typescript
// Configure auth tokens
await kernel.gateway.start({
  port: 8080,
  auth: {
    tokens: ['sk-prod-key-1', 'sk-prod-key-2'],
  },
});
```

All requests must include:
```
Authorization: Bearer sk-prod-key-1
```

Without any token configured (and no `KERNOVA_API_KEY`), `start()` throws rather than serving an open API.

### Development Mode

For local development, allow unauthenticated access:
```typescript
auth: { allowAnonymous: true }
```

Browser requests are still refused unless their origin is listed in `cors`, so other websites can't call your local gateway.

:::caution
Never use `allowAnonymous: true` in production. The [Security Auditor](/guides/security/) will flag this.
:::

## Rate Limiting

Rate limits are enforced per intent owner through the kernel's Rate Limiter. By default each named owner gets 100 requests per minute; requests without an owner run as `system`, which is only limited by an explicit rule:

```typescript
// Configure before starting the gateway: 100 requests/minute for every owner, including "system"
kernel.rateLimiter.addRule({
  id: 'api-limit',
  scope: 'identity',
  key: '*',
  maxRequests: 100,
  windowMs: 60_000,
});
```

Change the defaults with `KernelConfig.rateLimits`, for example `rateLimits: { defaultMaxRequests: 30 }`.

When rate limited, the gateway returns:
```json
{ "error": "Rate limit exceeded. Try again later." }
```

## CORS

CORS is off by default. List the origins of browser apps that call the gateway:

```typescript
await kernel.gateway.start({
  auth: { tokens: [process.env.GATEWAY_TOKEN!] },
  cors: ['https://app.example.com'],
});
```

## Deployment

### Docker

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Environment Variables

```bash
KERNOVA_PORT=3000
KERNOVA_AUTH_TOKEN=sk-production-secret
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Vercel / Serverless

The gateway uses a standard Node.js HTTP server. For serverless, wrap individual intent submissions:

```typescript
// api/chat.ts (Vercel Edge Function)
export default async function handler(req) {
  const { messages } = await req.json();
  const kernel = getKernel(); // singleton
  const intent = await kernel.submit({ goal: messages.at(-1).content });
  return Response.json({ response: intent.result?.summary });
}
```
