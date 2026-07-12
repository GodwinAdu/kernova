# @kernova/sdk

The **simplest way to build intelligent applications** with Kernova.

5 lines from zero to a working AI app with memory, tools, and multi-agent coordination.

> **For full-stack apps (frontend + agents), use `@kernova/framework` instead:**
> ```bash
> npx create-kernova-app my-app
> ```
> The SDK is for backend-only agent services or when you have your own frontend.

## Installation

```bash
npm install @kernova/sdk
```

## Quick Start

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are helpful and concise.' });

const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "Paris"

await app.close();
```

Set your API key: `export OPENAI_API_KEY=sk-...`

### Autonomous Agent (Quick Start)

Chain scheduling, triggers, channels, and daemon mode to build always-on agents:

```typescript
import { Kernova, WebhookChannelAdapter } from '@kernova/sdk';

const app = await Kernova.create();

app
  .agent('ops-bot', { instructions: 'You monitor systems and respond to incidents.' })
  .schedule('health-check', '*/5 * * * *', async () => {
    console.log('Running health check...');
  })
  .trigger('on-alert', 'channel.message.*', { goal: 'Triage incoming alert' })
  .channel('webhooks', new WebhookChannelAdapter({ port: 3100 }))
  .onMessage(async (msg) => {
    console.log(`Received: ${msg.content}`);
  });

await app.serve(); // Runs until SIGINT/SIGTERM
```

## Features

### Define Agents (1 line)

```typescript
app.agent('writer', {
  instructions: 'You write clear, engaging technical content.',
});
```

### Add Tools (agents use them automatically)

```typescript
app.tool('search', {
  description: 'Search the web for information',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async ({ query }) => fetchSearchResults(query),
});

// Agent decides when to call search — no manual wiring needed
const { answer } = await app.ask('What happened in tech news today?');
```

### Persistent Memory (survives restarts)

```typescript
await app.remember('User prefers TypeScript over JavaScript', 'longterm');
await app.remember('Project uses PostgreSQL', 'longterm');

// Later — agent automatically has this context
const { answer } = await app.ask('Suggest a tech stack for my API');
// → Recommends TypeScript + PostgreSQL
```

### Search Memories

```typescript
const memories = await app.recall('programming preferences');
```

### Stream Responses (token by token)

```typescript
for await (const token of app.stream('Write a haiku about coding')) {
  process.stdout.write(token);
}
```

### Multi-Agent Delegation

```typescript
app.agent('researcher', { instructions: 'Research topics thoroughly.' });
app.agent('editor', {
  instructions: 'Coordinate research and writing.',
  async execute(intent, context, tools) {
    const research = await tools.delegate('researcher', intent.goal);
    const article = await tools.complete(`Write about: ${research.response}`);
    return { success: true, summary: article, evidence: { sources: [], confidence: 0.9 }, durationMs: 0 };
  },
});
```

### Budget Control

```typescript
const kernel = app.getKernel();
kernel.budget.setGlobalBudget({ maxTokens: 100_000, maxCostUsd: 5.00 });
```

---

## Autonomy Methods

### Scheduling

#### `app.schedule(name, cronOrDelay, handler)`

Register a recurring or one-shot scheduled job.

- `name` — unique job identifier
- `cronOrDelay` — cron expression (string) for recurring jobs, or delay in milliseconds (number) for one-shot jobs
- `handler` — async function to execute when the job fires

Returns the SDK instance for chaining.

```typescript
// Recurring cron job — runs every hour
app.schedule('hourly-report', '0 * * * *', async () => {
  const metrics = await gatherMetrics();
  await sendReport(metrics);
});

