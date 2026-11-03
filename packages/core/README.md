# @kernova/core

[![npm version](https://img.shields.io/npm/v/@kernova/core.svg)](https://www.npmjs.com/package/@kernova/core)
[![npm downloads](https://img.shields.io/npm/dm/@kernova/core.svg)](https://www.npmjs.com/package/@kernova/core)
[![license](https://img.shields.io/npm/l/@kernova/core.svg)](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@kernova/core.svg)](https://nodejs.org)

**The Kernova runtime kernel: the engine underneath every Kernova app.**

It handles intents, agents, memory, events, tools, workflows, identity, budgets, scheduling, and model routing in one embeddable TypeScript runtime.

**[Documentation](https://kernova2026.vercel.app)** · [Core API reference](https://kernova2026.vercel.app/api/core/) · [Concepts](https://kernova2026.vercel.app/concepts/intents/) · [GitHub](https://github.com/GodwinAdu/kernova)

> **Most developers should start with a higher-level package.**
> [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) for full-stack apps, or [`@kernova/sdk`](https://www.npmjs.com/package/@kernova/sdk) for backend services.
> Use `@kernova/core` directly when you need full control over the runtime, or when you're building your own abstraction on top of it.

---

## Installation

```bash
npm install @kernova/core @kernova/types
```

Requirements: Node.js **22+**, an ESM project (`"type": "module"`), and a model provider API key (or a local model server such as Ollama). Persistence uses SQLite via the native `better-sqlite3` module.

## Quick start

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });

const assistant = defineAgent({
  name: 'assistant',
  description: 'A helpful assistant',
  capabilities: [
    { id: 'general', name: 'General', description: 'General help', confidence: 0.9 },
  ],
  tools: [],
  instructions: 'You are helpful and concise.',
});

kernel.agentRegistry.register(assistant.definition, assistant.executor);
await kernel.start();

const intent = await kernel.submit({ goal: 'What is 2 + 2?', intentType: 'query' });
console.log(intent.result?.summary);

await kernel.stop();
```

## What's in the kernel

| Area | What it does |
|------|--------------|
| **Intents** | Submit structured goals. Results come back with evidence and confidence |
| **Agents** | Register agents, score their capabilities, and route each intent to the best one |
| **Multi-agent** | Delegate, ask, and broadcast between agents; teams with a shared workspace |
| **Memory** | Five-layer memory (working → global) with full-text and vector search, plus the Memory v2 engine with 12 storage adapters |
| **Events** | Every state change is an event, persisted to SQLite, queryable and streamable |
| **Models** | 26 providers (including Azure OpenAI, AWS Bedrock, and Google Vertex AI), auto-detected from environment variables, with fallback, structured output, reasoning controls, prompt caching, and multimodal input |
| **Tools and plugins** | Register tools agents can call, plus built-in tools. Code, shell, file, and database tools are opt-in; allow/deny tool policies per kernel and per agent |
| **Workflows** | Multi-step execution with human approval and compensation |
| **Autonomy** | Cron scheduler, persistent priority task queue, proactive triggers, background loops |
| **Channels** | Webhook, WebSocket, Slack, Discord, Telegram, Email, Teams, WhatsApp, SMS, Matrix, and more |
| **Intelligence** | Planner, self-reflection, RAG pipeline, conversation manager |
| **Governance** | Identity, API keys, sessions, roles and permissions, budgets, rate limiting |
| **Operations** | Gateway API, metrics, health monitoring, trajectory recording, security audit |
| **MCP** | Bridge to Model Context Protocol servers |

## Kernel modules

Each module is available as a property on the kernel instance:

| Property | Description |
|----------|-------------|
| `kernel.agentRegistry` | Register and look up agents |
| `kernel.events` | Event bus: subscribe, query, stream |
| `kernel.memoryEngine` | Store, query, and decay memories |
| `kernel.models` | Model router: complete, stream, embed |
| `kernel.plugins` | Plugin and tool registry |
| `kernel.builtInTools` | Built-in tools (`http-fetch`, `date-time`, `math-eval`, ... on by default; `shell-exec`, `code-eval`, `file-read`, `file-write`, `database-query` opt-in) |
| `kernel.workflows` | Define, execute, and approve workflows |
| `kernel.identity` | Users, API keys, sessions, permissions |
| `kernel.budget` | Token and cost limits |
| `kernel.rateLimiter` | Request rate limiting |
| `kernel.scheduler` | Cron and one-shot jobs |
| `kernel.taskQueue` | Persistent priority queue with retries and a dead-letter queue |
| `kernel.triggers` | Event-driven proactive triggers |
| `kernel.channels` | Inbound/outbound messaging adapters |
| `kernel.loops` | Background agent loops |
| `kernel.planner` | Plan-and-execute for complex goals |
| `kernel.reflection` | Self-evaluation and regeneration |
| `kernel.conversation` | Threads with sliding-window summarization |
| `kernel.rag` | Retrieval-augmented generation pipeline |
| `kernel.subagents` | Spawn and manage sub-agents |
| `kernel.fallback` | Model fallback chains |
| `kernel.mcp` | MCP bridge |
| `kernel.gateway` | HTTP gateway API |
| `kernel.metrics` / `kernel.health` | Observability |

## Recipes

### Listen to events

```typescript
kernel.events.subscribe(['intent.completed', 'intent.failed'], (event) => {
  console.log(event.eventType, event.data);
});
```

### Set a budget

```typescript
kernel.budget.setGlobalBudget({ maxTokens: 100_000, maxCostUsd: 5 });
```

### Call a model directly

```typescript
const { content } = await kernel.models.complete({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Say hi' }],
});

const vector = await kernel.models.embed('text to embed');
```

### Receive webhooks

```typescript
import { WebhookChannelAdapter } from '@kernova/core';

// Requests must be signed: x-kernova-signature: sha256=<HMAC-SHA256 of the body>
const webhooks = new WebhookChannelAdapter({ port: 3100, path: '/incoming', secret: process.env.WEBHOOK_SECRET });
await webhooks.connect();
```

### Answer chat platforms

```typescript
const slack = kernel.channels.register({
  channelType: 'slack',
  name: 'support',
  config: { type: 'slack', botToken: process.env.SLACK_BOT_TOKEN!, signingSecret: process.env.SLACK_SIGNING_SECRET! },
});
await kernel.channels.connect(slack.id);

kernel.channels.onMessage(async (msg) => {
  const intent = await kernel.submit({ goal: msg.content, owner: msg.sender, metadata: { threadId: `${msg.connectorId}:${msg.replyTo}` } });
  await kernel.channels.reply(msg, intent.result?.summary ?? '');
});
```

Adapters with webhook servers verify each request (Slack, WhatsApp, and Twilio signatures, Bot Framework tokens, Telegram secret tokens), and replies go to the conversation a message came from (`msg.replyTo`).

### Test agents without calling a real model

```typescript
import { MockModelProvider, AgentTestRunner } from '@kernova/core';
```

### Run with no disk writes

```typescript
const kernel = new KernovaKernel({ environment: 'development', ephemeral: true });
```

### Hold a conversation

Intents with the same `threadId` see the earlier turns; intents without one are independent.

```typescript
await kernel.submit({ goal: 'My favourite colour is teal.', owner: 'user-42', metadata: { threadId: 'chat-42' } });
await kernel.submit({ goal: 'What is my favourite colour?', owner: 'user-42', metadata: { threadId: 'chat-42' } });
```

### Use a different model per agent

```typescript
const reviewer = defineAgent({
  // ...
  model: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, // or just { model } for the default provider
  temperature: 0.2,
  maxTokens: 2000,
});
```

### Give an agent file access, and nothing else

```typescript
import { DEFAULT_BUILT_IN_TOOLS } from '@kernova/core';

const kernel = new KernovaKernel({
  environment: 'production',
  builtInTools: { enabled: [...DEFAULT_BUILT_IN_TOOLS, 'file-read'], sandboxDir: './docs' },
});

const reader = defineAgent({
  // ...
  toolPolicy: { allow: ['file-read'] },
});
```

### Serve agents over HTTP

```typescript
await kernel.gateway.start({ port: 3000, auth: { tokens: [process.env.GATEWAY_TOKEN!] } });
```

The gateway listens on `127.0.0.1` and refuses to start without a token (or `KERNOVA_API_KEY`). See the [gateway guide](https://kernova2026.vercel.app/guides/gateway-api/) for anonymous local use and CORS. `new DaemonRunner(kernel, { port: 3000 })` (and `kernova serve --port 3000`) starts the kernel and the gateway together.

## Configuration

```typescript
new KernovaKernel({
  environment: 'production',   // 'development' | 'staging' | 'production'
  dataDir: './kernova-data',   // SQLite location (default)
  ephemeral: false,            // true = nothing written to disk
  debug: false,                // true = print kernel and agent log() messages
  providers: [],               // extra ModelProvider instances
  models: { /* routing config */ },
  builtInTools: { sandboxDir: './workspace' },     // unsafe tools need `enabled`
  toolPolicy: { deny: ['http-fetch'] },            // kernel-wide allow/deny
  gateway: { port: 3000, auth: { tokens: [] } },   // kernel.gateway settings
  rateLimits: { defaultMaxRequests: 100 },         // per owner, per minute
  eventRetentionDays: 30,      // prune old events (0 = keep forever)
  shutdownTimeoutMs: 10_000,   // stop() waits this long for active intents
  reflection: { enabled: false, threshold: 0.7, maxAttempts: 2 }, // off by default
  threadHistory: true,         // history per metadata.threadId (false if your app keeps its own)
  planning: { maxSteps: 10 },  // kernel.planner settings
  rag: { chunkSize: 512, topK: 5 },            // kernel.rag settings
  identity: { sessionTtlSeconds: 86_400 },     // kernel.identity settings
});
```

## Model providers

Set at least one key. Providers are detected automatically, and the first one found is used with its own default model (for example `claude-sonnet-5-5` for Anthropic, `gemini-flash-latest` for Gemini):

`OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `GEMINI_API_KEY` · `DEEPSEEK_API_KEY` · `GROQ_API_KEY` · `MISTRAL_API_KEY` · `COHERE_API_KEY` · `XAI_API_KEY` · `DASHSCOPE_API_KEY` (Qwen) · `MOONSHOT_API_KEY` · `ZAI_API_KEY` · `TOGETHER_API_KEY` · `OPENROUTER_API_KEY` · `HF_TOKEN` · `NVIDIA_API_KEY` · `FIREWORKS_API_KEY` · `PERPLEXITY_API_KEY` · `CEREBRAS_API_KEY` · `SAMBANOVA_API_KEY`

Cloud platforms authenticate without extra packages:

- **Azure OpenAI**: `AZURE_OPENAI_ENDPOINT` plus `AZURE_OPENAI_API_KEY` or Microsoft Entra ID (app credentials, managed identity)
- **AWS Bedrock**: `AWS_BEARER_TOKEN_BEDROCK`, or AWS credentials (environment, `~/.aws` profiles, SSO via `credential_process`, ECS/EKS roles) with `new BedrockProvider()`
- **Google Vertex AI**: a service account key, `gcloud auth application-default login`, or the metadata server, with `GOOGLE_CLOUD_PROJECT`

Local servers need no key but aren't auto-detected: Ollama · LM Studio · vLLM · llama.cpp

Every provider takes the same request options: `responseFormat` (JSON, optionally matching a schema), `reasoning` (`{ effort }` or `{ budgetTokens }`), `cache` (prompt caching), and image, audio, and file parts. `kernel.models.listModels()` lists what a provider offers, and `kernel.models.embedMany()` embeds in batches.

Requests are retried on rate limits (429), overload (529), and transient server errors, honouring `Retry-After`.

Set `OPENAI_BASE_URL` to use any OpenAI-compatible endpoint. Provider classes (`OpenAIProvider`, `AzureOpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `VertexAIProvider`, `BedrockProvider`, `OllamaProvider`, `OpenAICompatibleProvider`) are exported if you need to construct them yourself.

## Stability

`@kernova/core` exposes many modules. `KernovaKernel`, `defineAgent`, and the module properties listed above are the primary API. Deep internals may change between minor versions, so pin your version if you depend on them. `NexusKernel` is a deprecated alias of `KernovaKernel`.

## Related packages

| Package | Use it for |
|---------|-----------|
| [`@kernova/sdk`](https://www.npmjs.com/package/@kernova/sdk) | A simpler, high-level API over this kernel |
| [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) | Full-stack apps with file-based agents and React hooks |
| [`@kernova/types`](https://www.npmjs.com/package/@kernova/types) | Shared TypeScript types |
| [`@kernova/cli`](https://www.npmjs.com/package/@kernova/cli) | Dev server, deploy, diagnostics |

## Documentation and support

- [Core API reference](https://kernova2026.vercel.app/api/core/)
- [Concepts: intents, agents, events, memory](https://kernova2026.vercel.app/concepts/intents/)
- [Autonomy](https://kernova2026.vercel.app/guides/autonomy/) · [Intelligence](https://kernova2026.vercel.app/guides/intelligence/) · [Advanced platform](https://kernova2026.vercel.app/guides/advanced-platform/)
- [Model providers](https://kernova2026.vercel.app/guides/providers/)
- [Security](https://kernova2026.vercel.app/guides/security/) · [Testing](https://kernova2026.vercel.app/guides/testing/)
- [Report a bug or request a feature](https://github.com/GodwinAdu/kernova/issues)

## Contributing

Contributions are welcome. See the [contributing guide](https://github.com/GodwinAdu/kernova/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
