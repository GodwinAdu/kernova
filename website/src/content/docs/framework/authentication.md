---
title: Authentication
description: Protect your agents with API keys, user sessions, or custom auth.
---

# Authentication

By default, your agent endpoints are open (no auth required). In production, you'll want to protect them. Kernova supports multiple auth strategies.

## Strategy 1: API Key Authentication

The simplest approach — clients provide a Bearer token:

```bash
curl -X POST https://my-app.kernova.app/api/agents/support \
  -H "Authorization: Bearer kn_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"input": "Help me"}'
```

### Setting Up API Key Auth

Set the `KERNOVA_API_KEY` environment variable:

```bash
# .env.local
KERNOVA_API_KEY=my-secret-key-here
```

The framework server will automatically require this key on all agent endpoints. The `/health` endpoint remains public.

### Multiple Keys

For multiple clients, use middleware:

```typescript
// middleware/api-auth.ts
import { defineMiddleware } from '@kernova/framework';

const VALID_KEYS = new Set([
  process.env.API_KEY_FRONTEND,
  process.env.API_KEY_MOBILE,
  process.env.API_KEY_WEBHOOK,
].filter(Boolean));

export default defineMiddleware({
  name: 'api-auth',
  stage: 'before',
  handler: async (ctx, next) => {
    const key = ctx.metadata.authorization as string;
    
    if (!key || !VALID_KEYS.has(key)) {
      throw new Error('Invalid API key');
    }

    await next();
  },
});
```

## Strategy 2: User Session Auth (Next.js)

If your frontend has user login (via Clerk, NextAuth, etc.), pass the user info with requests:

```tsx
// The KernovaProvider can pass user context
import { useUser } from '@clerk/nextjs';

function ChatPage() {
  const { user } = useUser();
  const { messages, send } = useAgentStream('support', {
    user: user ? { id: user.id, email: user.emailAddresses[0]?.emailAddress } : undefined,
  });

  // Agent receives ctx.user.id and ctx.user.email
}
```

Then validate in middleware:

```typescript
// middleware/session-auth.ts
import { defineMiddleware } from '@kernova/framework';

export default defineMiddleware({
  name: 'session-auth',
  stage: 'before',
  handler: async (ctx, next) => {
    if (!ctx.user?.id) {
      throw new Error('Please sign in to use this feature');
    }
    await next();
  },
});
```

## Strategy 3: No Auth (Public Agents)

For public-facing agents (like a website chat widget), you might want no auth but with rate limiting:

```typescript
// middleware/public-rate-limit.ts
import { defineMiddleware } from '@kernova/framework';

const ipCounts = new Map<string, number>();

export default defineMiddleware({
  name: 'public-rate-limit',
  stage: 'before',
  handler: async (ctx, next) => {
    const ip = ctx.metadata.clientIp as string || 'unknown';
    const count = ipCounts.get(ip) || 0;

    if (count > 50) { // 50 requests max
      throw new Error('Too many requests. Please try again later.');
    }

    ipCounts.set(ip, count + 1);
    await next();
  },
});
```

## Kernova Cloud Auth

When deployed to Kernova Cloud, your project automatically gets:

1. **API Key auth** — Keys created in Dashboard → Settings
2. **Plan-based rate limits** — Enforced based on the user's plan
3. **Request logging** — All requests are logged for monitoring

The CLI authenticates via `kernova login --key kn_live_xxx`.

## Per-Agent Auth

Apply auth middleware to specific agents only:

```typescript
// Public agent (no auth)
defineAgent({
  name: 'Public FAQ',
  instructions: '...',
  middleware: [], // No auth middleware
});

// Protected agent (requires auth)
defineAgent({
  name: 'Admin Panel',
  instructions: '...',
  middleware: ['api-auth'], // Requires valid API key
});
```

## Passing Auth from Frontend

The `KernovaProvider` handles auth automatically:

```tsx
// With an API key (for external clients)
<KernovaProvider apiKey="kn_live_xxx">
  {children}
</KernovaProvider>

// With custom headers
<KernovaProvider headers={{ 'X-Custom-Auth': 'token123' }}>
  {children}
</KernovaProvider>
```

In development, no auth is needed by default (the proxy handles it locally).
