---
title: "@kernova/core"
description: Complete reference for the Kernova runtime kernel — every module, API, and usage pattern explained with examples.
---

# @kernova/core

The runtime kernel that powers every Kernova application. Like V8 is to Node.js, `@kernova/core` is to Kernova — it receives **Intents** and orchestrates their fulfillment through agents, tools, memory, and workflows.

## Installation

```bash
npm install @kernova/core
```

## Quick Start

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

const kernel = new KernovaKernel({
  environment: 'development',
  dataDir: './kernova-data',
  models: { default: { provider: 'openai', model: 'gpt-4o' } },
});

await kernel.start();

const result = await kernel.submit({
  goal: 'Summarize the latest sales report',
  intentType: 'query',
});

console.log(result.result?.summary);
await kernel.stop();
```

---

## KernovaKernel

The central orchestrator. Every other module is accessible through kernel accessor properties.

### Constructor

```typescript
const kernel = new KernovaKernel(config: KernelConfig);
```

### KernelConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `instanceId` | `string` | auto-generated | Unique identifier for this kernel instance |
| `environment` | `'development' \| 'staging' \| 'production'` | — | **Required.** Runtime environment |
| `debug` | `boolean` | `false` | Enable verbose console logging |
| `models` | `ModelRoutingConfig` | auto-detected | Model routing: default provider + purpose overrides |
| `providers` | `ModelProvider[]` | `[]` | Additional model providers (merged with auto-detected) |
| `dataDir` | `string` | `'./kernova-data'` | Directory for SQLite persistence |
| `ephemeral` | `boolean` | `false` | Disable all persistence (in-memory only) |
| `builtInTools` | `BuiltInToolConfig` | all enabled | Configure built-in tool availability |
| `reflection` | `object` | `{ enabled: true }` | Global self-reflection settings |

```typescript
interface KernelConfig {
  instanceId?: string;
  environment: 'development' | 'staging' | 'production';
  debug?: boolean;
  models?: ModelRoutingConfig;
  providers?: ModelProvider[];
  dataDir?: string;
  ephemeral?: boolean;
  builtInTools?: BuiltInToolConfig;
  reflection?: {
    enabled: boolean;
    threshold?: number;   // default: 0.7
    maxAttempts?: number; // default: 2
  };
}
```

### Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| `start()` | `() => Promise<void>` | Initialize all modules, open DB connections, begin event processing |
| `stop()` | `() => Promise<void>` | Graceful shutdown — drains active intents, closes connections |
| `submit()` | `(intent) => Promise<Intent>` | Submit an intent for agent execution (primary entry point) |
| `getStatus()` | `() => KernelStatus` | Returns running state, active intents, providers, usage |


### submit()

The primary entry point. Accepts a partial intent with at minimum a `goal` string.

```typescript
const result = await kernel.submit({
  goal: 'Draft an email to the team about the release',
  intentType: 'action',      // 'query' | 'action' | 'observation'
  priority: 'high',          // 'critical' | 'high' | 'medium' | 'low'
  owner: 'user-123',         // identity for permissions & budget
  metadata: { tag: 'comms' },
});

if (result.result?.success) {
  console.log(result.result.summary);
}
```

### Accessor Properties

| Property | Type | Description |
|----------|------|-------------|
| `kernel.events` | `EventBus` | Event pub/sub + persistence |
| `kernel.memoryEngine` | `MemoryEngine` | Five-layer memory system |
| `kernel.agentRegistry` | `AgentRegistry` | Agent management |
| `kernel.models` | `ModelRouter` | Model routing & completions |
| `kernel.plugins` | `PluginRegistry` | Plugin & tool management |
| `kernel.workflows` | `WorkflowEngine` | Multi-step workflow execution |
| `kernel.identity` | `IdentityManager` | Auth, users, permissions |
| `kernel.budget` | `BudgetManager` | Token budgets & cost caps |
| `kernel.scheduler` | `Scheduler` | Cron & one-shot jobs |
| `kernel.loops` | `BackgroundLoopModule` | Polling monitors |
| `kernel.taskQueue` | `TaskQueue` | Priority task queue |
| `kernel.triggers` | `ProactiveTriggerEngine` | Event-driven rules |
| `kernel.channels` | `ConnectorRegistry` | Channel adapters |
| `kernel.planner` | `AgentPlanner` | Plan-and-execute |
| `kernel.reflection` | `SelfReflection` | Quality evaluation |
| `kernel.conversation` | `ConversationManager` | Thread management |
| `kernel.rag` | `RAGPipeline` | Document retrieval |
| `kernel.mcp` | `MCPBridge` | Model Context Protocol |
| `kernel.gateway` | `AgentGateway` | HTTP API server |
| `kernel.metrics` | `MetricsCollector` | Runtime metrics |
| `kernel.health` | `HealthMonitor` | Health checks |
| `kernel.sandbox` | `SandboxManager` | Isolated execution |
| `kernel.builtInTools` | `BuiltInToolRegistry` | Built-in tool access |

---


## EventBus

The nervous system of the runtime. Every state change, action, and decision flows through the EventBus as a structured event. Supports wildcard pattern matching, persistent storage via SQLite, timeline queries, and retention policies.

### Key Exports

```typescript
import { EventBus } from '@kernova/core';
import type { EventBusConfig, EventQuery, EventStoreStats } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `publish(event)` | `(event: NexusEvent) => void` | Emit an event to all matching subscribers + persist |
| `subscribe(patterns, handler)` | `(patterns: string[], handler) => string` | Subscribe to events; returns subscription ID |
| `unsubscribe(id)` | `(id: string) => void` | Remove a subscription |
| `query(params)` | `(params: EventQuery) => NexusEvent[]` | Rich filtering (type, category, actor, time range) |
| `getTimeline(subjectId)` | `(subjectId: string, limit?: number) => NexusEvent[]` | All events for a specific entity |
| `getCorrelated(correlationId)` | `(correlationId: string, limit?: number) => NexusEvent[]` | Trace a full request flow |
| `count(params?)` | `(params?) => number` | Count matching events |
| `applyRetention(days)` | `(retentionDays: number) => number` | Delete events older than N days |
| `flush()` | `() => void` | Force pending writes to disk |

### Pattern Matching

Wildcards work at each dot-separated segment:

| Pattern | Matches |
|---------|---------|
| `"intent.*"` | `intent.created`, `intent.completed`, `intent.failed` |
| `"*.created"` | `intent.created`, `agent.created`, `workflow.created` |
| `"*"` | Everything |
| `"kernel.started"` | Exact match only |


### Example

```typescript
// Subscribe to all intent lifecycle events
const subId = kernel.events.subscribe(['intent.*'], (event) => {
  console.log(`[${event.eventType}] ${event.data.intentId}`);
});

// Subscribe to everything
kernel.events.subscribe(['*'], (event) => {
  metrics.track(event.eventType);
});

// Query recent errors
const errors = kernel.events.query({
  category: 'intent',
  severity: 'error',
  limit: 20,
  order: 'desc',
});

// Get the full timeline of a specific intent
const timeline = kernel.events.getTimeline('intent-abc123');

// Clean up old events
const deleted = kernel.events.applyRetention(30); // keep 30 days

// Unsubscribe when done
kernel.events.unsubscribe(subId);
```

### When to Use

- Reacting to system events in real-time (webhooks, notifications, logging)
- Auditing and compliance (full event history)
- Debugging with correlation tracing
- Building event-driven architectures on top of Kernova

---

## MemoryEngine

A five-layer memory architecture inspired by human cognition. Combines SQLite FTS5 full-text search with vector embeddings for semantic retrieval.

### Memory Layers

| Layer | Purpose | TTL |
|-------|---------|-----|
| `working` | Current task scratchpad | Minutes |
| `session` | Current conversation context | Hours (default 3600s) |
| `longterm` | Persistent user/agent knowledge | Months/Years |
| `organizational` | Shared team knowledge | Indefinite |
| `global` | System-wide facts | Indefinite |

### Key Exports