// One-shot job — fires once after 5 seconds
app.schedule('delayed-init', 5000, async () => {
  await warmUpCache();
});
```

---

### Task Queue

#### `app.enqueue(handler, payload, options?)`

Add a task to the priority queue for async processing with automatic retries.

- `handler` — handler name string used to route task execution
- `payload` — arbitrary data passed to the task handler
- `options.priority` — `'critical' | 'high' | 'medium' | 'low'` (default: `'medium'`)
- `options.maxRetries` — maximum retry attempts with exponential backoff (default: `3`)

Returns a `Promise<string>` resolving to the unique task ID.

```typescript
// Enqueue with default options
const taskId = await app.enqueue('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// Enqueue with high priority and custom retries
const urgentId = await app.enqueue('process-payment', { orderId: 'ord_123' }, {
  priority: 'critical',
  maxRetries: 5,
});
```

Tasks are persisted in SQLite and survive restarts. Failed tasks are retried with exponential backoff. After exhausting retries, tasks move to the dead-letter queue for manual inspection via `kernova queue status`.

---

### Channels

#### `app.channel(name, adapter)`

Register a channel adapter for inbound/outbound messaging.

- `name` — unique channel identifier
- `adapter` — a `ChannelAdapter` implementation (e.g., `WebhookChannelAdapter`, `WebSocketChannelAdapter`)

Returns the SDK instance for chaining.

```typescript
import { WebhookChannelAdapter, WebSocketChannelAdapter } from '@kernova/core';

// HTTP webhook receiver
app.channel('webhooks', new WebhookChannelAdapter({ port: 3100, path: '/incoming' }));

// WebSocket server with ping/pong keepalive
app.channel('ws', new WebSocketChannelAdapter({ port: 3200 }));
```

#### `app.onMessage(handler)`

Register a global message handler that receives inbound messages from all registered channels.

- `handler` — async function called with each `InboundMessage`

Returns the SDK instance for chaining.

```typescript
app.onMessage(async (msg) => {
  console.log(`[${msg.channel}] ${msg.sender}: ${msg.content}`);
  // Route to an agent, enqueue a task, etc.
});
```

---

### Triggers

#### `app.trigger(name, eventPattern, action)`

Register a proactive trigger rule that fires when events matching a glob pattern are published on the EventBus.

- `name` — unique trigger name
- `eventPattern` — glob-style pattern to match event types (e.g., `'channel.message.*'`, `'*.failed'`)
- `action` — trigger action definition:
  - `action.goal` — intent goal string submitted when the trigger fires
  - `action.priority` — optional intent priority (`'critical' | 'high' | 'medium' | 'low'`)
  - `action.cooldownMs` — minimum milliseconds between firings (default: `1000`)

Returns the SDK instance for chaining.

```typescript
// Fire on any incoming message
app.trigger('on-message', 'channel.message.*', {
  goal: 'Process incoming message',
  priority: 'high',
});

// Fire on intent failures with cooldown
app.trigger('on-failure', 'intent.failed', {
  goal: 'Investigate and retry failed intent',
  cooldownMs: 5000,
});
```

---

### Planning

#### `app.plan(goal, options?)`

Decompose a complex goal into steps and execute them sequentially using the Agent Planner (plan-and-execute pattern).

- `goal` — the high-level goal string for the LLM to decompose
- `options.maxSteps` — maximum number of steps to prevent unbounded execution (default: `10`)

Returns a `Promise<IntentResult>` with the overall outcome and step details.

```typescript
const result = await app.plan('Deploy the new version to staging');
console.log(result.summary);
// → "Plan completed: 4/4 steps executed"
console.log(result.data.steps);
// → [{ description: 'Run tests', status: 'completed' }, ...]

// Limit steps for constrained execution
const result = await app.plan('Migrate database schema', { maxSteps: 5 });
```

If a step fails, the planner automatically replans remaining steps based on the error context.

---

### Threads

#### `app.thread(threadId)`

Get or create a conversation thread for multi-turn dialogue with automatic sliding window context management.

- `threadId` — unique thread identifier (creates the thread if it doesn't exist)

Returns a `ThreadHandle` with the following methods:

| Method | Description |
|--------|-------------|
| `thread.addMessage(role, content)` | Add a message (`'user'`, `'assistant'`, or `'system'`) |
| `thread.getContext()` | Get `{ summary, messages }` formatted for model consumption |

```typescript
const thread = app.thread('support-session-42');

await thread.addMessage('user', 'How do I reset my password?');
await thread.addMessage('assistant', 'Go to Settings → Security → Reset Password.');
await thread.addMessage('user', 'Thanks! And how do I enable 2FA?');

const ctx = thread.getContext();
// ctx.messages — recent messages within the sliding window
// ctx.summary — summarized older messages (if window overflowed)
```

When messages exceed the configured window size (default: 50), older messages are automatically summarized and condensed.

---

### Daemon Mode

#### `app.serve(options?)`

Start the Kernel in daemon mode for persistent, always-on execution. Handles signal-based graceful shutdown and periodic heartbeat.

- `options.configPath` — path to agent config file or directory
- `options.watch` — enable hot-reload of config files (default: `false`)
- `options.port` — port for webhook/gateway listeners
- `options.dataDir` — data directory override
- `options.shutdownTimeoutMs` — graceful shutdown timeout in ms (default: `30000`)
- `options.heartbeatIntervalMs` — heartbeat interval in ms (default: `60000`)

Returns a `Promise<void>` that resolves when the daemon stops.

```typescript
// Basic daemon — runs until SIGINT/SIGTERM
await app.serve();

// With configuration
await app.serve({
  configPath: './agents/',
  watch: true,
  shutdownTimeoutMs: 10000,
  heartbeatIntervalMs: 30000,
});
```

The daemon:
- Starts all registered autonomy modules (scheduler, task queue, triggers)
- Handles SIGINT and SIGTERM for graceful shutdown
- Waits up to `shutdownTimeoutMs` for active intents to complete
- Emits `daemon.heartbeat` events at the configured interval

---

## Full API

| Method | Description |
|--------|-------------|
| `Kernova.create(config?)` | Create and start a Kernova instance |
| `app.agent(name, spec)` | Register an agent |
| `app.tool(name, spec)` | Register a tool |
| `app.ask(goal, options?)` | Submit an intent, get an answer |
| `app.stream(goal)` | Stream response tokens |
| `app.remember(content, layer?, tags?)` | Store a memory |
| `app.recall(query, options?)` | Search memories |
| `app.workflow(definition)` | Register a workflow |
| `app.runWorkflow(id, input?)` | Execute a workflow |
| `app.schedule(name, cronOrDelay, handler)` | Register a scheduled job (cron or one-shot) |
| `app.enqueue(handler, payload, options?)` | Add a task to the priority queue |
| `app.channel(name, adapter)` | Register a channel adapter |
| `app.onMessage(handler)` | Register a global message handler |
| `app.trigger(name, eventPattern, action)` | Register a proactive trigger rule |
| `app.plan(goal, options?)` | Plan and execute a complex goal |
| `app.thread(threadId)` | Get/create a conversation thread |
| `app.serve(options?)` | Start daemon mode |
| `app.getKernel()` | Access the underlying kernel |
| `app.close()` | Shut down gracefully |

## Backward Compatibility

The `Nexus` class is available as a deprecated alias for users migrating from older versions:

```typescript
import { Nexus } from '@kernova/sdk'; // ← deprecated, use Kernova instead
import { Kernova } from '@kernova/sdk'; // ← preferred
```

Both resolve to the same class.

## Supported Providers (20+)

Set any of these environment variables — Kernova auto-detects:

`OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `GEMINI_API_KEY` · `DEEPSEEK_API_KEY` · `GROQ_API_KEY` · `MISTRAL_API_KEY` · `TOGETHER_API_KEY` · `OPENROUTER_API_KEY` · `XAI_API_KEY` · `COHERE_API_KEY` · `FIREWORKS_API_KEY` · `PERPLEXITY_API_KEY`

Local (no key): Ollama · LM Studio · vLLM · llama.cpp

## Requirements

- Node.js 20+
- At least one AI model provider (or Ollama for local)

## Documentation

Full docs, guides, and API reference at [kernova.dev](https://kernova.dev)
