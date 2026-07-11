---
title: "API Gateway"
description: Expose Kernova agents as HTTP APIs — OpenAI-compatible chat endpoint, native intent API, webhook routing, and bearer token authentication.
---

The `AgentGateway` turns your Kernova kernel into an HTTP service. Any application that can make HTTP requests — frontends, mobile apps, third-party integrations, or other microservices — can submit intents, chat with agents, and receive webhooks through a clean REST interface.

The gateway (from `packages/core/src/gateway/agent-gateway.ts`) provides:

- **OpenAI-compatible chat endpoint** — Drop-in replacement for `POST /v1/chat/completions`
- **Native intent API** — Submit intents with full control over type, priority, and metadata
- **Webhook routing** — Forward incoming webhooks to registered handlers
- **Bearer token authentication** — Protect endpoints with token-based auth
- **CORS support** — Pre-configured for browser-based clients

---

## Quick Start

### Start the Gateway

```typescript
import { KernovaKernel } from '@kernova/core';
import { AgentGateway } from '@kernova/core/gateway';

const kernel = new KernovaKernel({
  ephemeral: false,
  dataDir: './data',
  environment: 'production',
});
await kernel.start();

const gateway = new AgentGateway(kernel, kernel.events, {
  port: 3000,
  host: '0.0.0.0',
  auth: {
    tokens: ['sk-my-secret-token'],
    allowAnonymous: false,
  },
  cors: true,
  maxBodyBytes: 1_048_576, // 1MB
});

await gateway.start();
console.log(`Gateway listening on port ${gateway.port}`);
```

### Make Requests

```bash
# Health check
curl http://localhost:3000/health

# Submit an intent (native API)
curl -X POST http://localhost:3000/v1/intents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-my-secret-token" \
  -d '{"goal": "Summarize the latest support tickets", "type": "query", "priority": "medium"}'

# Chat completion (OpenAI-compatible)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-my-secret-token" \
  -d '{
    "model": "kernova",
    "messages": [
      {"role": "user", "content": "What are the open issues this week?"}
    ]
  }'
```

---

## Endpoints Reference

### GET /health

Returns the current state of the kernel. No authentication required when `allowAnonymous` is true.

**Response:**

```json
{
  "status": "ok",
  "running": true,
  "agents": 3,
  "activeIntents": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` when the gateway is responding |
| `running` | `boolean` | Whether the kernel is running |
| `agents` | `number` | Count of registered agents |
| `activeIntents` | `number` | Currently executing intents |

---

### POST /v1/intents

Submit an intent directly to the kernel. This is the native Kernova API — use it when you need full control over intent parameters.

**Request:**

```json
{
  "goal": "Deploy the staging environment",
  "type": "action",
  "priority": "high",
  "owner": "user-123",
  "metadata": { "environment": "staging", "version": "2.1.0" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `goal` | `string` | Yes | What the agent should accomplish |
| `type` | `"query" \| "action"` | No | Intent classification |
| `priority` | `"low" \| "medium" \| "high" \| "critical"` | No | Execution priority |
| `owner` | `string` | No | Identifier of the requesting user/system |
| `metadata` | `object` | No | Arbitrary key-value data attached to the intent |

**Response:**

```json
{
  "id": "int_a1b2c3d4",
  "status": "completed",
  "result": {
    "success": true,
    "summary": "Staging environment deployed successfully.",
    "actions": ["deployed v2.1.0 to staging"]
  }
}
```

**Error (400):**

```json
{ "error": "Missing required field: goal" }
```

---

### POST /v1/chat/completions

OpenAI-compatible chat completions endpoint. The gateway extracts the last user message, submits it as a query intent, and returns the result in the standard OpenAI response shape.

**Request:**

```json
{
  "model": "kernova",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What deployments happened today?" }
  ]
}
```

**Response:**

```json
{
  "id": "chatcmpl-int_a1b2c3d4",
  "object": "chat.completion",
  "created": 1720000000,
  "model": "kernova",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "There were 2 deployments today: v2.1.0 to staging at 10:30 AM and v2.0.9 hotfix to production at 2:15 PM."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

**Error (400):**

```json
{ "error": "Missing required field: messages" }
```

---

### POST /hooks/:path

Forward incoming webhooks to the kernel's `WebhookRouter`. The `:path` segment is matched against registered webhook routes.

**Request:**

```bash
curl -X POST http://localhost:3000/hooks/github/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-my-secret-token" \
  -H "X-GitHub-Event: push" \
  -d '{"ref": "refs/heads/main", "commits": [...]}'
```

**Response (matched):**

```json
{ "ok": true }
```

**Response (no route):**

```json
{ "error": "No matching webhook route" }
```

The webhook handler passes the full request context (method, path, headers, body) to the kernel's webhook system, which dispatches to the appropriate agent.

---

## OpenAI Compatibility

The `/v1/chat/completions` endpoint is a drop-in replacement for the OpenAI Chat API. Any SDK or tool that targets OpenAI can point at your gateway instead.

### Using the OpenAI Node SDK

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-my-secret-token',
});

