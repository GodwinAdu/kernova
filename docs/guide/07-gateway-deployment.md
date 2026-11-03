# Gateway & Deployment

The Agent Gateway turns your Kernova agents into a production HTTP service. It exposes an OpenAI-compatible API, a native intent API, and webhook endpoints — all with built-in auth, rate limiting, and CORS.

## Quick Start

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'production' });
await kernel.start();

// Register an agent
const agent = defineAgent({
  name: 'assistant',
  description: 'General assistant',
  capabilities: [{ id: 'general', name: 'General', description: 'Handles any question', confidence: 0.9 }],
  tools: [],
  instructions: 'You are a helpful AI assistant.',
});
kernel.agentRegistry.register(agent.definition, agent.executor);

// Start the gateway
await kernel.gateway.start();
// Server listening on http://0.0.0.0:3000
```

## Configuration

```typescript
import { AgentGateway } from '@kernova/core';

// The gateway is auto-created with the kernel, but you can configure it:
const kernel = new KernovaKernel({ environment: 'production' });
await kernel.start();

// Access the gateway (auto-configured with defaults)
await kernel.gateway.start();
console.log(`Gateway running on port ${kernel.gateway.port}`);
```

For custom configuration, construct the gateway separately:

```typescript
import { AgentGateway } from '@kernova/core';

const gateway = new AgentGateway(kernel, kernel.events, {
  port: 8080,
  host: '0.0.0.0',
  auth: {
    tokens: ['sk-my-secret-token', 'sk-another-token'],
    allowAnonymous: false,
  },
  cors: true,
  maxBodyBytes: 2_097_152, // 2MB
});

await gateway.start();
```

## API Endpoints

### POST /v1/intents — Native Intent API

Submit an intent directly to the Kernova runtime.

```bash
curl -X POST http://localhost:3000/v1/intents \
  -H "Authorization: Bearer sk-my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Summarize the latest sales report",
    "type": "query",
    "priority": "high",
    "metadata": { "source": "dashboard" }
  }'
```

Response:
```json
{
  "id": "intent_abc123",
  "status": "completed",
  "result": {
    "success": true,
    "summary": "Sales increased 15% this quarter...",
    "evidence": { ... },
    "durationMs": 2340
  }
}
```

### POST /v1/chat/completions — OpenAI-Compatible

Drop-in replacement for OpenAI's chat completions endpoint. Works with any OpenAI SDK client.

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "What is TypeScript?" }
    ]
  }'
```

Response (OpenAI format):
```json
{
  "id": "chatcmpl-intent_xyz",
  "object": "chat.completion",
  "created": 1720000000,
  "model": "kernova",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "TypeScript is a typed superset of JavaScript..."
    },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

Using the OpenAI Node.js SDK:
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-my-secret-token',
});

const response = await client.chat.completions.create({
  model: 'kernova',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### POST /hooks/:path — Webhook Routing

Forward external webhooks to agents. See the [Webhook Router](#webhook-routing) section below.

### GET /health — Health Check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "running": true,
  "agents": 3,
  "activeIntents": 0
}
```

## Authentication

The gateway supports Bearer token authentication:

```typescript
// In config:
auth: {
  tokens: ['sk-prod-token-1', 'sk-prod-token-2'],
  allowAnonymous: false,
}
```

Requests must include the header:
```
Authorization: Bearer sk-prod-token-1
```

For development, set `allowAnonymous: true` to skip auth checks.

## Webhook Routing

Register routes to convert incoming webhooks into agent intents:

```typescript
// Register a GitHub webhook
kernel.webhooks.register({
  path: '/hooks/github',
  method: 'POST',
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  transform: {
    signatureHeader: 'x-hub-signature-256',
    signatureAlgorithm: 'sha256',
  },
  target: {
    type: 'intent',
    goal: 'Process incoming GitHub event',
    priority: 'high',
  },
  enabled: true,
});

// Register a Stripe webhook
kernel.webhooks.register({
  path: '/hooks/stripe',
  method: 'POST',
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  transform: {
    signatureHeader: 'stripe-signature',
    signatureAlgorithm: 'sha256',
  },
  target: {
    type: 'agent',
    agentName: 'billing-agent',
    goal: 'Handle Stripe payment event',
  },
  enabled: true,
});
```

When a webhook hits `/hooks/github`, the gateway:
1. Verifies the HMAC signature
2. Parses the JSON body
3. Submits an intent with the webhook payload as metadata
4. Returns 200 OK

## Graceful Shutdown

```typescript
// The gateway stops cleanly during kernel shutdown:
await kernel.stop(); // Stops gateway, then all other modules

// Or stop the gateway independently:
await kernel.gateway.stop();
```
