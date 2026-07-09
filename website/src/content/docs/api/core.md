---
title: "@kernova/core"
description: Core runtime kernel API reference.
---

# @kernova/core

The full runtime kernel. Use when you need complete control.

## NexusKernel

```typescript
const kernel = new NexusKernel({
  environment: 'development',
  dataDir: './nexus-data',
  ephemeral: false,
  debug: true,
  providers: [],
  models: { default: { provider: 'openai', model: 'gpt-4o' } },
});

await kernel.start();
const result = await kernel.submit({ goal: '...', intentType: 'query' });
await kernel.stop();
```

## Kernel Accessors

| Property | Type | Description |
|----------|------|-------------|
| `kernel.events` | EventBus | Event pub/sub + persistence |
| `kernel.memoryEngine` | MemoryEngine | Five-layer memory |
| `kernel.agentRegistry` | AgentRegistry | Agent management |
| `kernel.models` | ModelRouter | Model routing |
| `kernel.plugins` | PluginRegistry | Plugin management |
| `kernel.workflows` | WorkflowEngine | Workflow execution |
| `kernel.identity` | IdentityManager | Auth & permissions |
| `kernel.budget` | BudgetManager | Cost control |

## defineAgent(spec)

```typescript
const agent = defineAgent({ name, description, capabilities, tools, instructions, execute? });
kernel.agentRegistry.register(agent.definition, agent.executor);
```

## createProvider(preset, overrides?)

```typescript
const provider = createProvider('deepseek');
const provider = createProvider('ollama', { defaultModel: 'mistral' });
```

## Providers

- `OpenAIProvider`
- `AnthropicProvider`
- `GeminiProvider`
- `OllamaProvider`
- `OpenAICompatibleProvider`