const response = await client.chat.completions.create({
  model: 'kernova',
  messages: [
    { role: 'user', content: 'List all active alerts' },
  ],
});

console.log(response.choices[0].message.content);
```

### Using the OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-my-secret-token",
)

response = client.chat.completions.create(
    model="kernova",
    messages=[{"role": "user", "content": "List all active alerts"}],
)

print(response.choices[0].message.content)
```

### Using curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-my-secret-token" \
  -d '{"model":"kernova","messages":[{"role":"user","content":"Hello"}]}'
```

The `model` field is accepted but ignored — the kernel routes to whichever agent is appropriate for the intent. This means you can swap in Kernova behind any OpenAI-compatible client without code changes.

---

## Authentication

The gateway supports bearer token authentication. Tokens are validated against the `auth.tokens` array in the gateway config.

### Configuration

```typescript
const gateway = new AgentGateway(kernel, kernel.events, {
  auth: {
    tokens: ['sk-prod-token-1', 'sk-prod-token-2'],
    allowAnonymous: false,
  },
});
```

### How It Works

1. The gateway reads the `Authorization` header from each request
2. It expects the format `Bearer <token>`
3. The token is checked against the `tokens` array
4. If matched, the request proceeds; otherwise, a `401 Unauthorized` response is returned

### Development Mode

For local development, set `allowAnonymous: true` to skip authentication entirely:

```typescript
const gateway = new AgentGateway(kernel, kernel.events, {
  auth: { allowAnonymous: true },
});
```

When `allowAnonymous` is true, requests without an `Authorization` header are accepted. Requests with an invalid token are still rejected — the flag only permits *missing* auth, not wrong auth.

### Multiple Tokens

Use multiple tokens to support key rotation or multi-tenant access:

```typescript
auth: {
  tokens: [
    process.env.GATEWAY_TOKEN_PRIMARY!,
    process.env.GATEWAY_TOKEN_SECONDARY!, // Rotate without downtime
  ],
  allowAnonymous: false,
}
```

---

## CORS Configuration

CORS is enabled by default. When active, the gateway adds the following headers to every response:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

Preflight `OPTIONS` requests receive a `204 No Content` response with these headers.

### Disabling CORS

If the gateway sits behind a reverse proxy that handles CORS, disable it at the gateway level:

```typescript
const gateway = new AgentGateway(kernel, kernel.events, {
  cors: false,
});
```

### Custom CORS via Reverse Proxy

For production deployments with specific origin requirements, disable gateway CORS and configure your reverse proxy:

```nginx
# nginx.conf
location /v1/ {
    add_header Access-Control-Allow-Origin "https://app.example.com";
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
    add_header Access-Control-Allow-Headers "Content-Type, Authorization";

    if ($request_method = 'OPTIONS') {
        return 204;
    }

    proxy_pass http://127.0.0.1:3000;
}
```

---

## Webhook Routing

The `POST /hooks/:path` endpoint connects incoming HTTP webhooks to the kernel's `WebhookRouter`. This lets external services (GitHub, Stripe, Slack, etc.) trigger agent behavior via HTTP callbacks.

### How It Works

1. An external service sends a POST to `/hooks/github/push`
2. The gateway extracts the path, headers, and body
3. It calls `kernel.webhooks.handle()` with the full request context
4. The `WebhookRouter` matches the path against registered webhook routes
5. If matched, the associated agent is triggered with the webhook payload

### Registering Webhook Routes

Webhook routes are registered through agent configs or programmatically:

```typescript
kernel.webhooks.register({
  path: '/hooks/github/push',
  agentId: 'deploy-agent',
  transform: (payload) => ({
    goal: `Process push to ${payload.ref}`,
    metadata: { commits: payload.commits },
  }),
});
```

### Header Forwarding

All request headers are forwarded to the webhook handler. Use this for signature verification:

```typescript
kernel.webhooks.register({
  path: '/hooks/stripe/invoice',
  agentId: 'billing-agent',
  verify: (headers, body) => {
    const signature = headers['stripe-signature'];
    return verifyStripeSignature(body, signature, webhookSecret);
  },
});
```

### Path Matching

The full URL path (including `/hooks/`) is passed to the webhook router. Register routes with the complete path:

```
POST /hooks/github/push     → matches route '/hooks/github/push'
POST /hooks/slack/events    → matches route '/hooks/slack/events'
POST /hooks/custom/my-hook  → matches route '/hooks/custom/my-hook'
```

---

## Integration with Process Managers

The gateway integrates cleanly with the Kernova daemon and process managers.

### With DaemonRunner

When using the daemon, pass the gateway port in the daemon config:

```typescript
import { KernovaKernel } from '@kernova/core';
import { DaemonRunner } from '@kernova/core/daemon';
import { AgentGateway } from '@kernova/core/gateway';

