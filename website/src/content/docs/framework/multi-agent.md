---
title: Multi-Agent Architecture
description: Build systems where multiple agents collaborate, delegate, and specialize.
---

# Multi-Agent Architecture

Real-world applications often need multiple agents working together. A support bot delegates billing questions to a billing agent. A research pipeline chains researcher → analyzer → writer.

## Multiple Agents in One Project

Just create multiple `.agent.ts` files:

```
agents/
├── router.agent.ts      → POST /api/agents/router
├── support.agent.ts     → POST /api/agents/support
├── billing.agent.ts     → POST /api/agents/billing
└── tools/
    └── ...
```

Each agent has its own endpoint. Your frontend can call any of them directly.

## Pattern 1: Router Agent

A single entry point that delegates to specialists:

```typescript
// agents/router.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Router',
  instructions: `
    You are a routing agent. Based on the user's message, delegate to the right specialist:
    - For product questions, technical issues → delegate to "support"
    - For billing, payments, subscriptions → delegate to "billing"
    - For everything else → answer directly with a brief helpful response
  `,
  handler: async (ctx) => {
    const input = ctx.input.toLowerCase();

    if (input.includes('bill') || input.includes('payment') || input.includes('subscription') || input.includes('charge')) {
      return await ctx.delegate('billing', ctx.input);
    }

    if (input.includes('bug') || input.includes('error') || input.includes('how do i') || input.includes('help')) {
      return await ctx.delegate('support', ctx.input);
    }

    // Default: handle directly
    return { content: "I can help with support or billing questions. What do you need?" };
  },
});
```

```typescript
// agents/support.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  instructions: 'You handle product support questions...',
  tools: ['search-kb'],
});
```

```typescript
// agents/billing.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Billing Agent',
  instructions: 'You handle billing and payment questions...',
  tools: ['lookup-subscription', 'apply-credit'],
});
```

Frontend calls the router:

```tsx
const { messages, send } = useAgentStream('router');
```

The router delegates internally — the user never knows multiple agents are involved.

## Pattern 2: Pipeline (Chain of Agents)

Agents process sequentially, each adding value:

```typescript
// agents/researcher.agent.ts
export default defineAgent({
  name: 'Researcher',
  instructions: 'Search for information and return raw findings. Be thorough.',
  tools: ['web-search', 'search-papers'],
});

// agents/analyzer.agent.ts
export default defineAgent({
  name: 'Analyzer',
  instructions: 'Take research findings and identify key insights, patterns, and conclusions.',
});

// agents/writer.agent.ts
export default defineAgent({
  name: 'Writer',
  instructions: 'Take analysis and write a clear, well-structured report for a non-technical audience.',
});
```

Orchestrate from your frontend or a handler:

```typescript
// agents/research-pipeline.agent.ts
export default defineAgent({
  name: 'Research Pipeline',
  instructions: 'Orchestrate a research pipeline',
  handler: async (ctx) => {
    // Step 1: Research
    const research = await ctx.delegate('researcher', ctx.input);

    // Step 2: Analyze
    const analysis = await ctx.delegate('analyzer',
      `Analyze these findings:\n${research.content}`
    );

    // Step 3: Write
    const report = await ctx.delegate('writer',
      `Write a report based on this analysis:\n${analysis.content}`
    );

    return report;
  },
});
```

## Pattern 3: Parallel Agents

Multiple agents work on the same input simultaneously:

```typescript
// agents/multi-perspective.agent.ts
export default defineAgent({
  name: 'Multi-Perspective',
  instructions: 'Get multiple viewpoints on a topic',
  handler: async (ctx) => {
    // Run in parallel
    const [optimist, pessimist, pragmatist] = await Promise.all([
      ctx.delegate('optimist', ctx.input),
      ctx.delegate('pessimist', ctx.input),
      ctx.delegate('pragmatist', ctx.input),
    ]);

    return {
      content: `## Optimistic View\n${optimist.content}\n\n## Cautious View\n${pessimist.content}\n\n## Practical View\n${pragmatist.content}`,
    };
  },
});
```

## Pattern 4: Agent-per-Feature in the UI

Different pages talk to different agents:

```tsx
// app/chat/page.tsx — general support
const chat = useAgentStream('support');

// app/billing/page.tsx — billing assistant
const billing = useAgent('billing');

// app/onboarding/page.tsx — onboarding guide
const onboarding = useAgentStream('onboarding');
```

## Sharing Tools Between Agents

Multiple agents can use the same tools:

```typescript
// agents/support.agent.ts
tools: ['search-kb', 'create-ticket']

// agents/billing.agent.ts
tools: ['search-kb', 'lookup-subscription']

// 'search-kb' is shared — defined once in agents/tools/search-kb.ts
```

## Sharing Memory Between Agents

By default, each agent has its own memory scope. To share:

```typescript
// Both agents use the same memory namespace
// agents/support.agent.ts
memory: { type: 'persistent', ttl: '30d' }

// agents/billing.agent.ts
memory: { type: 'persistent', ttl: '30d' }
```

When agents delegate to each other via `ctx.delegate()`, the receiving agent sees the same thread context.

## Best Practices

1. **Keep agents focused** — Each agent should do one thing well. Don't make a "god agent" that handles everything.
2. **Use a router** — A single entry point that delegates is easier to maintain than exposing 10 agents to the frontend.
3. **Share tools, not instructions** — Reuse tools across agents. Don't copy instructions between them.
4. **Test delegation** — Verify that the router correctly identifies which agent should handle each type of request.
5. **Monitor handoffs** — Check monitoring for failed delegations or routing errors.