```typescript
import { MemoryEngine } from '@kernova/core';
import type { MemoryEngineConfig } from '@kernova/core';
```


### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `store(entry)` | `(entry: MemoryEntry) => string` | Store a memory; returns ID |
| `query(query)` | `(query: MemoryQuery) => MemoryEntry[]` | Search by text, tags, layer, time range |
| `get(id)` | `(id: string) => MemoryEntry \| null` | Retrieve a specific memory by ID |
| `delete(id)` | `(id: string) => boolean` | Remove a memory |
| `decay(options?)` | `(options?) => number` | Run decay — expire working/session memories past TTL |

### Example

```typescript
// Store a long-term memory
const memId = kernel.memoryEngine.store({
  content: 'User prefers concise responses under 200 words',
  layer: 'longterm',
  tags: ['preference', 'style'],
  owner: 'user-123',
});

// Semantic search across all layers
const results = kernel.memoryEngine.query({
  text: 'communication preferences',
  layer: 'longterm',
  owner: 'user-123',
  limit: 5,
});

// Store working memory (auto-expires)
kernel.memoryEngine.store({
  content: 'Currently drafting Q4 report',
  layer: 'working',
  tags: ['task-context'],
});

// Manual decay pass (usually automatic)
const expired = kernel.memoryEngine.decay({ maxAge: 3600 });
```

### When to Use

- Giving agents context about past interactions
- Storing user preferences and learned behaviors
- Building organizational knowledge bases
- Providing relevant context without exceeding token budgets

---

## ModelRouter

Routes completion requests to the right model provider based on configurable rules. Supports purpose-based overrides, fallback chains, streaming, embeddings, and 20+ auto-detected providers.

### Key Exports

```typescript
import { ModelRouter, createProvider, detectAvailableProviders } from '@kernova/core';
import type { ModelRouterConfig, ModelProvider } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `complete(request, purpose?)` | `(req, purpose?) => Promise<CompletionResponse>` | Single completion |
| `stream(request, purpose?)` | `(req, purpose?) => AsyncGenerator<StreamChunk>` | Streaming tokens |
| `embed(text)` | `(text: string) => Promise<number[]>` | Generate embedding vector |
| `getAvailableProviders()` | `() => ProviderInfo[]` | List detected providers |
| `getUsageStats()` | `() => UsageStats` | Token counts & costs |


### Routing Configuration

```typescript
const kernel = new KernovaKernel({
  environment: 'production',
  models: {
    default: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    purposes: {
      coding: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      summarization: { provider: 'openai', model: 'gpt-4o-mini' },
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    },
    fallback: ['openai', 'anthropic', 'gemini'],
  },
});
```

### Providers

Auto-detected from environment variables (API keys):

| Provider | Env Variable | Models |
|----------|-------------|--------|
| OpenAI | `OPENAI_API_KEY` | gpt-4o, gpt-4o-mini, o1, o3-mini |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514, claude-3.5-haiku |
| Google Gemini | `GOOGLE_API_KEY` | gemini-2.0-flash, gemini-1.5-pro |
| Ollama | (local, no key) | llama3, mistral, codellama, etc. |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat, deepseek-coder |
| Groq | `GROQ_API_KEY` | llama-3.1-70b, mixtral-8x7b |
| Together | `TOGETHER_API_KEY` | Various open models |
| OpenRouter | `OPENROUTER_API_KEY` | Aggregator — access 100+ models |
| Any OpenAI-compatible | Custom | Via `OpenAICompatibleProvider` |

### Creating Providers Manually

```typescript
import { createProvider, OpenAICompatibleProvider } from '@kernova/core';

// From presets
const deepseek = createProvider('deepseek');
const ollama = createProvider('ollama', { defaultModel: 'mistral' });

// Custom OpenAI-compatible endpoint
const custom = new OpenAICompatibleProvider({
  id: 'my-provider',
  name: 'My LLM',
  baseUrl: 'https://api.example.com/v1',
  apiKey: process.env.MY_API_KEY!,
  defaultModel: 'my-model',
});
```

### Example

```typescript
// Direct completion
const response = await kernel.models.complete({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing briefly.' },
  ],
});

// Streaming
for await (const chunk of kernel.models.stream({
  messages: [{ role: 'user', content: 'Write a poem about code' }],
}, 'creative')) {
  process.stdout.write(chunk.content || '');
}

// Embeddings for semantic search
const vector = await kernel.models.embed('machine learning concepts');
```

---


## AgentRegistry

Manages agent definitions, selection, and execution. Handles the tool-calling loop, inter-agent delegation, and provides the `AgentTools` interface to agent executors.

### Key Exports

```typescript
import { AgentRegistry } from '@kernova/core';
import type { AgentExecutor, AgentTools } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(definition, executor)` | `(def, exec) => void` | Register an agent |
| `unregister(id)` | `(id: string) => void` | Remove an agent |
| `selectAgent(intent, context)` | `(intent, ctx) => AgentInstance \| null` | Find best agent for an intent |
| `execute(instance, intent, context)` | `(agent, intent, ctx) => Promise<IntentResult>` | Run the agent |
| `list()` | `() => AgentDefinition[]` | All registered agents |
| `count()` | `() => number` | Number of registered agents |

### AgentTools Interface

Every agent executor receives a `tools` object with these capabilities:

| Method | Description |
|--------|-------------|
| `tools.complete(prompt)` | Plain LLM completion |
| `tools.stream(prompt)` | Streaming LLM completion |
| `tools.streamToString(prompt)` | Stream and collect full response |
| `tools.completeWithTools(prompt)` | LLM completion with automatic tool-calling loop |
| `tools.useTool(name, params)` | Invoke a specific tool directly |
| `tools.listTools()` | List available tools for this agent |
| `tools.delegate(agentId, goal)` | Delegate a sub-task to another agent |
| `tools.ask(agentId, question)` | Ask another agent a question |
| `tools.broadcast(goal)` | Send a goal to all agents |
| `tools.remember(content, layer?, tags?)` | Store a memory |
| `tools.recall(query, options?)` | Search memories |
| `tools.emit(eventType, data)` | Publish an event |
| `tools.log(message)` | Structured logging |

### Example

```typescript
import { defineAgent } from '@kernova/core';

const assistant = defineAgent({
  name: 'research-assistant',
  description: 'Researches topics and provides summaries',
  capabilities: [
    { id: 'research', name: 'Research', description: 'Web research', confidence: 0.9 },
  ],
  tools: [{ toolId: 'web-search', name: 'web-search', purpose: 'Search the web', required: true }],
  instructions: 'You are a research assistant. Search the web and provide concise summaries.',
});

kernel.agentRegistry.register(assistant.definition, assistant.executor);
```

---


## defineAgent()

The developer-facing API for creating agents. Returns a `{ definition, executor }` pair ready for registration. If no custom `execute` function is provided, uses a default LLM executor with automatic tool-calling.

### Key Exports

```typescript
import { defineAgent } from '@kernova/core';
import type { AgentSpec, DefinedAgent } from '@kernova/core';
```

### AgentSpec Interface

```typescript
interface AgentSpec {
  name: string;           // Agent name
  description: string;    // What the agent does
  capabilities: Capability[];  // What it can handle
  tools: ToolReference[];      // Tools it can use
  instructions: string;        // System prompt
  execute?: (intent, context, tools: AgentTools) => Promise<IntentResult>; // Custom logic
  reflection?: {
    enabled: boolean;
    threshold?: number;   // Override global (default 0.7)
    maxAttempts?: number; // Override global (default 2)
  };
}
```

### Default LLM Executor Behavior

When no `execute` function is provided, the agent:
1. Assembles instructions + context memories + intent goal into a prompt
2. If tools are available → uses `completeWithTools()` (LLM decides which tools to call)
3. If no tools → uses plain `complete()`
4. Returns the response with confidence scoring

### Example — Custom Executor

```typescript
const codeReviewer = defineAgent({
  name: 'code-reviewer',
  description: 'Reviews code for bugs and style issues',
  capabilities: [
    { id: 'review', name: 'Code Review', description: 'Analyzes code quality', confidence: 0.95 },
  ],
  tools: [{ toolId: 'file-read', name: 'file-read', purpose: 'Read source files', required: true }],
  instructions: 'You review code for correctness, performance, and style.',
  
  async execute(intent, context, tools) {
    const startTime = Date.now();
    
    // Read the file to review
    const file = await tools.useTool('file-read', { path: intent.goal });
    
    // Get LLM analysis
    const review = await tools.complete(
      `Review this code:\n\n${file}\n\nProvide specific feedback.`
    );
    
    // Remember findings for future context
    await tools.remember(`Reviewed code: ${intent.goal}`, 'session', ['review']);
    
    return {
      success: true,
      summary: review,
      data: review,
      evidence: {
        sources: [{ type: 'memory', ref: 'llm-response', label: 'Code review', consultedAt: new Date().toISOString() }],
        confidence: 0.9,
        reasoning: 'Automated code review completed',
      },
      durationMs: Date.now() - startTime,
    };
  },
});

