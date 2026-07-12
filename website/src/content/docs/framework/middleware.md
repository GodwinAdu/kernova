---
title: Middleware
description: Run code before and after agent execution — authentication, logging, rate limiting.
---

# Middleware

Middleware lets you run code before or after every agent request. Common use cases:
- Authentication — reject unauthorized requests
- Logging — track every interaction
- Rate limiting — prevent abuse
- Input validation — sanitize user input
- Response transformation — format outputs

## Creating Middleware

Create files in the `middleware/` directory:

```typescript
// middleware/auth.ts
import { defineMiddleware } from '@kernova/framework';

export default defineMiddleware({
  name: 'auth',
  stage: 'before',  // Run before the agent executes
  handler: async (ctx, next) => {
    // Check if user is authenticated
    if (!ctx.user || !ctx.user.id) {
      throw new Error('Unauthorized: Please provide user credentials');
    }

    // User is valid — continue to the agent
    await next();
  },
});
```

## Middleware Stages

| Stage | When It Runs | Use Case |
|-------|-------------|----------|
| `before` | Before the agent processes the request | Auth, validation, rate limiting |
| `after` | After the agent responds | Logging, response formatting |
| `both` | Before AND after (default) | Full request/response logging |

## Before Middleware

Runs before the agent. Can reject requests by throwing or not calling `next()`:

```typescript
// middleware/rate-limit.ts
import { defineMiddleware } from '@kernova/framework';

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export default defineMiddleware({
  name: 'rate-limit',
  stage: 'before',
  handler: async (ctx, next) => {
    const userId = ctx.user?.id || 'anonymous';
    const now = Date.now();
    const window = 60_000; // 1 minute
    const maxRequests = 20;

    const entry = requestCounts.get(userId);
    
    if (!entry || now > entry.resetAt) {
      requestCounts.set(userId, { count: 1, resetAt: now + window });
    } else if (entry.count >= maxRequests) {
      throw new Error('Rate limit exceeded. Try again in a minute.');
    } else {
      entry.count++;
    }

    await next();
  },
});
```

## After Middleware

Runs after the agent responds. Can access and modify the response:

```typescript
// middleware/logger.ts
import { defineMiddleware } from '@kernova/framework';

export default defineMiddleware({
  name: 'logger',
  stage: 'after',
  handler: async (ctx, next) => {
    await next();
    
    // ctx.response is available in after-stage
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      agent: ctx.agentName,
      user: ctx.user?.id,
      input: ctx.input.slice(0, 100),
      responseLength: ctx.response?.content.length,
    }));
  },
});
```

## Both (Before + After)

```typescript
// middleware/timing.ts
import { defineMiddleware } from '@kernova/framework';

export default defineMiddleware({
  name: 'timing',
  stage: 'both',
  handler: async (ctx, next) => {
    const start = Date.now();
    ctx.metadata.startTime = start;
    
    await next(); // Agent executes here
    
    const duration = Date.now() - start;
    console.log(`[${ctx.agentName}] ${duration}ms`);
  },
});
```

## Applying Middleware to Specific Agents

By default, middleware applies to all agents. To limit it to specific agents:

```typescript
// agents/admin.agent.ts
export default defineAgent({
  name: 'Admin Agent',
  instructions: '...',
  middleware: ['auth', 'rate-limit'], // Only these middleware run for this agent
});
```

## Middleware Context

The `ctx` object contains:

```typescript
interface MiddlewareContext {
  agentName: string;          // Which agent is being called
  input: string;              // The user's message
  threadId: string;           // Conversation thread ID
  user?: { id: string };      // User info (if provided)
  metadata: Record<string, unknown>; // Shared data between middleware
  response?: {                // Only available in after-stage
    content: string;
    metadata?: Record<string, unknown>;
  };
}
```

## Execution Order

If you have multiple middleware:

```
middleware/auth.ts      (stage: before)
middleware/rate-limit.ts (stage: before)
middleware/logger.ts    (stage: after)
```

Execution flow:
```
Request comes in
  → auth.handler(ctx, next)        ← before
    → rate-limit.handler(ctx, next) ← before
      → AGENT EXECUTES
    → logger.handler(ctx, next)     ← after
Response sent
```

If any before-middleware throws or doesn't call `next()`, the chain stops and the agent never runs.
