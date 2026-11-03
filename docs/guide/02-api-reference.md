# Kernova API Reference

## @kernova/sdk

### `Kernova.create(config?)`

Create and start a Kernova instance.

```typescript
const app = await Kernova.create({
  env: 'development',      // 'development' | 'staging' | 'production'
  dataDir: './kernova-data', // Persistence directory
  ephemeral: false,        // Disable persistence
  debug: false,            // Enable debug logging
});
```

### `app.agent(name, spec)`

Register an agent.

```typescript
app.agent('name', {
  instructions: 'System prompt...',
  description: 'What this agent does',       // optional
  capabilities: [...],                        // optional
  tools: [...],                               // optional
  execute: async (intent, context, tools) => {...}, // optional (uses LLM by default)
});
```

### `app.tool(name, spec)`

Register a tool that agents can call.

```typescript
app.tool('name', {
  description: 'What this tool does',
  parameters: { type: 'object', properties: {...}, required: [...] },
  execute: async (params) => { return result; },
});
```

### `app.ask(goal, options?)`

Submit an intent and get a response.

```typescript
const result = await app.ask('What is 2+2?', {
  type: 'query',       // optional: query | action | analysis | ...
  priority: 'medium',  // optional: critical | high | medium | low
});

result.success  // boolean
result.answer   // string
result.intent   // full Intent object
result.durationMs // number
```

### `app.remember(content, layer?, tags?)`

Store a memory.

```typescript
await app.remember('User likes dark mode', 'longterm', ['preference', 'ui']);
```

### `app.recall(query, options?)`

Search memories.

```typescript
const memories = await app.recall('ui preferences', { layer: 'longterm', limit: 5 });
```

### `app.close()`

Shut down the runtime.

---

## @kernova/core

### `KernovaKernel`

The runtime kernel. Lower-level API for full control.

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

const kernel = new KernovaKernel({
  environment: 'development',
  dataDir: './kernova-data',
  ephemeral: false,
  debug: true,
  providers: [...],          // Custom model providers
  models: { default: {...} }, // Model routing config
});

await kernel.start();
const result = await kernel.submit({ goal: '...', intentType: 'query' });
await kernel.stop();
```

### Kernel Accessors

| Accessor | Returns | Purpose |
|---|---|---|
| `kernel.events` | EventBus | Pub/sub + persistent event queries |
| `kernel.memoryEngine` | MemoryEngine | Five-layer memory CRUD |
| `kernel.agentRegistry` | AgentRegistry | Agent registration + selection |
| `kernel.models` | ModelRouter | Model provider routing |
| `kernel.plugins` | PluginRegistry | Plugin + tool management |
| `kernel.workflows` | WorkflowEngine | Workflow definition + execution |
| `kernel.identity` | IdentityManager | Auth, keys, sessions, permissions |
| `kernel.budget` | BudgetManager | Rate limiting + cost control |

### `defineAgent(spec)`

Define an agent (for registration with the kernel).

```typescript
const agent = defineAgent({
  name: 'my-agent',
  description: '...',
  capabilities: [{ id: '...', name: '...', description: '...', confidence: 0.9 }],
  tools: [],
  instructions: 'System prompt...',
  execute: async (intent, context, tools) => {
    // Optional custom logic
    return { success: true, summary: '...', evidence: {...}, durationMs: 0 };
  },
});

kernel.agentRegistry.register(agent.definition, agent.executor);
```

### Agent Tools (available in execute function)

| Tool | Description |
|---|---|
| `tools.complete(prompt)` | Call LLM for text response |
| `tools.stream(prompt)` | Stream LLM response (AsyncGenerator) |
| `tools.streamToString(prompt)` | Stream + collect as string |
| `tools.completeWithTools(prompt)` | LLM with tool-calling loop |
| `tools.useTool(id, params)` | Execute a plugin tool directly |
| `tools.listTools()` | List available tools |
| `tools.delegate(agent, goal)` | Delegate to named agent |
| `tools.ask(goal)` | Ask any agent (kernel selects) |
| `tools.broadcast(goal)` | Try all agents |
| `tools.remember(content)` | Store a memory |
| `tools.recall(query)` | Search memories |
| `tools.emit(type, data)` | Emit a custom event |
| `tools.log(message)` | Log a message |

### `createProvider(preset, overrides?)`

Create a model provider from a preset.

```typescript
import { createProvider } from '@kernova/core';

const provider = createProvider('deepseek');
const provider = createProvider('groq', { defaultModel: 'llama-3.1-8b-instant' });
const provider = createProvider('ollama', { defaultModel: 'mistral' });
```

Available presets: openai, anthropic, gemini, deepseek, groq, cerebras, sambanova, mistral, cohere, xai, together, openrouter, fireworks, perplexity, azure_openai, bedrock, ollama, lmstudio, vllm, llamacpp

---

## @kernova/cli

| Command | Description |
|---|---|
| `kernova init [name]` | Create a new project |
| `kernova dev` | Start dev runtime + hot reload + Studio |
| `kernova agent create <name>` | Generate agent boilerplate |
| `kernova agent list` | List registered agents |
| `kernova status` | Show project/runtime status |
| `kernova --version` | Show version |