kernel.agentRegistry.register(codeReviewer.definition, codeReviewer.executor);
```

---


## PluginRegistry

Manages tools, middleware hooks, and plugin lifecycle. Plugins can provide tools (callable functions), middleware (request/response interceptors), or both.

### Key Exports

```typescript
import { PluginRegistry } from '@kernova/core';
import type { KernovaPlugin, ToolDefinition, MiddlewareHook } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(plugin)` | `(plugin: KernovaPlugin) => Promise<void>` | Register a plugin |
| `unregister(id)` | `(id: string) => void` | Remove a plugin |
| `listTools()` | `() => ToolDefinition[]` | All available tools |
| `executeTool(id, params)` | `(id, params) => Promise<unknown>` | Execute a tool by ID |
| `listPlugins()` | `() => PluginInfo[]` | All registered plugins |

### Plugin Structure

```typescript
interface KernovaPlugin {
  id: string;
  name: string;
  version: string;
  type: 'tool' | 'middleware' | 'integration';
  tools?: ToolDefinition[];
  middleware?: MiddlewareHook[];
  onLoad?: (context: PluginContext) => Promise<void>;
  onUnload?: () => Promise<void>;
}

interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: JSONSchema;  // JSON Schema for input validation
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}
```

### Example

```typescript
await kernel.plugins.register({
  id: 'my-tools',
  name: 'My Custom Tools',
  version: '1.0.0',
  type: 'tool',
  tools: [
    {
      id: 'calculate',
      name: 'Calculator',
      description: 'Perform math calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to evaluate' },
        },
        required: ['expression'],
      },
      execute: async (params) => {
        const result = Function(`"use strict"; return (${params.expression})`)();
        return { result };
      },
    },
  ],
});
```

---

## WorkflowEngine

Executes multi-step workflows with support for parallel steps, conditional branching, approval gates, and compensation (rollback on failure).

### Key Exports

```typescript
import { WorkflowEngine } from '@kernova/core';
import type { WorkflowEngineConfig, ApprovalHandler } from '@kernova/core';
```


### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(definition)` | `(def: WorkflowDefinition) => void` | Register a workflow |
| `execute(definitionId, input?, options?)` | `(id, input?, opts?) => Promise<WorkflowInstance>` | Run a workflow |
| `getStatus(instanceId)` | `(id: string) => WorkflowStatus` | Check workflow progress |
| `cancel(instanceId)` | `(id: string) => void` | Cancel a running workflow |
| `list()` | `() => WorkflowDefinition[]` | All registered workflows |

### Example

```typescript
kernel.workflows.register({
  id: 'content-pipeline',
  name: 'Content Pipeline',
  steps: [
    {
      id: 'research',
      type: 'agent',
      agent: 'research-assistant',
      goal: 'Research {{input.topic}}',
    },
    {
      id: 'write',
      type: 'agent',
      agent: 'writer',
      goal: 'Write an article based on: {{steps.research.result}}',
      dependsOn: ['research'],
    },
    {
      id: 'review',
      type: 'approval',
      message: 'Review the draft before publishing',
      dependsOn: ['write'],
    },
    {
      id: 'publish',
      type: 'agent',
      agent: 'publisher',
      goal: 'Publish the article: {{steps.write.result}}',
      dependsOn: ['review'],
      compensation: {
        goal: 'Unpublish the article',
      },
    },
  ],
});

const instance = await kernel.workflows.execute('content-pipeline', {
  topic: 'AI in Healthcare',
});
```

### When to Use

- Multi-step processes that require coordination between agents
- Processes that need human approval at certain stages
- Operations that need rollback/compensation on failure
- Parallel task execution with dependency management

---

## Scheduler

Runs jobs on cron schedules or after a one-shot delay. Persists schedules to survive restarts and detects missed executions.

### Key Exports

```typescript
import { Scheduler } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(input)` | `(input: ScheduledJobInput) => string` | Register a job; returns ID |
| `remove(id)` | `(id: string) => void` | Remove a scheduled job |
| `list()` | `() => ScheduledJob[]` | All registered jobs |
| `get(id)` | `(id: string) => ScheduledJob \| undefined` | Get a specific job |

### ScheduledJobInput

```typescript
interface ScheduledJobInput {
  name: string;
  cronExpression?: string;   // e.g. '0 9 * * *' (daily at 9am)
  delayMs?: number;          // one-shot delay in milliseconds
  oneShot?: boolean;         // auto-disable after first fire
  target: {
    type: 'agent' | 'intent' | 'event';
    id?: string;
    goal?: string;
  };
}
```


### Example

```typescript
// Daily standup summary at 9am
kernel.scheduler.register({
  name: 'daily-standup',
  cronExpression: '0 9 * * 1-5', // Mon-Fri at 9:00
  target: {
    type: 'agent',
    id: 'standup-agent',
    goal: 'Generate daily standup summary from yesterday\'s activity',
  },
});

// One-shot reminder in 2 hours
kernel.scheduler.register({
  name: 'follow-up-reminder',
  delayMs: 2 * 60 * 60 * 1000,
  oneShot: true,
  target: {
    type: 'intent',
    goal: 'Remind user to follow up on the proposal',
  },
});

// List all jobs
const jobs = kernel.scheduler.list();
console.log(`${jobs.length} scheduled jobs`);
```

### When to Use

- Recurring agent tasks (daily reports, weekly cleanups)
- Delayed actions (reminders, follow-ups)
- Periodic data synchronization
- Any time-based automation

---

## TaskQueue

A priority queue with concurrency control, exponential backoff retries, and dead-letter handling for failed tasks.

### Key Exports

```typescript
import { TaskQueue } from '@kernova/core';
import type { TaskQueueConfig, TaskHandler } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerHandler(name, handler)` | `(name, handler: TaskHandler) => void` | Register a task handler |
| `enqueue(input)` | `(input: TaskInput) => string` | Add a task; returns task ID |
| `stats()` | `() => QueueStats` | Queue statistics |
| `deadLetters(filter?)` | `(filter?) => DeadLetter[]` | Get failed tasks |
| `replay(id)` | `(id: string) => void` | Retry a dead-lettered task |

### Priority Levels

Tasks are processed in priority order:

| Priority | Value | Use Case |
|----------|-------|----------|
| `critical` | 0 | System health, security alerts |
| `high` | 1 | User-facing requests |
| `medium` | 2 | Background processing (default) |
| `low` | 3 | Maintenance, analytics |

### Configuration

```typescript
interface TaskQueueConfig {
  concurrency?: number;     // 1-50, default: 5
  maxRetries?: number;      // default: 3
  backoffMs?: number;       // initial backoff, default: 1000
  maxBackoffMs?: number;    // cap, default: 30000
  deadLetterLimit?: number; // max dead letters kept
}
```


### Example

