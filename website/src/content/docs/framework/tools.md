---
title: Custom Tools
description: Give your agents superpowers with custom tool definitions.
---

# Custom Tools

Tools are functions that agents can call during execution. Define them in `agents/tools/` and reference them by name in your agent definitions.

## Defining a Tool

```typescript
// agents/tools/search-kb.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'search-kb',
  description: 'Search the company knowledge base for relevant articles',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query',
      required: true,
    },
    limit: {
      type: 'number',
      description: 'Maximum results to return',
      default: 5,
    },
  },
  execute: async ({ query, limit }, ctx) => {
    ctx.log(`Searching KB for: ${query}`);
    
    // Your implementation here
    const results = await fetch(`https://api.mycompany.com/kb/search?q=${query}&limit=${limit}`);
    return await results.json();
  },
});
```

## Tool Discovery

Tools are auto-discovered from these directories:

```
agents/tools/     ← Primary location
tools/            ← Alternative location
```

Any `.ts` or `.js` file that exports a `defineTool()` result will be registered.

## Using Tools in Agents

Reference tools by their `name` field:

```typescript
// agents/support.agent.ts
export default defineAgent({
  name: 'Support',
  instructions: '...',
  tools: ['search-kb', 'create-ticket', 'send-email'],
});
```

The agent's LLM will see the tool descriptions and decide when to call them.

## Tool Parameters

Parameter types supported:

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text input | `"search query"` |
| `number` | Numeric value | `5`, `3.14` |
| `boolean` | True/false | `true` |
| `array` | List of values | `["tag1", "tag2"]` |
| `object` | Nested structure | `{ "key": "value" }` |

```typescript
parameters: {
  query: { type: 'string', description: 'Search query', required: true },
  maxResults: { type: 'number', description: 'Max results', default: 10 },
  includeArchived: { type: 'boolean', description: 'Include archived items' },
  tags: { type: 'array', description: 'Filter by tags', items: { type: 'string' } },
}
```

## Tool Context

Every tool receives a `context` object as the second argument:

```typescript
execute: async (params, ctx) => {
  // Environment variables (from project secrets)
  const apiKey = ctx.env.MY_API_KEY;
  
  // Log messages (visible in monitoring)
  ctx.log('Starting search...');
  
  // User info (if available)
  const userId = ctx.user?.id;
  
  // Thread ID
  const thread = ctx.threadId;
}
```

## Tool Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | required | Unique tool name |
| `description` | string | required | Description shown to the LLM |
| `parameters` | object | required | Parameter schema |
| `execute` | function | required | Implementation |
| `rateLimit` | number | — | Max calls per minute |
| `requiresConfirmation` | boolean | `false` | Require user approval before executing |

## Examples

### Database Query Tool

```typescript
export default defineTool({
  name: 'query-users',
  description: 'Query the user database',
  parameters: {
    email: { type: 'string', description: 'Filter by email' },
    plan: { type: 'string', description: 'Filter by plan', enum: ['free', 'pro', 'enterprise'] },
  },
  execute: async ({ email, plan }) => {
    return await db.users.findMany({ where: { email, plan } });
  },
});
```

### HTTP API Tool

```typescript
export default defineTool({
  name: 'get-weather',
  description: 'Get current weather for a city',
  parameters: {
    city: { type: 'string', description: 'City name', required: true },
  },
  execute: async ({ city }, ctx) => {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${ctx.env.WEATHER_API_KEY}`
    );
    return await res.json();
  },
});
```

### Confirmation-Required Tool

```typescript
export default defineTool({
  name: 'delete-account',
  description: 'Permanently delete a user account',
  parameters: {
    userId: { type: 'string', description: 'User ID to delete', required: true },
  },
  requiresConfirmation: true,
  execute: async ({ userId }) => {
    await db.users.delete({ where: { id: userId } });
    return { deleted: true };
  },
});
```
