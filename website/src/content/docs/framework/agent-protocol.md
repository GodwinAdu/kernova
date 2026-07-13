---
title: "Agent Protocol (KAP)"
description: "Cross-organization agent communication — connect your agent to agents from any company."
---

# Kernova Agent Protocol (KAP)

KAP is an open protocol for **cross-organization agent communication**. Your Kernova agent can discover, authenticate, and talk to agents from Vercel, Stripe, GitHub, or any company that implements the protocol.

Think of it like HTTP for agents — a standard way for agents to find each other and exchange messages.

---

## The Vision

```
┌─────────────┐       KAP/1.0        ┌──────────────┐
│ Your Agent  │◄─────────────────────►│ Vercel Agent │
│ (Kernova)   │                       │ (Vercel)     │
└─────────────┘                       └──────────────┘
       ↕                                      ↕
       │         KAP/1.0                      │
       ↕                                      ↕
┌─────────────┐                       ┌──────────────┐
│Stripe Agent │                       │GitHub Agent  │
│ (Stripe)    │                       │ (GitHub)     │
└─────────────┘                       └──────────────┘
```

Your agent says "deploy my app" → talks to Vercel's agent → Vercel deploys → returns the URL.

---

## Quick Start: Call a Remote Agent

### 1. Define the remote agent connection

```typescript
// agents/remotes/vercel.ts
import { defineRemoteAgent } from '@kernova/framework';

export default defineRemoteAgent({
  name: 'vercel',
  description: 'Vercel deployment agent',
  endpoint: 'https://agents.vercel.com',
  auth: {
    type: 'bearer',
    token: process.env.VERCEL_AGENT_KEY!,
  },
});
```

### 2. Use it in your agent

```typescript
// agents/my-agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'my-agent',
  instructions: 'You help users manage their projects.',
  remoteAgents: ['vercel'], // Declare which remote agents you use

  handler: async (ctx) => {
    if (ctx.input.includes('deploy')) {
      // Talk to Vercel's agent
      const result = await ctx.askRemote('vercel', 'Deploy my-app to production');
      return { content: `Vercel says: ${result}` };
    }

    return { content: 'How can I help?' };
  },
});
```

That's it. Your agent talks to Vercel's agent as naturally as calling a function.

---

## Quick Start: Expose Your Agent

Make your agent available for other organizations to call:

```typescript
// kernova.config.ts
import { defineConfig } from '@kernova/framework';

export default defineConfig({
  name: 'support-agent',

  expose: {
    enabled: true,
    organization: 'Acme Inc',
    description: 'Customer support agent — answers product questions',
    capabilities: [
      {
        id: 'ask',
        name: 'Ask Question',
        description: 'Ask a customer support question',
      },
      {
        id: 'create-ticket',
        name: 'Create Ticket',
        description: 'Create a support ticket',
        inputSchema: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['subject', 'body'],
        },
      },
    ],
    auth: [{ type: 'api-key', in: 'header', name: 'X-API-Key' }],
    allowedKeys: [process.env.PARTNER_API_KEY!],
    rateLimit: { requestsPerMinute: 30, requestsPerDay: 1000 },
    tags: ['support', 'customer-service', 'tickets'],
  },
});
```

This serves your agent card at:
```
GET https://your-agent.com/.well-known/agent.json
```

Other agents discover your agent, authenticate, and call it.

---

## How Discovery Works

### Agent Card (`.well-known/agent.json`)

Every KAP-compatible agent publishes a JSON file describing itself:

```json
{
  "protocol": "kap/1.0",
  "agent": {
    "id": "acme-support",
    "name": "Acme Support Agent",
    "description": "Handles customer support for Acme products",
    "organization": "Acme Inc",
    "version": "1.0.0",
    "tags": ["support", "tickets", "faq"]
  },
  "endpoint": "https://support.acme.com/v1/ask",
  "auth": [
    { "type": "api-key", "in": "header", "name": "X-API-Key" }
  ],
  "capabilities": [
    {
      "id": "ask",
      "name": "Ask Question",
      "description": "Ask a customer support question"
    },
    {
      "id": "create-ticket",
      "name": "Create Ticket",
      "description": "Create a support ticket"
    }
  ],
  "rateLimit": {
    "requestsPerMinute": 30,
    "requestsPerDay": 1000
  }
}
```

### Discovery Flow

```
1. Your agent wants to talk to Acme's support agent
2. Fetches: GET https://support.acme.com/.well-known/agent.json
3. Gets the agent card (endpoint, auth, capabilities)
4. Authenticates (API key, OAuth, etc.)
5. Sends KAP request to the endpoint
6. Gets structured response back
```

---

## Request/Response Format

### Sending a Request

```json
{
  "id": "req_1234567890_abc",
  "protocol": "kap/1.0",
  "from": {
    "id": "my-agent",
    "name": "My Agent",
    "organization": "My Company"
  },
  "capability": "ask",
  "input": "What's the status of order #12345?",
  "context": {
    "threadId": "thread_abc",
    "metadata": { "customerId": "cust_123" }
  },
  "timeout": 30000,
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### Getting a Response

```json
{
  "requestId": "req_1234567890_abc",
  "protocol": "kap/1.0",
  "status": "success",
  "output": "Order #12345 was shipped yesterday and will arrive tomorrow.",
  "data": {
    "orderId": "12345",
    "status": "shipped",
    "eta": "2025-01-16"
  },
  "metadata": {
    "durationMs": 1200,
    "model": "gpt-4o",
    "capabilities_used": ["ask"]
  },
  "timestamp": "2025-01-15T10:30:01Z"
}
```

---

## Authentication

KAP supports multiple auth methods:

| Method | Usage | Example |
|---|---|---|
| `api-key` | Simple key in header | `X-API-Key: sk-abc123` |
| `bearer` | Token in Authorization header | `Authorization: Bearer tok-xyz` |
| `oauth2` | OAuth 2.0 flow | Standard OAuth with scopes |
| `none` | Public agent (no auth) | Anyone can call |

```typescript
defineRemoteAgent({
  name: 'stripe',
  endpoint: 'https://agents.stripe.com',
  auth: {
    type: 'bearer',
    token: process.env.STRIPE_AGENT_TOKEN!,
  },
});
```

---

## Kernova Agent Registry

Kernova Cloud hosts a global agent registry. Agents can register themselves to be discoverable by other agents worldwide.

### Register Your Agent

When you deploy with `expose.registerInRegistry: true`, your agent is automatically registered in the Kernova Cloud registry.

### Discover Agents

```typescript
import { defineRemoteAgent } from '@kernova/framework';