```typescript
// Register a handler
kernel.taskQueue.registerHandler('send-email', async (task) => {
  const { to, subject, body } = task.payload;
  await emailService.send(to, subject, body);
  return { sent: true };
});

// Enqueue tasks with priority
kernel.taskQueue.enqueue({
  handler: 'send-email',
  payload: { to: 'team@company.com', subject: 'Alert', body: '...' },
  priority: 'high',
});

kernel.taskQueue.enqueue({
  handler: 'send-email',
  payload: { to: 'analytics@company.com', subject: 'Weekly digest', body: '...' },
  priority: 'low',
});

// Check stats
const stats = kernel.taskQueue.stats();
console.log(`Pending: ${stats.pending}, Active: ${stats.active}, Failed: ${stats.failed}`);

// Replay a failed task
const deadLetters = kernel.taskQueue.deadLetters();
if (deadLetters.length > 0) {
  kernel.taskQueue.replay(deadLetters[0].id);
}
```

### When to Use

- Background job processing with guaranteed delivery
- Rate-limiting expensive operations (API calls, file processing)
- Prioritizing work when resources are limited
- Reliable task execution with retry semantics

---

## ProactiveTriggerEngine

Event-driven rules that fire actions when specific events occur. Supports cooldown periods and conditional execution.

### Key Exports

```typescript
import { ProactiveTriggerEngine } from '@kernova/core';
import type { TriggerEngineConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(input)` | `(input: TriggerRuleInput) => string` | Register a trigger rule |
| `remove(id)` | `(id: string) => void` | Remove a trigger |
| `enable(id)` | `(id: string) => void` | Enable a disabled trigger |
| `disable(id)` | `(id: string) => void` | Temporarily disable |
| `list()` | `() => TriggerRule[]` | All registered triggers |

### TriggerRuleInput

```typescript
interface TriggerRuleInput {
  name: string;
  eventPattern: string;          // Wildcard pattern: "intent.failed", "*.created"
  action: {
    goal: string;                // What to execute when triggered
    priority?: string;
  };
  cooldownMs?: number;           // Minimum time between firings (min: 100ms)
  condition?: (event) => boolean; // Programmatic condition
  conditionDescription?: string; // Human-readable description
}
```


### Example

```typescript
// Auto-retry failed intents
kernel.triggers.register({
  name: 'auto-retry-failures',
  eventPattern: 'intent.failed',
  action: {
    goal: 'Analyze why intent {{event.data.intentId}} failed and suggest fixes',
    priority: 'medium',
  },
  cooldownMs: 5000, // Don't fire more than once per 5 seconds
});

// Welcome new users
kernel.triggers.register({
  name: 'welcome-new-user',
  eventPattern: 'identity.created',
  action: {
    goal: 'Send a welcome message to the new user',
  },
  cooldownMs: 1000,
  conditionDescription: 'Only for human users, not service accounts',
});

// Disable a trigger temporarily
kernel.triggers.disable('trigger-abc123');
```

### When to Use

- Automated responses to system events
- Self-healing behaviors (retry on failure)
- Notification triggers
- Proactive agent behaviors based on system state changes

---

## BackgroundLoopModule

Polling monitors that run at configurable intervals. Support pause/resume for graceful resource management.

### Key Exports

```typescript
import { BackgroundLoopModule } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(loop)` | `(loop: LoopDefinition) => string` | Register a background loop |
| `remove(id)` | `(id: string) => void` | Remove a loop |
| `pause(id)` | `(id: string) => void` | Pause a running loop |
| `resume(id)` | `(id: string) => void` | Resume a paused loop |
| `list()` | `() => LoopInfo[]` | All registered loops |

### Example

```typescript
// Monitor system health every 30 seconds
kernel.loops.register({
  name: 'health-check',
  intervalMs: 30000,
  handler: async () => {
    const status = kernel.getStatus();
    if (status.activeIntents > 100) {
      kernel.events.publish({
        eventType: 'system.overloaded',
        // ...
      });
    }
  },
});

// Check for new emails every 5 minutes
kernel.loops.register({
  name: 'email-poll',
  intervalMs: 5 * 60 * 1000,
  handler: async () => {
    const newEmails = await emailClient.checkInbox();
    for (const email of newEmails) {
      await kernel.submit({ goal: `Process email: ${email.subject}` });
    }
  },
});
```

### When to Use

- Polling external services for changes
- Periodic health checks and monitoring
- Resource cleanup loops
- Any recurring background task that doesn't fit a cron schedule

---


## ConnectorRegistry

Channel adapters that bridge external messaging platforms to the kernel. Each adapter normalizes incoming messages into Intents and routes outgoing responses back to the original channel.

### Supported Channels

| Channel | Adapter | Transport |
|---------|---------|-----------|
| Slack | `SlackChannelAdapter` | WebSocket (Socket Mode) |
| Discord | `DiscordChannelAdapter` | WebSocket (Gateway) |
| WhatsApp | `WhatsAppChannelAdapter` | Webhook |
| Telegram | `TelegramChannelAdapter` | Webhook / Long-polling |
| Email | `EmailChannelAdapter` | IMAP/SMTP |
| Webhook | `WebhookChannelAdapter` | HTTP POST |
| WebSocket | `WebSocketChannelAdapter` | WS |

### Key Exports

```typescript
import { ConnectorRegistry, WebhookChannelAdapter, WebSocketChannelAdapter } from '@kernova/core';
import type { ConnectorRegistryConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(adapter)` | `(adapter: ChannelAdapter) => void` | Register a channel adapter |
| `unregister(channelId)` | `(id: string) => void` | Remove an adapter |
| `send(channelId, message)` | `(id, msg) => Promise<void>` | Send a message to a channel |
| `list()` | `() => ChannelInfo[]` | All registered channels |

### Example

```typescript
import { WebhookChannelAdapter } from '@kernova/core';

// Register a webhook channel
kernel.channels.register(new WebhookChannelAdapter({
  id: 'my-webhook',
  path: '/hooks/incoming',
  secret: process.env.WEBHOOK_SECRET,
}));

// Register a WebSocket channel
kernel.channels.register(new WebSocketChannelAdapter({
  id: 'realtime',
  port: 8080,
}));

// Send a message back to a channel
await kernel.channels.send('my-webhook', {
  content: 'Task completed successfully',
  metadata: { threadId: 'thread-123' },
});
```

### When to Use

- Building multi-channel AI assistants
- Receiving messages from Slack, Discord, or other platforms
- Real-time communication via WebSocket
- Webhook integrations with third-party services

---

## DaemonRunner

Persistent execution mode for Kernova. Wraps the kernel with signal handling (SIGINT/SIGTERM), periodic heartbeat emission, graceful shutdown, config file loading, and hot-reload.

### Key Exports

```typescript
import { DaemonRunner } from '@kernova/core';
import type { DaemonConfig } from '@kernova/core';
```

### DaemonConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `configPath` | `string` | — | Path to agent config file or directory |
| `watch` | `boolean` | `false` | Enable hot-reload of config files |
| `port` | `number` | — | Port for webhook/gateway listeners |
| `dataDir` | `string` | — | Data directory override |
| `shutdownTimeoutMs` | `number` | `30000` | Max wait for active intents on shutdown |
| `heartbeatIntervalMs` | `number` | `60000` | Heartbeat event interval |


### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `start()` | `() => Promise<void>` | Start daemon (resolves when stopped) |
| `stop()` | `() => Promise<void>` | Graceful shutdown |
| `isRunning()` | `() => boolean` | Check if running |
| `getLoadedConfigs()` | `() => Map<string, AgentConfigFile>` | Get loaded agent configs |

### Example

```typescript
import { KernovaKernel, DaemonRunner } from '@kernova/core';

const kernel = new KernovaKernel({
  environment: 'production',
  dataDir: '/var/lib/kernova',
});

await kernel.start();

const daemon = new DaemonRunner(kernel, {
  configPath: './agents/',
  watch: true,
  shutdownTimeoutMs: 15000,
  heartbeatIntervalMs: 30000,
});

// This blocks until SIGINT/SIGTERM is received
await daemon.start();
// Graceful shutdown has completed here
```

### When to Use

- Running Kernova as a long-lived background service
- Production deployments that need signal handling
- Loading agents from YAML/JSON config files with hot-reload
- Server processes that need heartbeat monitoring

---

## AgentPlanner

