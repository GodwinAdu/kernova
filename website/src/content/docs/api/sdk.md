---
title: "@kernova/sdk"
description: Complete reference for the Kernova SDK — the high-level fluent API for building intelligent applications with agents, tools, memory, scheduling, and more.
---

The `@kernova/sdk` package is the developer-facing layer that wraps `@kernova/core` with a simplified, fluent API. It's what most developers use day-to-day to build intelligent applications — agents, tools, memory, scheduling, workflows, and channels — without touching the kernel directly.

**Main class:** `Kernova` (also available as deprecated `Nexus` alias)

## Installation & Quick Start

```bash
npm install @kernova/sdk
```

Get up and running in three lines:

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
app.agent('assistant', { instructions: 'You are a helpful AI.' });
const { answer } = await app.ask('What is 2 + 2?');
```

That's it. The kernel boots, an agent is registered, and you can start asking questions immediately.

---

## Kernova.create(config?)

Static factory method that creates and starts a new Kernova instance.

```typescript
static async create(config?: KernovaConfig): Promise<Kernova>
```

The kernel is auto-started — no need to call a separate `.start()` method.

```typescript
// Default configuration (development mode, local persistence)
const app = await Kernova.create();

// Production with custom data directory
const app = await Kernova.create({
  env: 'production',
  dataDir: '/var/kernova/data',
  debug: false,
});

// Ephemeral mode (no persistence, great for tests)
const app = await Kernova.create({ ephemeral: true });

// Restrict built-in tools
const app = await Kernova.create({
  builtInTools: {
    enabled: ['http-fetch', 'date-time'],
    sandboxDir: '/tmp/sandbox',
  },
});
```

---

## Method Reference

### Agent & Tool Definition

#### `app.agent(name, spec)`

Register an agent with the runtime.

```typescript
agent(name: string, spec: Partial<AgentSpec> & { instructions: string }): this
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique agent identifier |
| `spec.instructions` | `string` | System prompt / instructions (required) |
| `spec.description` | `string` | Human-readable description |
| `spec.capabilities` | `Capability[]` | What this agent can handle |
| `spec.tools` | `string[]` | Tool IDs the agent can invoke |
| `spec.execute` | `Function` | Custom execution function |

Returns `this` for chaining.

```typescript
app.agent('assistant', {
  instructions: 'You are a helpful assistant that answers user questions.',
});

app.agent('reviewer', {
  instructions: 'Review code for bugs and suggest improvements.',
  description: 'Code review specialist',
  tools: ['search', 'file-read'],
  execute: async (intent, ctx, tools) => {
    const code = await tools.call('file-read', { path: intent.metadata?.file });
    return { success: true, summary: `Reviewed: ${code.slice(0, 100)}...` };
  },
});
```

---

#### `app.tool(name, spec)`

Register a tool that agents can invoke during execution.

```typescript
tool(name: string, spec: {
  description: string;
  parameters?: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}): this
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique tool identifier |
| `spec.description` | `string` | What the tool does |
| `spec.parameters` | `object` | JSON Schema for parameters |
| `spec.execute` | `Function` | Tool implementation |

Returns `this` for chaining.

```typescript
app.tool('search', {
  description: 'Search the web for information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  },
  execute: async ({ query, limit }) => {
    const res = await fetch(`https://api.search.io?q=${query}&n=${limit || 5}`);
    return res.json();
  },
});
```

---

### Intent Submission

#### `app.ask(goal, options?)`

Submit a question or action to the agent runtime. This is the primary way to interact with your agents.

```typescript
async ask(goal: string, options?: AskOptions): Promise<AskResult>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `goal` | `string` | The question or task |
| `options.type` | `'query' \| 'action' \| 'observation'` | Intent type (default: `'query'`) |
| `options.priority` | `'critical' \| 'high' \| 'medium' \| 'low'` | Priority level (default: `'medium'`) |
| `options.owner` | `string` | Owner identifier |

Returns `Promise<AskResult>`.

```typescript
// Simple question
const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "Paris"

// Action with options
const result = await app.ask('Deploy the staging environment', {
  type: 'action',
  priority: 'high',
  owner: 'deploy-service',
});

if (result.success) {
  console.log(`Done in ${result.durationMs}ms`);
} else {
  console.error('Failed:', result.answer);
}
```

