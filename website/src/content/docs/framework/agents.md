---
title: Defining Agents
description: Create AI agents using file-based routing.
---

# Defining Agents

Agents are defined as files in the `agents/` directory. Each file becomes an API endpoint automatically.

## File-Based Routing

```
agents/
├── assistant.agent.ts    → POST /api/agents/assistant
├── support.agent.ts      → POST /api/agents/support
├── research.agent.ts     → POST /api/agents/research
└── sales/
    └── qualify.agent.ts  → POST /api/agents/sales/qualify
```

The file name (minus `.agent.ts`) becomes the route.

## Basic Agent

```typescript
// agents/assistant.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Assistant',
  model: 'gpt-4o',
  instructions: `
    You are a helpful AI assistant.
    Be concise and accurate in your responses.
  `,
});
```

That's it. This agent is now accessible at `POST /api/agents/assistant`.

## Agent with Tools

```typescript
// agents/support.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  model: 'gpt-4o',
  instructions: `
    You are a customer support agent.
    Always search the knowledge base before answering.
    If you can't resolve the issue, offer to escalate.
  `,
  tools: ['search-kb', 'create-ticket'],
  memory: {
    type: 'conversational',
    ttl: '30d',
  },
});
```

## Agent with Custom Handler

For full control over execution, provide a `handler` function:

```typescript
// agents/router.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Router',
  instructions: 'Route requests to the right agent',
  handler: async (ctx) => {
    // Custom logic — no LLM needed
    if (ctx.input.includes('billing')) {
      const result = await ctx.delegate('billing', ctx.input);
      return result;
    }
    
    if (ctx.input.includes('technical')) {
      const result = await ctx.delegate('support', ctx.input);
      return result;
    }

    return { content: 'How can I help you today?' };
  },
});
```

## Agent Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | required | Display name |
| `instructions` | string | required | System prompt |
| `model` | string | project default | A named model from `models` in `kernova.config.ts`, or a model ID for the default provider |
| `tools` | string[] | `[]` | Tool names this agent can use |
| `memory` | object | `{ type: 'conversational' }` | Memory configuration |
| `temperature` | number | provider default | LLM temperature |
| `maxTokens` | number | provider default | Max response tokens |
| `reasoning` | object | — | `{ effort?, budgetTokens?, includeThoughts? }`: how much reasoning models think (`effort`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). See [Reasoning](/guides/providers/#reasoning) |
| `responseFormat` | object | text | `{ type: 'json' }`, or `{ type: 'json_schema', schema }` to answer with JSON matching a JSON Schema |
| `promptCache` | boolean | `false` | Prompt caching for Claude and Bedrock (others cache automatically) |
| `capabilities` | string[] | `[]` | Capability tags for routing |
| `handler` | function | — | Custom execution handler |
| `middleware` | string[] | all middleware | Names of the [middleware](/framework/middleware) to run (`[]` = none) |
| `skills` | string[] | — | [Skills](/framework/skills) to load: instructions, knowledge, tools, MCP servers |
| `mcp` | string[] | — | [MCP servers](/framework/mcp-integration) whose tools this agent can use |
| `schedule` | string/array | — | Cron schedules: `[{ cron, goal }]` (a string runs with a generic goal) |
| `triggers` | array | — | `[{ event, goal, priority?, cooldown? }]`: run when a kernel event matches `event` (a glob like `deploy.*`), a cron expression, or an interval (`schedule.5m`) |
| `budget` | object | — | `{ maxRequestsPerMinute?, maxTokens?, maxCostUsd? }`. Requests over the limit get `429`; tokens and estimated cost are counted per calendar month (UTC) and saved in `kernova-data/agent-budgets.json`, so they survive restarts |
| `reflection` | object | project setting (off) | `{ enabled, threshold?, maxAttempts? }`: an extra model call grades each answer and regenerates weak ones |
| `permissions` | string[] | — | Declarative only: recorded, not enforced |
| `channels` | string[] | — | Declarative only: connect channels yourself (see [Channels](/guides/channels)) |
| `remoteAgents` | string[] | — | Declarative only: `ctx.askRemote()` can call any remote agent defined in `agents/remotes/` |

## Memory Types

```typescript
// No memory (stateless)
memory: { type: 'none' }

// Conversational (per-thread, auto-expires)
memory: { type: 'conversational', ttl: '7d' }

// Persistent (long-term knowledge)
memory: { type: 'persistent', ttl: '90d' }
```

## Scheduled Agents

Run agents on a schedule (cron jobs):

```typescript
export default defineAgent({
  name: 'Report Generator',
  instructions: 'Generate a daily summary of key metrics',
  schedule: [
    { cron: '0 9 * * *', goal: 'Generate morning report' },
    { cron: '0 17 * * *', goal: 'Generate end-of-day summary' },
  ],
});
```

## Testing Agents Locally

Once you run `kernova dev`, you can test agents via curl:

```bash
curl -X POST http://localhost:3000/api/agents/assistant \
  -H "Content-Type: application/json" \
  -d '{"input": "What is Kernova?"}'
```

Response:

```json
{
  "content": "Kernova is a full-stack AI agent framework...",
  "threadId": "thread_abc123",
  "agent": "assistant",
  "metadata": { "model": "gpt-4o", "durationMs": 1200 }
}
```
