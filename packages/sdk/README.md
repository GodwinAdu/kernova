# @kernova/sdk

[![npm version](https://img.shields.io/npm/v/@kernova/sdk.svg)](https://www.npmjs.com/package/@kernova/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@kernova/sdk.svg)](https://www.npmjs.com/package/@kernova/sdk)
[![license](https://img.shields.io/npm/l/@kernova/sdk.svg)](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@kernova/sdk.svg)](https://nodejs.org)

**The high-level TypeScript API for building AI agent backends with Kernova.**

Agents, tools, persistent memory, streaming, scheduling, and multi-agent coordination, starting from a few lines of code.

**[Documentation](https://kernova2026.vercel.app)** · [SDK API reference](https://kernova2026.vercel.app/api/sdk/) · [Examples](https://kernova2026.vercel.app/guides/examples/) · [GitHub](https://github.com/GodwinAdu/kernova)

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are helpful and concise.' });

const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "Paris"

await app.close();
```

> **Building a full-stack app (React frontend + agents)?** Use [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) instead:
> `npx create-kernova-app my-app`. The SDK is for backend-only services, scripts, workers, or when you already have a frontend.

---

## Table of contents

- [Installation](#installation)
- [Configure a model provider](#configure-a-model-provider)
- [Core concepts](#core-concepts)
- [Agents](#agents)
- [Tools](#tools)
- [Memory](#memory)
- [Streaming](#streaming)
- [Multi-agent delegation](#multi-agent-delegation)
- [Autonomy: scheduling, queues, triggers, channels](#autonomy)
- [Planning](#planning)
- [Conversation threads](#conversation-threads)
- [Daemon mode](#daemon-mode)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Advanced: Memory v2 and agent loops](#advanced)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install @kernova/sdk
```

Requirements:

- Node.js **22 or newer**
- ESM project (`"type": "module"` in `package.json`, or `.mjs` / `.mts` files)
- An API key for at least one model provider, or a local model server such as Ollama

The SDK persists events, memory, and queues to SQLite through `better-sqlite3`, a native module. Prebuilt binaries cover most platforms. If installation fails, see [Troubleshooting](#troubleshooting).

## Configure a model provider

Kernova detects providers from environment variables. Set one or more:

```bash
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, ...
```

| Provider | Environment variable |
|----------|----------------------|
| OpenAI | `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Cohere | `COHERE_API_KEY` |
| xAI | `XAI_API_KEY` |
| Qwen (Alibaba Cloud) | `DASHSCOPE_API_KEY` |
| Moonshot (Kimi) | `MOONSHOT_API_KEY` |
| Z.ai (GLM) | `ZAI_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| NVIDIA NIM | `NVIDIA_API_KEY` |
| Fireworks | `FIREWORKS_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| SambaNova | `SAMBANOVA_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT` plus `AZURE_OPENAI_API_KEY` (or Entra ID: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) |
| AWS Bedrock | `AWS_BEARER_TOKEN_BEDROCK` (with other AWS credentials, pass `new BedrockProvider()` in `providers`) |
| Google Vertex AI | `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, and Google Cloud credentials |
| Ollama, LM Studio, vLLM, llama.cpp | none (local) |

`OPENAI_BASE_URL` points the OpenAI provider at any OpenAI-compatible API.

Run `npx @kernova/cli doctor` to check which providers are configured and working.

## Core concepts

| Concept | What it is |
|---------|------------|
| **Agent** | A named set of instructions (and optionally custom logic) that handles requests |
| **Intent** | A structured goal you submit. `app.ask()` creates one for you |
| **Tool** | A function an agent can decide to call while it works |
| **Memory** | Persistent, searchable knowledge that is automatically injected as context |
| **Event** | Every action emits an event you can subscribe to, query, and replay |

`Kernova.create()` boots a runtime kernel (`@kernova/core`) with sensible defaults. You can reach the full kernel at any time with `app.getKernel()`.

## Agents

```typescript
app.agent('writer', {
  instructions: 'You write clear, engaging technical content.',
});

const { answer, success, durationMs } = await app.ask('Write a tagline for a CLI tool');
```

Give an agent its own model and settings (otherwise it uses the app's default model):

```typescript
app.agent('reviewer', {
  instructions: 'Review code carefully.',
  model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  temperature: 0.2,
  toolPolicy: { deny: ['http-fetch'] },
});
```

`app.agent()` returns the instance, so calls can be chained:

```typescript
app
  .agent('triage', { instructions: 'Classify incoming tickets.' })
  .agent('responder', { instructions: 'Draft friendly replies.' });
```

## Tools

Agents decide when to call a tool. You don't wire it up per request.

```typescript
app.tool('get_weather', {
  description: 'Get the current weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
  execute: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${city}?format=j1`);
    return res.json();
  },
});

const { answer } = await app.ask('Should I bring an umbrella in London today?');
```

`parameters` is a JSON Schema object. Whatever `execute` returns is passed back to the model.

Safe built-in tools (`http-fetch`, `date-time`, `json-parse`, `math-eval`, `regex-match`, `image-describe`) are available too. Tools that run code or touch files (`shell-exec`, `code-eval`, `file-read`, `file-write`, `database-query`) are off until you list them in [`builtInTools.enabled`](#configuration); `web-search` needs a `webSearchProvider`.

## Memory

Memory persists across restarts and is recalled automatically when relevant.

```typescript
await app.remember('User prefers TypeScript over JavaScript', 'longterm');
await app.remember('Project uses PostgreSQL', 'longterm', ['stack']);

const { answer } = await app.ask('Suggest a tech stack for my API');
// → recommends TypeScript + PostgreSQL

const memories = await app.recall('programming preferences', { limit: 5 });
```

Memory layers: `'working'`, `'session'`, `'longterm'` (default), `'organizational'`, `'global'`.

## Streaming

```typescript
for await (const token of app.stream('Write a haiku about coding')) {
  process.stdout.write(token);
}
```

## Multi-agent delegation

Give an agent an `execute` function to take control of its logic and call other agents:

```typescript
app.agent('researcher', { instructions: 'Research topics thoroughly.' });

app.agent('editor', {
  instructions: 'Coordinate research and writing.',
  async execute(intent, context, tools) {
    const research = await tools.delegate('researcher', intent.goal);
    const article = await tools.complete(`Write an article using: ${research.response}`);
    return {
      success: true,
      summary: article,
      evidence: { sources: [], confidence: 0.9 },
      durationMs: 0,
    };
  },
});
```

<a id="autonomy"></a>

## Autonomy: scheduling, queues, triggers, channels

Build always-on agents by chaining autonomy features and then calling `serve()`:

```typescript
import { Kernova, WebhookChannelAdapter } from '@kernova/sdk';

const app = await Kernova.create();

app
  .agent('ops-bot', { instructions: 'You monitor systems and respond to incidents.' })
  .schedule('health-check', '*/5 * * * *', async () => {
    console.log('Running health check...');
  })
  .trigger('on-alert', 'channel.message.*', { goal: 'Triage the incoming alert' })
  .channel('webhooks', new WebhookChannelAdapter({ port: 3100 }))
  .onMessage(async (msg) => {
    console.log(`[${msg.channel}] ${msg.content}`);
  });

await app.serve(); // runs until SIGINT / SIGTERM
```

### Scheduling

```typescript
// Recurring: standard 5-field cron expression
app.schedule('hourly-report', '0 * * * *', async () => {
  await sendReport(await gatherMetrics());
});

// One-shot: delay in milliseconds
app.schedule('warm-cache', 5000, async () => {
  await warmUpCache();
});
```

### Task queue

Tasks are persisted to SQLite, retried with exponential backoff, and moved to a dead-letter queue when retries run out.

```typescript
const taskId = await app.enqueue('send-email', { to: 'user@example.com', subject: 'Welcome!' });

await app.enqueue('process-payment', { orderId: 'ord_123' }, {
  priority: 'critical', // 'critical' | 'high' | 'medium' (default) | 'low'
  maxRetries: 5,        // default: 3
});
```

Inspect the queue with `kernova queue status`.

### Triggers

Fire an intent automatically when events match a glob pattern:

```typescript
app.trigger('on-failure', 'intent.failed', {
  goal: 'Investigate and retry the failed intent',
  priority: 'high',
  cooldownMs: 5000, // default: 1000
});
```

### Channels

```typescript
import { WebhookChannelAdapter, WebSocketChannelAdapter } from '@kernova/sdk';

app.channel('webhooks', new WebhookChannelAdapter({ port: 3100, path: '/incoming', secret: process.env.WEBHOOK_SECRET }));
app.channel('ws', new WebSocketChannelAdapter({ port: 3200, token: process.env.WS_TOKEN, allowedOrigins: ['https://app.example.com'] }));

app.onMessage(async (msg) => {
  const { answer } = await app.ask(msg.content, { threadId: `${msg.connectorId}:${msg.replyTo}` });
  await app.reply(msg, answer); // back to the client or chat the message came from
});
```

Without a `secret` / `token`, the webhook and WebSocket adapters only listen on `127.0.0.1`. Platform adapters (`SlackAdapter`, `TeamsAdapter`, `SmsAdapter`, ... from `@kernova/core`) work with `app.channel()` too.

Adapters start listening as soon as they're added; `app.serve()` waits for them, and `app.close()` stops them.

## Planning

Break a complex goal into steps and execute them (plan-and-execute). Failed steps trigger replanning.

```typescript
const result = await app.plan('Deploy the new version to staging', { maxSteps: 5 });
console.log(result.summary); // "Plan completed: 4/4 steps executed"
```

## Conversation threads

Each `app.ask()` is independent unless you give it a thread. Asks in the same thread see the earlier turns, with an automatic sliding window: older messages are summarized once the window (default: 50) overflows. Use one thread per user conversation.

```typescript
const chat = app.thread('support-session-42');

await chat.ask('My order number is 1234.');
const { answer } = await chat.ask('What was my order number?'); // knows it's 1234

// Same thing without a handle:
await app.ask('What was my order number?', { threadId: 'support-session-42' });

// Inspect or seed the history
await chat.addMessage('system', 'The user is on the Pro plan.');
const { summary, messages } = chat.getContext();
```

## Daemon mode

```typescript
await app.serve({
  configPath: './agents/',     // load .agent.yaml / .agent.json definitions
  watch: true,                 // hot-reload config files
  shutdownTimeoutMs: 10_000,   // default: 30000
  heartbeatIntervalMs: 30_000, // default: 60000
});
```

The daemon starts the scheduler, task queue, and triggers. It shuts down gracefully on `SIGINT` / `SIGTERM` and emits `daemon.heartbeat` events.

## Configuration

```typescript
const app = await Kernova.create({
  env: 'production',          // 'development' (default) | 'staging' | 'production'
  dataDir: './kernova-data',  // where SQLite data lives (default)
  ephemeral: false,           // true = in-memory only, nothing written to disk
  debug: false,
  models: { default: { provider: 'anthropic', model: 'claude-sonnet-5-5' } }, // default: auto-detected
  builtInTools: {
    // Safe tools are on by default; shell-exec, code-eval, file-read,
    // file-write and database-query must be listed here to be enabled
    enabled: ['http-fetch', 'date-time', 'file-read'],
    sandboxDir: './workspace',
  },
  toolPolicy: { deny: ['http-fetch'] },  // kernel-wide tool allow/deny
  reflection: { enabled: false },        // extra grading call per answer (off by default)
});
```

Use `ephemeral: true` in tests and short-lived scripts.

### Budgets

```typescript
app.getKernel().budget.setGlobalBudget({ maxTokens: 100_000, maxCostUsd: 5 });
```

## API reference

| Method | Returns | Description |
|--------|---------|-------------|
| `Kernova.create(config?)` | `Promise<Kernova>` | Create and start an instance |
| `app.agent(name, spec)` | `this` | Register an agent |
| `app.tool(name, spec)` | `this` | Register a tool agents can call |
| `app.ask(goal, options?)` | `Promise<AskResult>` | Submit a goal and get `{ success, answer, intent, durationMs }`. Options: `type`, `priority`, `owner`, `threadId` |
| `app.stream(goal)` | `AsyncGenerator<string>` | Stream response tokens |
| `app.remember(content, layer?, tags?)` | `Promise<MemoryEntry>` | Store a memory |
| `app.recall(query, options?)` | `Promise<MemoryEntry[]>` | Search memories |
| `app.workflow(definition)` | `this` | Register a workflow |
| `app.runWorkflow(id, input?)` | `Promise<unknown>` | Execute a workflow |
| `app.schedule(name, cronOrDelay, handler)` | `this` | Recurring (cron) or one-shot (ms) job |
| `app.enqueue(handler, payload, options?)` | `Promise<string>` | Add a task to the priority queue |
| `app.channel(name, adapter)` | `this` | Register a channel adapter |
| `app.onMessage(handler)` | `this` | Handle inbound messages from all channels |
| `app.reply(msg, content)` | `Promise<DeliveryReceipt>` | Answer a message on its channel, to its sender |
| `app.trigger(name, eventPattern, action)` | `this` | Fire an intent when events match |
| `app.plan(goal, options?)` | `Promise<IntentResult>` | Decompose and execute a complex goal |
| `app.thread(threadId)` | `ThreadHandle` | Get or create a conversation thread; `thread.ask(goal)` asks with its history |
| `app.serve(options?)` | `Promise<void>` | Run as a long-lived daemon |
| `app.getKernel()` | `KernovaKernel` | Access the underlying runtime |
| `app.close()` | `Promise<void>` | Shut down gracefully |

Helper exports: `agent()`, `tool()`, and `workflow()` builders, the `WebhookChannelAdapter` and `WebSocketChannelAdapter` channel adapters, the `DEFAULT_BUILT_IN_TOOLS` and `UNSAFE_BUILT_IN_TOOLS` lists, plus commonly used types (`KernovaConfig`, `AskOptions`, `AskResult`, `EnqueueOptions`, `Intent`, `IntentResult`, `MemoryEntry`, `AgentDefinition`, `KernovaEvent`, `DaemonConfig`, `BuiltInToolConfig`).

<a id="advanced"></a>

## Advanced: Memory v2 and agent loops

The SDK re-exports the Memory v2 engine and its storage adapters from `@kernova/core`:

```typescript
import { createMemoryEngine, PostgresMemoryAdapter } from '@kernova/sdk';
```

Adapters: `SqliteMemoryAdapter`, `PostgresMemoryAdapter`, `InMemoryAdapter`, `RedisMemoryAdapter`, `MongoDBMemoryAdapter`, `QdrantMemoryAdapter`, `TursoMemoryAdapter`, `SupabaseMemoryAdapter`, `PineconeMemoryAdapter`, `WeaviateMemoryAdapter`, `DynamoDBMemoryAdapter`, `FirestoreMemoryAdapter`.

Goal-oriented iterative execution is available through `executeLoop` and `DEFAULT_LOOP_CONFIG`.

## Troubleshooting

**`better-sqlite3` fails to install.** Install your platform's build tools (`xcode-select --install` on macOS, `build-essential` and `python3` on Linux, "Desktop development with C++" from Visual Studio Build Tools on Windows), then run `npm rebuild better-sqlite3`.

**`ERR_REQUIRE_ESM` or `Cannot use import statement outside a module`.** The SDK is ESM-only. Add `"type": "module"` to your `package.json`.

**No provider found.** Check that an API key environment variable is set in the same shell that runs your app, or run `npx @kernova/cli doctor`.

### Migrating from `Nexus`

`Nexus` and `NexusConfig` are deprecated aliases of `Kernova` and `KernovaConfig`. Replace the import and everything else keeps working.

## Related packages

| Package | Use it for |
|---------|-----------|
| [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) | Full-stack apps: file-based agents and React hooks |
| [`@kernova/core`](https://www.npmjs.com/package/@kernova/core) | The runtime kernel, for full control |
| [`@kernova/cli`](https://www.npmjs.com/package/@kernova/cli) | `kernova dev`, `build`, `deploy`, `doctor` |
| [`@kernova/types`](https://www.npmjs.com/package/@kernova/types) | Shared TypeScript types |

## Documentation and support

- [Quick start](https://kernova2026.vercel.app/getting-started/quick-start/)
- [SDK API reference](https://kernova2026.vercel.app/api/sdk/)
- [Model providers](https://kernova2026.vercel.app/guides/providers/)
- [Autonomy: scheduler, queue, triggers](https://kernova2026.vercel.app/guides/autonomy/)
- [Examples](https://kernova2026.vercel.app/guides/examples/)
- [Report a bug or request a feature](https://github.com/GodwinAdu/kernova/issues)

## Contributing

Contributions are welcome. See the [contributing guide](https://github.com/GodwinAdu/kernova/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
