---
title: "@kernova/sdk"
description: High-level SDK API reference.
---

# @kernova/sdk

The simplest way to build with Nexus. Provides a fluent, minimal API.

## `Nexus.create(config?)`

```typescript
const app = await Nexus.create({
  env: 'development',
  dataDir: './nexus-data',
  ephemeral: false,
  debug: false,
});
```

## `app.agent(name, spec)`

```typescript
app.agent('name', {
  instructions: 'System prompt...',
  description: 'Optional description',
  execute: async (intent, context, tools) => {...}, // Optional
});
```

## `app.tool(name, spec)`

```typescript
app.tool('name', {
  description: 'What this tool does',
  parameters: { type: 'object', properties: {...} },
  execute: async (params) => result,
});
```

## `app.ask(goal, options?)`

```typescript
const result = await app.ask('Question?', { type: 'query', priority: 'medium' });
result.success   // boolean
result.answer    // string
result.intent    // full Intent object
result.durationMs // number
```

## `app.stream(goal)`

```typescript
for await (const token of app.stream('Tell a story')) {
  process.stdout.write(token);
}
```

## `app.remember(content, layer?, tags?)`

```typescript
await app.remember('Important fact', 'longterm', ['tag1', 'tag2']);
```

## `app.recall(query, options?)`

```typescript
const memories = await app.recall('search term', { layer: 'longterm', limit: 5 });
```

## `app.workflow(definition)`

```typescript
app.workflow(myWorkflowDefinition);
```

## `app.runWorkflow(id, input?)`

```typescript
const instance = await app.runWorkflow(definitionId, { topic: 'AI' });
```

## `app.getKernel()`

Access the underlying kernel for advanced operations.

## `app.close()`

Shut down the runtime gracefully.
