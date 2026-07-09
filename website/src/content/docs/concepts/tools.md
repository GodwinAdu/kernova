---
title: Tools & Plugins
description: Give your agents the ability to do things — search, calculate, call APIs.
---

# Tools & Plugins

Without tools, an AI agent can only generate text. With tools, it can **do things** — search databases, send emails, call APIs, read files, perform calculations, or anything else you can code.

## How It Works (The Mental Model)

Think of it like this:

1. You tell the agent: "Find out when Bob's subscription expires"
2. The agent thinks: "I need to look up Bob's subscription data"
3. The agent sees it has a `lookup_subscription` tool available
4. It calls the tool with `{ userId: 'bob' }`
5. Your function runs, returns `{ expiresAt: '2026-12-01' }`
6. The agent reads the result and writes: "Bob's subscription expires on December 1, 2026"

**You write the function. The AI decides when to call it.**

## Registering Tools

### SDK (one line)

```typescript
app.tool('lookup_subscription', {
  description: 'Look up a user subscription by their user ID or email',
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'The user ID or email to look up' },
    },
    required: ['userId'],
  },
  execute: async ({ userId }) => {
    const sub = await db.subscriptions.findByUser(userId);
    return { plan: sub.plan, expiresAt: sub.expiresAt, active: sub.active };
  },
});
```

### Important: The `description` matters

The LLM reads your tool description to decide when to use it. Write it clearly:

```typescript
// ❌ Bad — too vague
description: 'Gets data'

// ✅ Good — specific about what and when
description: 'Look up a user subscription by their user ID or email. Returns plan, expiration date, and active status.'
```

### Important: The `parameters` matter

Use JSON Schema format. The LLM uses this to know what arguments to pass:

```typescript
parameters: {
  type: 'object',
  properties: {
    city: { 
      type: 'string', 
      description: 'City name (e.g., "London", "New York")',  // ← helps the LLM format correctly
    },
    units: { 
      type: 'string', 
      enum: ['celsius', 'fahrenheit'],  // ← constrains to valid values
      description: 'Temperature unit',
    },
  },
  required: ['city'],  // ← city is required, units is optional
}
```

## The Tool-Calling Loop

When an agent has tools, the execution isn't a single LLM call — it's a loop:

```
1. LLM receives: intent goal + available tools + context
2. LLM responds with either:
   a) Text → done, return to user
   b) Tool call → continue to step 3
3. Runtime executes the tool function
4. Tool result is added to the conversation
5. LLM receives the result → go back to step 2
6. Maximum 10 iterations (prevents infinite loops)
```

This means an agent can call **multiple tools** in sequence before giving a final answer:

```
User: "Compare the weather in London and Tokyo"

LLM → calls get_weather({ city: 'London' })     → "12°C, rainy"
LLM → calls get_weather({ city: 'Tokyo' })      → "24°C, sunny"  
LLM → "London is 12°C and rainy, while Tokyo is 24°C and sunny."
```

## Direct Tool Use (in custom agents)

Inside a custom `execute` function, you can call tools directly without going through the LLM:

```typescript
async execute(intent, context, tools) {
  // Direct call — you decide when, no LLM involved
  const weather = await tools.useTool('weather:get_current', { city: 'London' });
  
  // Or let the LLM decide which tools to use
  const answer = await tools.completeWithTools(intent.goal);
}
```

**When to use which:**
- `tools.useTool()` — You know exactly which tool to call and with what parameters
- `tools.completeWithTools()` — Let the LLM decide (more flexible, slightly slower)

## Plugins (grouping tools)

Tools are registered individually with `app.tool()`, but internally they're grouped into **plugins**:

```typescript
import type { NexusPlugin } from '@nexus/core';

const weatherPlugin: NexusPlugin = {
  id: 'weather',
  name: 'Weather Tools',
  version: '1.0.0',
  type: 'tool',
  tools: [
    {
      id: 'current',
      name: 'current',
      description: 'Get current weather for a city',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      execute: async ({ city }) => fetchWeather(city),
    },
    {
      id: 'forecast',
      name: 'forecast', 
      description: 'Get 5-day weather forecast',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      execute: async ({ city }) => fetchForecast(city),
    },
  ],
};

await kernel.plugins.register(weatherPlugin);
```

Tool IDs become `pluginId:toolId` — so these would be `weather:current` and `weather:forecast`.

## Middleware

Plugins can also intercept the intent pipeline:

```typescript
const auditPlugin: NexusPlugin = {
  id: 'audit',
  name: 'Audit Logger',
  version: '1.0.0',
  type: 'middleware',
  middleware: [{
    stage: 'before',    // Run before agent execution
    priority: 1,        // Lower = runs first
    handler: async (ctx) => {
      console.log(`[AUDIT] Intent: ${ctx.goal} by ${ctx.intentId}`);
      return ctx;       // Must return context (can modify it)
    },
  }],
};
```

Middleware can:
- Log, monitor, or transform intents before execution
- Post-process results after execution
- Halt the pipeline entirely (`ctx.halt = true`)

## What Providers Support Tool Calling?

| Provider | Native tool calling |
|----------|-------------------|
| OpenAI | ✓ Full support |
| Anthropic | ✓ Full support |
| DeepSeek, Groq, Mistral, etc. | ✓ Via OpenAI-compatible format |
| Ollama (local) | Limited (depends on model) |

If a provider doesn't support tool calling natively, the agent still works — it just can't autonomously decide to call tools. You can still use `tools.useTool()` directly in custom executors.