const kernel = new KernovaKernel({ ephemeral: false, environment: 'production' });
await kernel.start();

const gateway = new AgentGateway(kernel, kernel.events, {
  port: 3000,
  auth: { tokens: [process.env.GATEWAY_TOKEN!], allowAnonymous: false },
});
await gateway.start();

const daemon = new DaemonRunner(kernel, {
  configPath: './agents/',
  watch: true,
  shutdownTimeoutMs: 30000,
});

// Stop gateway on daemon shutdown
kernel.events.subscribe('daemon.stopping', async () => {
  await gateway.stop();
});

await daemon.start();
```

### Gateway Lifecycle Events

The gateway emits events on the kernel's EventBus:

| Event | Data | When |
|-------|------|------|
| `gateway.started` | `{ port, host }` | Server is listening |
| `gateway.stopped` | `{}` | Server has closed |

```typescript
kernel.events.subscribe('gateway.started', (event) => {
  console.log(`Gateway ready on ${event.data.host}:${event.data.port}`);
});
```

### Health Checks in Docker

```dockerfile
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1))"
```

---

## Best Practices

### Put a Reverse Proxy in Front

Never expose the gateway directly to the internet. Use nginx, Caddy, or a cloud load balancer:

```nginx
upstream kernova {
    server 127.0.0.1:3000;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /etc/ssl/certs/api.pem;
    ssl_certificate_key /etc/ssl/private/api.key;

    location / {
        proxy_pass http://kernova;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### TLS Termination

Terminate TLS at the reverse proxy or load balancer, not at the gateway. The gateway speaks plain HTTP by design — it trusts the proxy layer for encryption.

### Rate Limiting at the Edge

Apply rate limits at your reverse proxy or API gateway (e.g., nginx `limit_req`, AWS API Gateway throttling, Cloudflare rate rules). The Kernova gateway doesn't include built-in rate limiting — this keeps the core simple and lets you use whatever rate-limiting strategy fits your infrastructure.

```nginx
# nginx rate limiting
limit_req_zone $binary_remote_addr zone=kernova:10m rate=100r/m;

location /v1/ {
    limit_req zone=kernova burst=20 nodelay;
    proxy_pass http://127.0.0.1:3000;
}
```

### Body Size Limits

The `maxBodyBytes` config (default: 1MB) protects against oversized payloads. Adjust based on your webhook payload sizes:

```typescript
const gateway = new AgentGateway(kernel, kernel.events, {
  maxBodyBytes: 5 * 1_048_576, // 5MB for large webhook payloads
});
```

If a request exceeds the limit, the body parser returns `null` and the endpoint responds with a `400` error.

### Token Management

- Store tokens in environment variables, never in source code
- Rotate tokens regularly — use the multi-token config for zero-downtime rotation
- Use distinct tokens per client for audit trails (combine with request logging at the proxy)
- Set `allowAnonymous: false` in production — always

### Monitoring

```typescript
// Log all gateway activity via events
kernel.events.subscribe('gateway.*', (event) => {
  console.log(`[gateway] ${event.eventType}`, event.data);
});
```

### Anti-Patterns

- ❌ Exposing the gateway directly to the internet without TLS
- ❌ Using `allowAnonymous: true` in production
- ❌ Hardcoding tokens in source code
- ❌ Setting `maxBodyBytes` to 0 or extremely high values
- ❌ Running multiple gateway instances on the same port

---

## GatewayConfig Reference

```typescript
interface GatewayConfig {
  /** Port to listen on (default: 3000) */
  port?: number;

  /** Host to bind to (default: '0.0.0.0') */
  host?: string;

  /** Authentication configuration */
  auth?: {
    /** Bearer tokens that grant access */
    tokens?: string[];
    /** Allow unauthenticated requests (default: false in production) */
    allowAnonymous?: boolean;
  };

  /** Enable CORS headers (default: true) */
  cors?: boolean;

  /** Max request body size in bytes (default: 1,048,576 = 1MB) */
  maxBodyBytes?: number;
}
```

---

## Next Steps

- [Daemon Mode](/guides/daemon) — Run the gateway as part of a persistent background service
- [Building Agents](/guides/agents) — Define agents that the gateway exposes as API endpoints
- [Channels & Adapters](/guides/channels) — Connect agents to Slack, email, and other services alongside HTTP
- [Configuration](/guides/configuration) — Full kernel and gateway configuration reference