---

#### `app.stream(goal)`

Stream a response token-by-token. Useful for real-time UIs and CLI output.

```typescript
async *stream(goal: string): AsyncGenerator<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `goal` | `string` | The question or task |

Returns an `AsyncGenerator<string>` yielding individual tokens.

```typescript
// Stream to stdout
for await (const token of app.stream('Write a poem about recursion')) {
  process.stdout.write(token);
}

// Collect into a string
let full = '';
for await (const token of app.stream('Summarize this document')) {
  full += token;
}
```

---

### Memory

#### `app.remember(content, layer?, tags?)`

Store a piece of information in the memory engine.

```typescript
async remember(
  content: string,
  layer?: MemoryLayer,
  tags?: string[]
): Promise<MemoryEntry>
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `content` | `string` | — | The content to store |
| `layer` | `MemoryLayer` | `'longterm'` | Memory layer (`'shortterm'`, `'longterm'`, `'episodic'`) |
| `tags` | `string[]` | `[]` | Searchable tags |

Returns the created `MemoryEntry`.

```typescript
// Store a user preference
await app.remember('User prefers dark mode and TypeScript examples');

// Store with specific layer and tags
await app.remember(
  'Meeting at 3pm with engineering team',
  'episodic',
  ['meeting', 'engineering']
);
```

---

#### `app.recall(query, options?)`

Search stored memories by semantic similarity.

```typescript
async recall(
  query: string,
  options?: { layer?: MemoryLayer; limit?: number }
): Promise<MemoryEntry[]>
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | — | Search query |
| `options.layer` | `MemoryLayer` | all layers | Filter by layer |
| `options.limit` | `number` | `10` | Maximum results |

Returns an array of matching `MemoryEntry` objects.

```typescript
// Search across all layers
const memories = await app.recall('user preferences');

// Search within a specific layer with limit
const recent = await app.recall('meeting notes', {
  layer: 'episodic',
  limit: 5,
});

for (const mem of recent) {
  console.log(`[${mem.layer}] ${mem.content}`);
}
```

---

### Scheduling

#### `app.schedule(name, cronOrDelay, handler)`

Register a scheduled job. Supports recurring cron expressions or one-shot delays.

```typescript
schedule(
  name: string,
  cronOrDelay: string | number,
  handler: () => Promise<void>
): this
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique job identifier |
| `cronOrDelay` | `string` | Cron expression for recurring jobs |
| `cronOrDelay` | `number` | Delay in milliseconds for one-shot jobs |
| `handler` | `() => Promise<void>` | Function to execute |

Returns `this` for chaining.

```typescript
// Every hour at minute 0
app.schedule('hourly-report', '0 * * * *', async () => {
  const data = await gatherMetrics();
  await app.ask(`Summarize these metrics: ${JSON.stringify(data)}`);
});

// Every day at midnight
app.schedule('daily-cleanup', '0 0 * * *', async () => {
  await cleanupOldRecords();
});

// One-shot: fire after 5 seconds
app.schedule('delayed-init', 5000, async () => {
  await loadExternalConfig();
});
```

---

### Task Queue

#### `app.enqueue(handler, payload, options?)`

Add a task to the persistent task queue for background processing.