// Auto-discover from registry (no hardcoded URL needed)
export default defineRemoteAgent({
  name: 'stripe-billing',
  discover: true, // Looks up in Kernova registry
  auth: {
    type: 'api-key',
    token: process.env.STRIPE_AGENT_KEY!,
  },
});
```

### Search the Registry

```typescript
import { KAPRegistry } from '@kernova/core';

const registry = new KAPRegistry({
  registryUrl: 'https://registry.kernova.dev',
  registryKey: process.env.KERNOVA_REGISTRY_KEY,
});

// Find agents by capability
const deployAgents = await registry.discover({
  capability: 'deploy',
  onlineOnly: true,
  minTrustScore: 0.8,
});

// Find agents by organization
const stripeAgents = await registry.discover({
  organization: 'Stripe',
});

// Search by keywords
const results = await registry.discover({
  query: 'payment processing',
  tags: ['billing', 'payments'],
});
```

---

## Trust & Safety

### Trust Scores

Every agent in the registry has a trust score (0–1) based on:
- Uptime (is it consistently available?)
- Response quality (does it return valid KAP responses?)
- Interaction history (how many successful calls?)

```typescript
// Only connect to agents with trust score > 0.8
const trustedAgents = await registry.discover({
  minTrustScore: 0.8,
});
```

### Organization Allowlists

Restrict who can call your agent:

```typescript
expose: {
  allowedOrgs: ['PartnerCo', 'Vercel', 'Stripe'],
  // Only these orgs can call your agent
}
```

### Rate Limiting

Built-in per-caller rate limiting:

```typescript
expose: {
  rateLimit: {
    requestsPerMinute: 30,
    requestsPerDay: 1000,
  },
}
```

### Confirmation Gates

For dangerous operations, require human approval:

```typescript
capabilities: [
  {
    id: 'delete-data',
    name: 'Delete Data',
    requiresConfirmation: true, // Returns "pending" until approved
  },
]
```

---

## `defineRemoteAgent()` API

```typescript
defineRemoteAgent({
  // Required
  name: string;          // Local name (used in ctx.askRemote)
  auth: RemoteAgentAuth; // Credentials

  // Connection (one required)
  endpoint?: string;     // Direct URL
  discover?: boolean;    // Use Kernova Registry

  // Optional
  description?: string;
  remoteId?: string;        // Remote agent ID (if different from name)
  timeout?: number;         // Default: 30000ms
  maxRetries?: number;      // Default: 2
  capabilities?: string[];  // Whitelist specific capabilities
  requiresConfirmation?: boolean; // Require human approval before calling
});
```

---

## Core API (Advanced)

For direct use without the framework:

```typescript
import { RemoteAgentClient, AgentProtocolServer, KAPRegistry } from '@kernova/core';

// Client — call remote agents
const client = new RemoteAgentClient({
  identity: { id: 'my-agent', name: 'My Agent', organization: 'My Org' },
});

await client.connect('https://agents.vercel.com', { type: 'api-key', token: 'sk-...' });
const response = await client.ask('vercel-deploy', 'Deploy my-app');

// Server — expose your agent
const server = new AgentProtocolServer({
  agent: { id: 'my-agent', name: 'My Agent', ... },
  endpoint: 'https://my-agent.com/v1/ask',
  auth: [{ type: 'api-key' }],
  capabilities: [...],
  handler: async (request) => {
    // Handle incoming requests from other agents
    return { requestId: request.id, protocol: 'kap/1.0', status: 'success', output: '...' };
  },
});
```

---

## Examples

### Your Agent ↔ Vercel (Deploy)

```typescript
const result = await ctx.askRemote('vercel', 'Deploy my-app to production', {
  capability: 'deploy',
  params: { project: 'my-app', environment: 'production' },
});
```

### Your Agent ↔ Stripe (Billing)

```typescript
const result = await ctx.askRemote('stripe', 'Get subscription status for customer cust_123', {
  capability: 'get-subscription',
  params: { customerId: 'cust_123' },
});
```

### Your Agent ↔ GitHub (Code)

```typescript
const result = await ctx.askRemote('github', 'Create a PR for the login-fix branch', {
  capability: 'create-pr',
  params: { repo: 'my-org/my-app', branch: 'login-fix', title: 'Fix login bug' },
});
```

---

## Protocol Specification

| Field | Value |
|---|---|
| Protocol version | `kap/1.0` |
| Discovery | `GET /.well-known/agent.json` |
| Communication | `POST` to agent endpoint |
| Content-Type | `application/json` |
| Auth header | `Authorization: Bearer <token>` or custom |
| Status codes | 200 success, 401 auth, 403 forbidden, 429 rate limit, 500 error |

The full spec is open. Any platform can implement it — not just Kernova agents.