Implements the Plan-and-Execute pattern: decompose a complex goal into steps, execute them sequentially, and adaptively replan on failure.

### Key Exports

```typescript
import { AgentPlanner } from '@kernova/core';
import type { AgentPlannerConfig, StepExecutor } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `plan(goal, context?)` | `(goal, ctx?) => Promise<Plan>` | Generate a multi-step plan |
| `execute(plan, executor)` | `(plan, exec) => Promise<PlanResult>` | Execute all steps |
| `cancel(planId)` | `(planId: string) => void` | Cancel a running plan |

### Configuration

- `maxSteps`: Maximum steps per plan (default: 10)
- Adaptive replanning: If a step fails, the planner can revise remaining steps

### Example

```typescript
// Plan a complex task
const plan = await kernel.planner.plan(
  'Migrate the users database from PostgreSQL to MongoDB',
  { constraints: ['zero downtime', 'data validation required'] }
);

console.log(`Plan has ${plan.steps.length} steps`);
plan.steps.forEach((step, i) => {
  console.log(`  ${i + 1}. ${step.description}`);
});

// Execute with a custom step executor
const result = await kernel.planner.execute(plan, async (step) => {
  return kernel.submit({ goal: step.description, priority: 'high' });
});

if (result.success) {
  console.log('Migration completed successfully');
}
```

### When to Use

- Complex multi-step tasks that need decomposition
- Tasks where later steps depend on earlier results
- Scenarios requiring adaptive replanning on failure
- When you want the LLM to reason about approach before acting

---


## SelfReflection

Quality evaluation and regeneration loop. After an agent produces output, SelfReflection scores it against the original goal and optionally regenerates if below the confidence threshold.

### Key Exports

```typescript
import { SelfReflection, clampConfidence, resolveReflectionConfig } from '@kernova/core';
import type { SelfReflectionConfig, ReflectionToggleConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `reflect(output, goal, context?, agentId?)` | `(...) => Promise<ReflectionResult>` | Evaluate + optionally regenerate |
| `evaluate(output, goal, context?)` | `(...) => Promise<EvaluationResult>` | Score without regeneration |

### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable globally |
| `threshold` | `0.7` | Minimum confidence to accept output |
| `maxAttempts` | `2` | Max regeneration attempts |

### Utility Functions

- `clampConfidence(score)` — Clamp a confidence score to [0, 1]
- `resolveReflectionConfig(global, agent?)` — Merge global + per-agent reflection settings

### Example

```typescript
// Evaluate an agent's output
const evaluation = await kernel.reflection.evaluate(
  agentOutput,
  'Write a professional email to decline the meeting',
  { tone: 'polite but firm' }
);

console.log(`Confidence: ${evaluation.confidence}`);
console.log(`Feedback: ${evaluation.feedback}`);

// Full reflect loop (evaluate + regenerate if needed)
const result = await kernel.reflection.reflect(
  agentOutput,
  'Write a professional email to decline the meeting',
  { tone: 'polite but firm' },
  'email-agent'
);

if (result.regenerated) {
  console.log('Output was regenerated for higher quality');
  console.log(result.finalOutput);
}
```

### When to Use

- Ensuring output quality for user-facing responses
- Building self-improving agents that learn from feedback
- Quality gates before publishing content
- Confidence scoring for decision-making pipelines

---

## ConversationManager

Manages named conversation threads with sliding window context, automatic summarization when the window is exceeded, and thread archival.

### Key Exports

```typescript
import { ConversationManager } from '@kernova/core';
import type { ConversationManagerConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `create(threadId)` | `(id: string) => Thread` | Create a new thread |
| `retrieve(threadId)` | `(id: string) => Thread \| null` | Get an existing thread |
| `archive(threadId)` | `(id: string) => void` | Archive a thread |
| `addMessageToThread(threadId, role, content)` | `(...) => void` | Add a message |
| `getThreadContext(threadId)` | `(id) => Message[]` | Get windowed messages |
| `addMessage(role, content)` | `(role, content) => Promise<void>` | Add to default thread |

### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `windowSize` | `50` | Maximum messages in the sliding window |
| `autoSummarize` | `true` | Summarize older messages when window is exceeded |


### Example

```typescript
// Create a named conversation thread
kernel.conversation.create('support-ticket-456');

// Add messages
kernel.conversation.addMessageToThread('support-ticket-456', 'user', 
  'My deployment is failing with exit code 137');
kernel.conversation.addMessageToThread('support-ticket-456', 'assistant',
  'Exit code 137 indicates an OOM kill. Let me check your memory limits...');

// Get windowed context (respects sliding window + summarization)
const context = kernel.conversation.getThreadContext('support-ticket-456');

// Archive when done
kernel.conversation.archive('support-ticket-456');
```

### When to Use

- Multi-turn conversations with context management
- Keeping conversation history within token budgets
- Support ticket / thread-based interactions
- Any long-running conversation that needs summarization

---

## RAGPipeline

Retrieval-Augmented Generation pipeline. Ingest documents, chunk them with configurable strategies, and retrieve relevant context for agent prompts.

### Key Exports

```typescript
import { RAGPipeline } from '@kernova/core';
import type { RAGPipelineConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `ingest(content, source, metadata?)` | `(...) => Promise<string>` | Ingest a document; returns doc ID |
| `retrieve(query, options?)` | `(query, opts?) => Promise<Chunk[]>` | Retrieve relevant chunks |
| `getContext(query, options?)` | `(query, opts?) => Promise<string>` | Get pre-formatted context string |
| `remove(docId)` | `(id: string) => Promise<void>` | Remove an ingested document |
| `stats()` | `() => RAGStats` | Document/chunk counts |

### Chunking Strategies

| Strategy | Description |
|----------|-------------|
| `fixed` | Fixed character-length chunks |
| `recursive` | Recursive splitting on separators (paragraphs → sentences → words) |
| `sentence` | Split on sentence boundaries |
| `paragraph` | Split on paragraph boundaries |

### Example

```typescript
// Ingest documentation
await kernel.rag.ingest(
  fs.readFileSync('./docs/architecture.md', 'utf-8'),
  'architecture.md',
  { category: 'docs', version: '2.0' }
);

await kernel.rag.ingest(
  fs.readFileSync('./docs/api-reference.md', 'utf-8'),
  'api-reference.md',
  { category: 'docs', version: '2.0' }
);

// Retrieve relevant context for a query
const chunks = await kernel.rag.retrieve('How does authentication work?', {
  topK: 5,
  threshold: 0.7,
});

chunks.forEach(chunk => {
  console.log(`[${chunk.source}] Score: ${chunk.score}`);
  console.log(chunk.content);
});

// Or get a pre-formatted context string
const context = await kernel.rag.getContext('authentication flow', { topK: 3 });

// Check stats
const stats = kernel.rag.stats();
console.log(`${stats.documents} documents, ${stats.chunks} chunks indexed`);
```

### When to Use

- Providing agents with relevant documentation context
- Building knowledge bases from existing documents
- Grounding agent responses in source material
- Reducing hallucination by supplying factual context

---


## Built-in Tools

Kernova ships with a set of built-in tools that are automatically registered when the kernel starts. Each tool is sandboxed and configurable.

### Key Exports

```typescript
import { BuiltInToolRegistry, SandboxViolationError } from '@kernova/core';
import type { BuiltInToolConfig } from '@kernova/core';
```

### Available Tools

| Tool ID | Description |
|---------|-------------|
| `http-fetch` | Make HTTP requests (GET, POST, PUT, DELETE, PATCH) with configurable timeout |
| `file-read` | Read file contents (sandboxed to `sandboxDir`) |
| `file-write` | Write file contents (sandboxed to `sandboxDir`) |
| `shell-exec` | Execute shell commands (with timeout, sandboxed) |
| `date-time` | Get current date/time in various formats and timezones |
| `web-search` | Search the web (requires a `WebSearchProvider` implementation) |

### Configuration

```typescript
interface BuiltInToolConfig {
  enabled?: string[];     // Whitelist specific tools
  disabled?: string[];    // Blacklist specific tools
  sandboxDir?: string;    // Root directory for file operations
  shellTimeout?: number;  // Shell command timeout in ms
}
```

### Sandbox Enforcement

File operations (`file-read`, `file-write`) are restricted to the configured `sandboxDir`. Path traversal attempts (e.g., `../../etc/passwd`) throw a `SandboxViolationError`.

### Example

```typescript
const kernel = new KernovaKernel({
  environment: 'development',
  builtInTools: {
    enabled: ['http-fetch', 'file-read', 'date-time'], // Only these tools
    sandboxDir: './workspace',
    shellTimeout: 10000,
  },
});

// Tools are automatically available to agents
// In a custom agent executor:
async execute(intent, context, tools) {
  // Fetch external data
  const response = await tools.useTool('http-fetch', {
    url: 'https://api.example.com/data',
    method: 'GET',
    timeout: 5000,
  });

  // Read a local file
  const content = await tools.useTool('file-read', {
    path: 'notes.md',
  });

  // Get current time
  const now = await tools.useTool('date-time', {
    timezone: 'America/New_York',
    format: 'iso',
  });
}
```

### http-fetch Details

```typescript
// Parameters
{
  url: string;         // Required — the URL to fetch
  method?: string;     // GET, POST, PUT, DELETE, PATCH (default: GET)
  headers?: object;    // HTTP headers
  body?: string;       // Request body (for POST/PUT/PATCH)
  timeout?: number;    // Timeout in ms (default: 30000)
}

// Returns
{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
```

---

## IdentityManager

Manages users, agents, services, API keys, sessions, permissions, and organizations.

### Key Exports

```typescript
import { IdentityManager, ApiKeyManager, PermissionEngine, SessionManager } from '@kernova/core';
import type {
  RegisteredIdentity, Organization, ActorType,
  ApiKey, CreateKeyOptions,
  PermissionCheck, PermissionResult, Role,
  Session, CreateSessionOptions,
} from '@kernova/core';
```


### Sub-modules

| Sub-module | Accessor | Description |
|------------|----------|-------------|
| `IdentityManager` | `kernel.identity` | Core identity CRUD |
| `ApiKeyManager` | via identity | API key creation, validation, revocation |
| `PermissionEngine` | via identity | Role-based permission checks |
| `SessionManager` | via identity | Session creation, validation, expiry |

### Key Methods

| Method | Description |
|--------|-------------|
| `register(identity)` | Register a user, agent, or service identity |
| `get(id)` | Get identity by ID |
| `checkPermission(check)` | Check if an identity has a permission |
| `createApiKey(options)` | Create an API key for an identity |
| `validateApiKey(key)` | Validate and resolve an API key |
| `createSession(options)` | Create a session for an identity |
| `validateSession(token)` | Validate a session token |

### Actor Types

- `user` — Human users
- `agent` — AI agents
- `service` — Service accounts / integrations

### Example

```typescript
// Register a user
kernel.identity.register({
  type: 'user',
  name: 'Alice',
  email: 'alice@company.com',
  roles: ['admin'],
});

// Check permissions before executing
const check = kernel.identity.checkPermission({
  identityId: 'user-alice',
  resource: 'intent',
  action: 'submit',
});

if (!check.granted) {
  throw new Error(`Permission denied: ${check.reason}`);
}

// The kernel automatically enforces permissions in submit()
```

### When to Use

- Multi-user Kernova deployments
- API key-based authentication for external access
- Role-based access control (admin, user, viewer)
- Organization-level isolation

---

## BudgetManager

Token budgets, cost caps, and rate limiting per identity. Prevents runaway costs by blocking requests that exceed configured limits.

### Key Exports

```typescript
import { BudgetManager } from '@kernova/core';
import type { BudgetConfig, IdentityBudget, BudgetCheckResult } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `setGlobalBudget(config)` | `(config: BudgetConfig) => void` | Set system-wide budget |
| `setIdentityBudget(id, budget)` | `(id, budget) => void` | Set per-identity budget |
| `check(id, tokens?)` | `(id, tokens?) => BudgetCheckResult` | Check if request is allowed |
| `record(id, tokens)` | `(id, tokens: number) => void` | Record token usage |

### BudgetConfig

```typescript
interface BudgetConfig {
  maxTokens?: number;           // Total token budget
  maxCostUsd?: number;          // Cost cap in USD
  maxTokensPerIntent?: number;  // Per-request token limit
  requestsPerMinute?: number;   // Rate limit
}
```


### Example

```typescript
// Set a global daily budget
kernel.budget.setGlobalBudget({
  maxTokens: 1_000_000,
  maxCostUsd: 50.00,
  requestsPerMinute: 60,
});

// Set a per-user budget
kernel.budget.setIdentityBudget('user-123', {
  maxTokens: 100_000,
  maxTokensPerIntent: 4096,
  requestsPerMinute: 10,
});

// Check before expensive operations
const check = kernel.budget.check('user-123', 2000);
if (!check.allowed) {
  console.log(`Budget exceeded: ${check.reason}`);
  // The kernel does this automatically in submit()
}

// Record actual usage (also automatic after submit)
kernel.budget.record('user-123', 1523);
```

### When to Use

- Controlling costs in production
- Per-user or per-team token allocation
- Preventing abuse in multi-tenant setups
- Rate limiting expensive model calls

---

## AgentGateway

An HTTP API server that exposes kernel capabilities over REST. Includes an OpenAI-compatible `/v1/chat/completions` endpoint for drop-in replacement.

### Key Exports

```typescript
import { AgentGateway } from '@kernova/core';
import type { GatewayConfig, GatewayAuthConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `start()` | `() => Promise<void>` | Start the HTTP server |
| `stop()` | `() => Promise<void>` | Stop the server |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/v1/intents` | Submit an intent |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat endpoint |
| `POST` | `/hooks/:path` | Webhook receiver |

### Authentication

All endpoints (except `/health`) require a Bearer token in the `Authorization` header. Tokens are validated against the kernel's IdentityManager.

### Example

```typescript
// Start the gateway on the daemon's port
await kernel.gateway.start();

// From external clients:
// curl -X POST http://localhost:3000/v1/intents \
//   -H "Authorization: Bearer sk-xxx" \
//   -H "Content-Type: application/json" \
//   -d '{"goal": "Summarize today'\''s news", "priority": "medium"}'

// OpenAI-compatible endpoint (works with any OpenAI SDK):
// curl -X POST http://localhost:3000/v1/chat/completions \
//   -H "Authorization: Bearer sk-xxx" \
//   -H "Content-Type: application/json" \
//   -d '{"model": "kernova", "messages": [{"role": "user", "content": "Hello"}]}'
```

### When to Use

- Exposing Kernova as an API service
- Drop-in replacement for OpenAI API
- Receiving webhooks from external services
- Building UIs that talk to Kernova over HTTP

---


## MCPBridge

Model Context Protocol integration. Connect to external MCP servers (via stdio or SSE transport) and expose their tools to Kernova agents.

### Key Exports

```typescript
import { MCPBridge } from '@kernova/core';
import type { MCPBridgeConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `register(config)` | `(config: MCPServerConfig) => void` | Register an MCP server definition |
| `connect(serverId)` | `(id: string) => Promise<void>` | Connect to a registered server |
| `callTool(serverId, toolName, args)` | `(...) => Promise<unknown>` | Call a tool on an MCP server |
| `getAllTools()` | `() => MCPTool[]` | List all tools from all connected servers |
| `disconnect(serverId)` | `(id: string) => Promise<void>` | Disconnect from a server |
| `dispose()` | `() => Promise<void>` | Disconnect all and clean up |

### Supported Transports

| Transport | Description |
|-----------|-------------|
| `stdio` | Spawn a child process and communicate over stdin/stdout |
| `sse` | Connect to a server-sent events endpoint over HTTP |

### Example

```typescript
// Register an MCP server
kernel.mcp.register({
  id: 'filesystem',
  name: 'Filesystem MCP',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/workspace'],
});

// Connect
await kernel.mcp.connect('filesystem');

// List available tools
const tools = kernel.mcp.getAllTools();
tools.forEach(t => console.log(`${t.name}: ${t.description}`));

// Call a tool directly
const result = await kernel.mcp.callTool('filesystem', 'read_file', {
  path: '/path/to/file.txt',
});

// MCP tools are also automatically available to agents via the tool-calling loop

// Clean up
await kernel.mcp.disconnect('filesystem');
```

### When to Use

- Integrating with the MCP ecosystem (filesystem, databases, APIs)
- Extending Kernova with tools from third-party MCP servers
- Building bridges between Kernova and other AI tools
- Using existing MCP server implementations without rewriting

---

## MetricsCollector

Collects runtime metrics including token usage, request counts, latencies, and custom metrics. Provides periodic snapshots.

### Key Exports

```typescript
import { MetricsCollector } from '@kernova/core';
import type { MetricsSnapshot, MetricEntry, MetricsConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `start()` | `() => void` | Begin collecting metrics |
| `stop()` | `() => void` | Stop collection |
| `record(name, value, tags?)` | `(...) => void` | Record a custom metric |
| `snapshot()` | `() => MetricsSnapshot` | Get current metrics snapshot |
| `reset()` | `() => void` | Reset all counters |

### Example

```typescript
// Metrics auto-start with the kernel (if debug: true)
kernel.metrics.start();

// Record custom metrics
kernel.metrics.record('custom.operation.duration', 1523, { operation: 'sync' });

// Get a snapshot
const snapshot = kernel.metrics.snapshot();
console.log(`Total requests: ${snapshot.totalRequests}`);
console.log(`Total tokens: ${snapshot.totalTokens}`);
console.log(`Avg latency: ${snapshot.avgLatencyMs}ms`);
```

### When to Use

- Monitoring production deployments
- Tracking token usage over time
- Custom business metrics
- Integration with observability platforms (Datadog, Prometheus)

---


## HealthMonitor

Health check system with configurable checks and polling. Reports overall system health as `healthy`, `degraded`, or `unhealthy`.

### Key Exports

```typescript
import { HealthMonitor } from '@kernova/core';
import type { HealthStatus, HealthCheck, HealthMonitorConfig } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `addCheck(check)` | `(check: HealthCheck) => void` | Register a health check |
| `removeCheck(id)` | `(id: string) => void` | Remove a check |
| `check()` | `() => HealthStatus` | Run all checks and return status |
| `startPolling(intervalMs)` | `(ms: number) => void` | Begin periodic checks |
| `stopPolling()` | `() => void` | Stop periodic checks |

### Built-in Checks

The kernel automatically registers:
- **Kernel Running** — Is the kernel started?
- **Model Providers** — Are model providers available?

### Example

```typescript
// Add a custom health check
kernel.health.addCheck({
  id: 'database',
  name: 'Database Connection',
  check: async () => {
    try {
      await db.ping();
      return { state: 'healthy', message: 'Connected' };
    } catch (e) {
      return { state: 'unhealthy', message: e.message };
    }
  },
});

// Run all checks
const status = kernel.health.check();
console.log(`Overall: ${status.state}`); // 'healthy' | 'degraded' | 'unhealthy'
status.checks.forEach(c => {
  console.log(`  ${c.name}: ${c.state}`);
});

// Poll every 30 seconds (emits events on state changes)
kernel.health.startPolling(30000);
```

### When to Use

- Load balancer health endpoints
- Monitoring system dependencies
- Alerting on degraded state
- Kubernetes liveness/readiness probes

---

## SandboxManager

Provides isolated execution environments with path restrictions, resource limits, and policy enforcement.

### Key Exports

```typescript
import { SandboxManager } from '@kernova/core';
import type { SandboxConfig, SandboxPolicy } from '@kernova/core';
```

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `validatePath(path)` | `(path: string) => boolean` | Check if a path is within the sandbox |
| `resolvePath(path)` | `(path: string) => string` | Resolve a path within the sandbox |
| `getPolicy()` | `() => SandboxPolicy` | Get the current sandbox policy |

### Example

```typescript
// Validate before file operations
const safePath = kernel.sandbox.resolvePath('data/output.json');
// Returns: /absolute/path/to/kernova-data/data/output.json

// Attempting path traversal throws
try {
  kernel.sandbox.resolvePath('../../etc/passwd');
} catch (e) {
  // SandboxViolationError: Path traversal detected
}
```

### When to Use

- Restricting agent file access to a workspace
- Preventing path traversal attacks
- Enforcing security policies on tool execution

---


## Testing Utilities

Dedicated testing tools for verifying agent behavior without hitting live LLM APIs.

### Key Exports

```typescript
import { AgentTestRunner, MockModelProvider, ConversationSimulator } from '@kernova/core';
import type { AgentTestRunnerConfig } from '@kernova/core';
```

### AgentTestRunner

Runs test scenarios against registered agents and asserts on results.

```typescript
const runner = new AgentTestRunner(kernel, {
  timeout: 10000,
  verbose: true,
});

const result = await runner.run({
  name: 'basic-query-test',
  intent: { goal: 'What is 2+2?', intentType: 'query' },
  assertions: [
    (result) => result.success === true,
    (result) => result.summary?.includes('4'),
  ],
});

console.log(`Test ${result.passed ? 'PASSED' : 'FAILED'}`);

// Run multiple scenarios
const results = await runner.runAll([scenario1, scenario2, scenario3]);
const passed = results.filter(r => r.passed).length;
console.log(`${passed}/${results.length} tests passed`);
```

### MockModelProvider

A fake model provider that returns deterministic responses. Use in tests to avoid real API calls.

```typescript
const mockProvider = new MockModelProvider({
  defaultResponse: 'This is a mock response',
  responses: {
    'What is 2+2?': 'The answer is 4.',
    'Hello': 'Hi there!',
  },
});

const kernel = new KernovaKernel({
  environment: 'development',
  ephemeral: true,
  providers: [mockProvider],
  models: { default: { provider: 'mock', model: 'mock-model' } },
});
```

### ConversationSimulator

Simulates multi-turn conversations for integration testing.

```typescript
const simulator = new ConversationSimulator(kernel);

const result = await simulator.simulate([
  { role: 'user', content: 'Remember that my name is Alice' },
  { role: 'user', content: 'What is my name?' },
], { timeout: 30000 });

console.log(`Turns: ${result.turns.length}`);
result.turns.forEach(turn => {
  console.log(`  ${turn.role}: ${turn.content}`);
});
```

### When to Use

- Unit testing agent behavior
- Integration testing without API costs
- CI/CD pipelines for agent quality checks
- Regression testing after agent changes

---

## Configuration Reference

### Full KernelConfig

```typescript
import { KernovaKernel } from '@kernova/core';
import type { KernelConfig } from '@kernova/core';

const config: KernelConfig = {
  // Instance identification
  instanceId: 'my-app-prod-1',
  
  // Environment (required)
  environment: 'production',
  
  // Debug logging
  debug: false,
  
  // Model routing
  models: {
    default: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    purposes: {
      coding: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      summarization: { provider: 'openai', model: 'gpt-4o-mini' },
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    },
    fallback: ['openai', 'anthropic', 'gemini'],
  },
  
  // Additional providers (merged with auto-detected)
  providers: [],
  
  // Persistence directory
  dataDir: '/var/lib/kernova',
  
  // In-memory only (no SQLite)
  ephemeral: false,
  
  // Built-in tool configuration
  builtInTools: {
    enabled: ['http-fetch', 'file-read', 'file-write', 'date-time', 'web-search'],
    disabled: ['shell-exec'], // Disable dangerous tools in production
    sandboxDir: '/var/lib/kernova/workspace',
    shellTimeout: 10000,
  },
  
  // Self-reflection
  reflection: {
    enabled: true,
    threshold: 0.7,
    maxAttempts: 2,
  },
};

const kernel = new KernovaKernel(config);
```


### ModelRoutingConfig

```typescript
interface ModelRoutingConfig {
  // Default model for all requests
  default: {
    provider: string;  // e.g. 'openai', 'anthropic', 'gemini', 'ollama'
    model: string;     // e.g. 'gpt-4o', 'claude-sonnet-4-20250514'
  };
  
  // Purpose-specific overrides
  purposes?: Record<string, {
    provider: string;
    model: string;
  }>;
  
  // Fallback chain (tried in order if primary fails)
  fallback?: string[];
}
```

### Environment Variables

Model providers are auto-detected from these environment variables:

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google Gemini |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `TOGETHER_API_KEY` | Together AI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `MISTRAL_API_KEY` | Mistral |
| `COHERE_API_KEY` | Cohere |
| `PERPLEXITY_API_KEY` | Perplexity |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `XAI_API_KEY` | xAI (Grok) |
| `CEREBRAS_API_KEY` | Cerebras |
| `SAMBANOVA_API_KEY` | SambaNova |
| `OLLAMA_BASE_URL` | Ollama (local) |

No configuration needed — if the key exists, the provider is available.

---

## Additional Modules

### ModelFallbackManager

Automatic fallback when a provider fails. Tries providers in the configured fallback chain.

```typescript
// Configured via models.fallback in KernelConfig
// Automatic — no direct interaction needed
// Access: kernel.fallback
```

### TrajectoryRecorder

Records step-by-step execution traces for debugging. Enabled automatically when `debug: true`.

```typescript
// Access traces for debugging
const traces = kernel.trajectory.getTraces();
traces.forEach(trace => {
  console.log(`Intent: ${trace.goal}, Steps: ${trace.events.length}`);
});
```

### RateLimiter

Token-bucket rate limiter applied per identity. Configured via `BudgetConfig.requestsPerMinute`.

```typescript
import { RateLimiter } from '@kernova/core';
// Usually accessed indirectly through budget enforcement
// Direct access: kernel.rateLimiter
```

### ContextEngineManager

Pluggable context assembly. Register custom context engines that determine what information is assembled for each agent invocation.

```typescript
import { ContextEngineManager, DefaultContextEngine } from '@kernova/core';
import type { ContextEnginePlugin } from '@kernova/core';
```

### ToolAvailabilityEngine & ToolPolicyEngine

Control which tools are visible and allowed for each agent execution.

```typescript
// ToolAvailabilityEngine — declarative visibility rules
// ToolPolicyEngine — layered allow/deny policies
// Both applied automatically during intent execution
```

### HotReloader

Watches files for changes and reloads agent configs at runtime.

```typescript
import { HotReloader } from '@kernova/core';
import type { HotReloaderConfig } from '@kernova/core';
// Used internally by DaemonRunner when watch: true
```

### SecurityAuditor

Runs security checks against the kernel configuration and reports issues.

```typescript
import { SecurityAuditor } from '@kernova/core';
import type { AuditResult, AuditCheck, AuditSeverity } from '@kernova/core';
```

### PluginMarketplace

Discover and install plugins from a registry.

```typescript
import { PluginMarketplace } from '@kernova/core';
import type { MarketplaceConfig, PluginListing } from '@kernova/core';
```

---


## Complete Example

A full example combining multiple modules:

```typescript
import { KernovaKernel, defineAgent, DaemonRunner } from '@kernova/core';

// 1. Create the kernel
const kernel = new KernovaKernel({
  environment: 'production',
  dataDir: './kernova-data',
  models: {
    default: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    purposes: {
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    },
    fallback: ['openai', 'gemini'],
  },
  builtInTools: {
    disabled: ['shell-exec'],
    sandboxDir: './workspace',
  },
  reflection: { enabled: true, threshold: 0.75 },
});

// 2. Define agents
const researcher = defineAgent({
  name: 'researcher',
  description: 'Researches topics and provides detailed summaries',
  capabilities: [
    { id: 'research', name: 'Research', description: 'Deep research', confidence: 0.9 },
  ],
  tools: [
    { toolId: 'web-search', name: 'web-search', purpose: 'Search the web', required: true },
    { toolId: 'http-fetch', name: 'http-fetch', purpose: 'Fetch web pages', required: false },
  ],
  instructions: `You are an expert researcher. Search the web for accurate, 
    up-to-date information and provide comprehensive summaries with sources.`,
});

const writer = defineAgent({
  name: 'writer',
  description: 'Writes polished content based on research',
  capabilities: [
    { id: 'writing', name: 'Writing', description: 'Content creation', confidence: 0.95 },
  ],
  tools: [{ toolId: 'file-write', name: 'file-write', purpose: 'Save drafts', required: false }],
  instructions: `You are a professional writer. Create engaging, well-structured 
    content based on the provided context and research.`,
  reflection: { enabled: true, threshold: 0.8, maxAttempts: 3 },
});

// 3. Start the kernel and register agents
await kernel.start();
kernel.agentRegistry.register(researcher.definition, researcher.executor);
kernel.agentRegistry.register(writer.definition, writer.executor);

// 4. Ingest documents for RAG
await kernel.rag.ingest(
  'Company style guide: Use active voice, keep paragraphs under 3 sentences...',
  'style-guide.md',
  { category: 'guidelines' }
);

// 5. Set up a content workflow
kernel.workflows.register({
  id: 'blog-post',
  name: 'Blog Post Pipeline',
  steps: [
    { id: 'research', type: 'agent', agent: 'researcher', goal: 'Research: {{input.topic}}' },
    { id: 'write', type: 'agent', agent: 'writer', goal: 'Write blog post about: {{steps.research.result}}', dependsOn: ['research'] },
  ],
});

// 6. Schedule weekly content
kernel.scheduler.register({
  name: 'weekly-blog',
  cronExpression: '0 10 * * 1', // Monday at 10am
  target: { type: 'intent', goal: 'Run the blog-post workflow for trending AI topics' },
});

// 7. Set budget limits
kernel.budget.setGlobalBudget({ maxTokens: 500_000, maxCostUsd: 25.00 });

// 8. Subscribe to events for monitoring
kernel.events.subscribe(['intent.completed'], (event) => {
  console.log(`✓ Completed: ${event.data.intentId}`);
});

kernel.events.subscribe(['intent.failed'], (event) => {
  console.error(`✗ Failed: ${event.data.error}`);
});

// 9. Run as a daemon
const daemon = new DaemonRunner(kernel, {
  watch: true,
  configPath: './agents/',
  heartbeatIntervalMs: 30000,
});

await daemon.start(); // Blocks until SIGINT/SIGTERM
```

---

## Exports Summary

Everything exported from `@kernova/core`:

```typescript
// Core
export { KernovaKernel, defineAgent };
export type { KernelConfig, AgentSpec, DefinedAgent };

// Events
export { EventBus, EventStore };

// Memory
export { MemoryEngine, MemoryStore };

// Models
export { ModelRouter, OpenAIProvider, AnthropicProvider, GeminiProvider, OllamaProvider, OpenAICompatibleProvider };
export { createProvider, detectAvailableProviders, listPresets, createProviderFromConfig };

// Agents
export { AgentRegistry, AgentCoordinator };
export type { AgentExecutor, AgentTools };

// Plugins
export { PluginRegistry };
export type { KernovaPlugin, ToolDefinition, MiddlewareHook };

// Workflows
export { WorkflowEngine };

// Intelligence
export { AgentPlanner, SelfReflection, ConversationManager, RAGPipeline };

// Autonomy
export { Scheduler, TaskQueue, ProactiveTriggerEngine, BackgroundLoopModule };

// Channels
export { ConnectorRegistry, WebhookChannelAdapter, WebSocketChannelAdapter };

// Infrastructure
export { DaemonRunner, AgentGateway, MCPBridge };
export { MetricsCollector, HealthMonitor, SandboxManager };
export { IdentityManager, ApiKeyManager, PermissionEngine, SessionManager };
export { BudgetManager, RateLimiter };

// Testing
export { AgentTestRunner, MockModelProvider, ConversationSimulator };

// Built-in Tools
export { BuiltInToolRegistry, SandboxViolationError };

// Utilities
export { generateId, now, ValidationError, QueueFullError, ConnectorError };
```