```typescript
async enqueue(
  handler: string,
  payload: unknown,
  options?: EnqueueOptions
): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `handler` | `string` | Handler name to route the task to |
| `payload` | `unknown` | Arbitrary payload data |
| `options.priority` | `Priority` | `'critical' \| 'high' \| 'medium' \| 'low'` |
| `options.maxRetries` | `number` | Max retry attempts (default: 3) |

Returns the unique `taskId` string.

```typescript
// Enqueue a simple task
const taskId = await app.enqueue('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// High-priority task with retries
const id = await app.enqueue(
  'process-payment',
  { orderId: 'ord_123', amount: 49.99 },
  { priority: 'critical', maxRetries: 5 }
);

console.log(`Enqueued task: ${id}`);
```

---

### Channels

#### `app.channel(name, adapter)`

Register a channel adapter for receiving external messages (webhooks, WebSocket, email, etc.).

```typescript
channel(name: string, adapter: SDKChannelAdapter): this
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Channel identifier |
| `adapter` | `SDKChannelAdapter` | Adapter instance |

Returns `this` for chaining.

```typescript
import { WebhookChannelAdapter } from '@kernova/core';

app.channel('webhooks', new WebhookChannelAdapter({ port: 3100 }));
app.channel('email', new EmailChannelAdapter({ provider: 'sendgrid' }));
```

---

#### `app.onMessage(handler)`

Register a global message handler that receives inbound messages from all registered channels.

```typescript
onMessage(handler: (msg: InboundMessage) => Promise<void>): this
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `handler` | `Function` | Async handler receiving `InboundMessage` |

Returns `this` for chaining.

```typescript
app.onMessage(async (msg) => {
  console.log(`[${msg.channel}] ${msg.sender}: ${msg.content}`);
  
  // Route the message to an agent
  const { answer } = await app.ask(msg.content);
  
  // Reply via the same channel
  await msg.reply(answer);
});
```

---

### Triggers

#### `app.trigger(name, eventPattern, action)`

Register a proactive trigger rule. When events matching the pattern fire on the EventBus, the specified action is submitted automatically.

```typescript
trigger(name: string, eventPattern: string, action: TriggerActionDef): this
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Trigger identifier |
| `eventPattern` | `string` | Glob-style event pattern |
| `action` | `TriggerActionDef` | Action to take (goal + options) |

Event patterns use glob-style wildcards:
- `channel.message.*` matches `channel.message.received`
- `*.created` matches `intent.created`, `agent.created`
- `intent.failed` matches exactly

Returns `this` for chaining.

```typescript
// Auto-respond to incoming messages
app.trigger('auto-reply', 'channel.message.*', {
  goal: 'Process and respond to the incoming message',
});

// Handle failures with a recovery agent
app.trigger('on-error', 'intent.failed', {
  goal: 'Analyze the failure and attempt recovery',
  priority: 'high',
});

// Trigger with cooldown (prevents rapid re-firing)
app.trigger('alert-on-error', 'intent.failed', {
  goal: 'Send alert about intent failure',
  priority: 'high',
  cooldownMs: 60000, // At most once per minute
});
```

---

### Conversation

#### `app.thread(threadId)`

Get a `ThreadHandle` for a named conversation thread. Creates the thread if it doesn't exist. Useful for managing multi-turn conversations with automatic sliding window enforcement.

```typescript
thread(threadId: string): ThreadHandle
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `threadId` | `string` | Unique thread identifier |

Returns a `ThreadHandle` instance.

```typescript
const thread = app.thread('support-session-abc');

await thread.addMessage('user', 'I need help with billing');
await thread.addMessage('assistant', 'Sure, I can help with that. What is your account ID?');
await thread.addMessage('user', 'ACC-12345');

const ctx = thread.getContext();
console.log(ctx.summary);   // Summary of older messages (if window exceeded)
console.log(ctx.messages);  // Recent messages within the window
```

---

### Planning

#### `app.plan(goal, options?)`

Decompose a complex goal into steps using the LLM planner, then execute them sequentially.

```typescript
async plan(
  goal: string,
  options?: { maxSteps?: number }
): Promise<IntentResult>
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `goal` | `string` | — | The high-level objective |
| `options.maxSteps` | `number` | `10` | Maximum steps the planner can generate |

Returns an `IntentResult` with plan execution details.

```typescript
// Simple plan
const result = await app.plan('Set up monitoring for all API endpoints');

if (result.success) {
  console.log(result.summary);
  // "Plan completed: 4/4 steps executed"
}

// With step limit
const result = await app.plan('Migrate database to new schema', {
  maxSteps: 5,
});

// Access detailed step information
console.log(result.data.steps);
// [
//   { description: 'Backup current database', status: 'completed' },
//   { description: 'Apply migration scripts', status: 'completed' },
//   { description: 'Verify data integrity', status: 'completed' },
// ]
```

---

### Workflows

#### `app.workflow(definition)`

Register a workflow definition for multi-step orchestration with conditional branching.

```typescript
workflow(definition: WorkflowDefinition): this
```

Returns `this` for chaining.

```typescript
app.workflow({
  id: 'onboarding',
  name: 'User Onboarding',
  steps: [
    { id: 'welcome', action: 'send-welcome-email', next: 'setup' },
    { id: 'setup', action: 'create-workspace', next: 'notify' },
    { id: 'notify', action: 'notify-team' },
  ],
});
```

---

#### `app.runWorkflow(id, input?)`

Execute a previously registered workflow.

```typescript
async runWorkflow(
  definitionId: string,
  input?: Record<string, unknown>
): Promise<WorkflowInstance>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `definitionId` | `string` | ID of the registered workflow |
| `input` | `object` | Input data passed to the first step |

Returns the `WorkflowInstance` with status and step results.

```typescript
const instance = await app.runWorkflow('onboarding', {
  userId: 'usr_456',
  email: 'new-user@example.com',
});

console.log(instance.status); // 'completed'
```

---

### Daemon

#### `app.serve(options?)`

Start the Kernova instance in daemon mode. Blocks until a shutdown signal is received (SIGINT/SIGTERM) or the daemon is manually stopped. Handles graceful shutdown and periodic heartbeat emission.

```typescript
async serve(options?: DaemonConfig): Promise<void>
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.shutdownTimeoutMs` | `number` | `5000` | Grace period for shutdown |
| `options.heartbeatIntervalMs` | `number` | `30000` | Heartbeat interval |

```typescript
// Basic daemon
await app.serve();

// With custom shutdown timeout
await app.serve({
  shutdownTimeoutMs: 10000,
  heartbeatIntervalMs: 60000,
});
```

---

### Kernel Access

#### `app.getKernel()`

Access the underlying `KernovaKernel` instance for advanced usage. Use this when you need direct access to subsystems not exposed by the SDK.

```typescript
getKernel(): KernovaKernel
```

```typescript
const kernel = app.getKernel();

// Direct access to subsystems
kernel.events.publish({ type: 'custom.event', data: { foo: 'bar' } });
kernel.plugins.list();
```

---

#### `app.close()`

Gracefully shut down the Kernova instance. Disconnects all channel adapters and stops the kernel.

```typescript
async close(): Promise<void>
```

```typescript
// Clean shutdown
await app.close();

// Common pattern: shutdown on process exit
process.on('SIGINT', async () => {
  await app.close();
  process.exit(0);
});
```

---

## ThreadHandle

A lightweight wrapper for managing a specific conversation thread.

```typescript
class ThreadHandle {
  readonly threadId: string;

  addMessage(role: 'user' | 'assistant' | 'system', content: string): Promise<void>;
  getContext(): { summary: string | null; messages: Message[] };
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `threadId` | `string` | The unique thread identifier (readonly) |

### Methods

#### `addMessage(role, content)`

Add a message to the thread. The sliding window is automatically enforced after adding — older messages are summarized when the window is exceeded.

```typescript
await thread.addMessage('user', 'Hello!');
await thread.addMessage('assistant', 'Hi there! How can I help?');
await thread.addMessage('system', 'Context: user is a premium subscriber');
```

#### `getContext()`

Get the current conversation context including any summary of older messages and the active messages within the sliding window.

```typescript
const ctx = thread.getContext();

// ctx.summary — null if no summarization has occurred yet, or a string
// ctx.messages — array of { role: string; content: string }
```

---

## Chaining Pattern

Methods that return `this` can be chained together for concise configuration:

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();

app
  .agent('assistant', { instructions: 'You are a helpful AI assistant.' })
  .agent('monitor', { instructions: 'Monitor system health and report issues.' })
  .tool('search', {
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async ({ query }) => fetch(`https://api.search.io?q=${query}`).then(r => r.json()),
  })
  .schedule('health-check', '*/5 * * * *', async () => {
    await app.ask('Run a system health check', { type: 'action' });
  })
  .trigger('on-error', 'intent.failed', {
    goal: 'Analyze failure and notify the team',
    priority: 'high',
  })
  .channel('hooks', webhookAdapter)
  .onMessage(async (msg) => {
    const { answer } = await app.ask(msg.content);
    await msg.reply(answer);
  });

await app.serve();
```

---

## Interfaces

### AskResult

Returned by `app.ask()`. Contains the agent's response and metadata.

```typescript
interface AskResult {
  /** Whether the intent completed successfully */
  success: boolean;

  /** The agent's response text */
  answer: string;

  /** The full Intent object with metadata and evidence */
  intent: Intent;

  /** Total execution time in milliseconds */
  durationMs: number;
}
```

---

### AskOptions

Options for `app.ask()`.

```typescript
interface AskOptions {
  /** Intent type (default: 'query') */
  type?: 'query' | 'action' | 'observation';

  /** Priority level (default: 'medium') */
  priority?: 'critical' | 'high' | 'medium' | 'low';

  /** Owner identifier */
  owner?: string;
}
```

---

### EnqueueOptions

Options for `app.enqueue()`.

```typescript
interface EnqueueOptions {
  /** Task priority (default: 'medium') */
  priority?: 'critical' | 'high' | 'medium' | 'low';

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
}
```

---

### KernovaConfig

Full configuration interface for `Kernova.create()`.

```typescript
interface KernovaConfig {
  /** Runtime environment (default: 'development') */
  env?: 'development' | 'staging' | 'production';

  /** Directory for persistent data — database, logs, etc. (default: './kernova-data') */
  dataDir?: string;

  /** Disable all persistence — runs entirely in memory (default: false) */
  ephemeral?: boolean;

  /** Enable debug logging (default: false) */
  debug?: boolean;

  /** Configuration for built-in tools */
  builtInTools?: BuiltInToolConfig;
}
```

---

### BuiltInToolConfig

Controls which built-in tools are available and their constraints.

```typescript
interface BuiltInToolConfig {
  /** Whitelist — only these tools are enabled (if set) */
  enabled?: string[];

  /** Blacklist — these tools are disabled (overrides `enabled`) */
  disabled?: string[];

  /** Root directory for file-read and file-write operations */
  sandboxDir?: string;

  /** Timeout for shell-exec in milliseconds (default: 30000) */
  shellTimeout?: number;
}
```

Available built-in tools: `http-fetch`, `file-read`, `file-write`, `shell-exec`, `date-time`, `web-search`.

---

### DaemonConfig

Options for `app.serve()`.

```typescript
interface DaemonConfig {
  /** Grace period for in-flight work on shutdown (default: 5000ms) */
  shutdownTimeoutMs?: number;

  /** Interval between heartbeat events (default: 30000ms) */
  heartbeatIntervalMs?: number;
}
```

---

## Exports

Everything exported from `@kernova/sdk`:

### Classes

| Export | Description |
|--------|-------------|
| `Kernova` | Main SDK class |
| `ThreadHandle` | Conversation thread wrapper |
| `Nexus` | **Deprecated** — alias for `Kernova` |

### Types

| Export | Description |
|--------|-------------|
| `KernovaConfig` | Configuration for `Kernova.create()` |
| `AskOptions` | Options for `app.ask()` |
| `AskResult` | Return type of `app.ask()` |
| `EnqueueOptions` | Options for `app.enqueue()` |
| `DaemonConfig` | Options for `app.serve()` |
| `BuiltInToolConfig` | Built-in tool configuration |
| `NexusConfig` | **Deprecated** — alias for `KernovaConfig` |

### Re-exported Types (from `@kernova/types`)

| Export | Description |
|--------|-------------|
| `Intent` | Full intent object with metadata and results |
| `IntentResult` | Structured result from intent execution |
| `MemoryLayer` | `'shortterm' \| 'longterm' \| 'episodic'` |
| `MemoryEntry` | Stored memory with content, layer, and tags |
| `AgentDefinition` | Agent configuration definition |
| `KernovaEvent` | Event bus event type |
| `TriggerActionDef` | Trigger action specification |
| `NexusEvent` | **Deprecated** — alias for `KernovaEvent` |

### Helper Functions

| Export | Description |
|--------|-------------|
| `agent(name, spec)` | Shorthand for defining agents (returns `AgentDefinition`) |
| `tool(name, spec)` | Shorthand for defining tools (returns plugin-ready object) |
| `workflow(def)` | Shorthand for defining workflows (returns `WorkflowDefinition`) |

```typescript
import { agent, tool, workflow } from '@kernova/sdk';

// These helpers are useful for defining agents/tools in separate files
export const searchTool = tool('search', {
  description: 'Web search',
  execute: async ({ query }) => { /* ... */ },
});

export const assistantAgent = agent('assistant', {
  instructions: 'You are helpful.',
});
```

---

## SDK vs Core — When to Use Which

| Use SDK when… | Use Core when… |
|---|---|
| Building applications | Building libraries or frameworks on top of Kernova |
| Want minimal boilerplate | Need full kernel lifecycle control |
| Standard agent + tool patterns | Custom execution pipelines |
| Fluent chaining API is sufficient | Need direct access to subsystems |
| Rapid prototyping | Building custom schedulers, routers, or planners |

The SDK is a thin layer over Core. You can always drop down via `app.getKernel()` when you need more control:

```typescript
const app = await Kernova.create();

// Use the SDK for 90% of your code
app.agent('assistant', { instructions: '...' });

// Drop down to Core for advanced cases
const kernel = app.getKernel();
kernel.events.subscribe('intent.*', (event) => {
  customMetrics.track(event);
});
```

---

## Complete Example

A fully autonomous agent application using multiple SDK features:

```typescript
import { Kernova } from '@kernova/sdk';

async function main() {
  // 1. Create the runtime
  const app = await Kernova.create({
    env: 'production',
    dataDir: './data',
    builtInTools: { enabled: ['http-fetch', 'date-time'] },
  });

  // 2. Define agents
  app
    .agent('assistant', {
      instructions: `You are a helpful assistant with access to web search and memory.
        Always check memory for user preferences before responding.`,
      tools: ['search', 'date-time'],
    })
    .agent('monitor', {
      instructions: 'You monitor system health. Report anomalies clearly and concisely.',
    });

  // 3. Register custom tools
  app.tool('search', {
    description: 'Search the web for current information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    execute: async ({ query }) => {
      const res = await fetch(`https://api.search.io/v2?q=${query}`);
      return res.json();
    },
  });

  // 4. Set up scheduled jobs
  app.schedule('health-check', '*/10 * * * *', async () => {
    const result = await app.ask('Check system health and report status', {
      type: 'action',
      priority: 'low',
    });
    if (!result.success) {
      console.error('[health-check] Failed:', result.answer);
    }
  });

  // 5. Register triggers
  app.trigger('auto-recovery', 'intent.failed', {
    goal: 'Analyze the most recent failure, determine root cause, and attempt recovery',
    priority: 'high',
    cooldownMs: 120000,
  });

  // 6. Set up a conversation thread
  const thread = app.thread('main-session');
  await thread.addMessage('system', 'This is the primary support session.');

  // 7. Store some initial memory
  await app.remember('System deployed on 2025-01-15. Running v2.4.0.', 'longterm', ['system']);
  await app.remember('Alert threshold: CPU > 90% for 5 minutes', 'longterm', ['config']);

  // 8. Register a workflow
  app.workflow({
    id: 'incident-response',
    name: 'Incident Response',
    steps: [
      { id: 'detect', action: 'detect-anomaly', next: 'analyze' },
      { id: 'analyze', action: 'root-cause-analysis', next: 'remediate' },
      { id: 'remediate', action: 'apply-fix', next: 'verify' },
      { id: 'verify', action: 'verify-resolution' },
    ],
  });

  // 9. Enqueue a startup task
  await app.enqueue('warmup-cache', { scope: 'all' }, { priority: 'high' });

  // 10. Start daemon mode (blocks until SIGINT/SIGTERM)
  console.log('Kernova agent running. Press Ctrl+C to stop.');
  await app.serve({ shutdownTimeoutMs: 10000 });
}

main().catch(console.error);
```

This example demonstrates agents, tools, scheduling, triggers, threads, memory, workflows, task queues, and daemon mode — all composed with the fluent SDK API.
