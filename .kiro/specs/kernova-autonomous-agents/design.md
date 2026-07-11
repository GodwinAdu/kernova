# Design Document

## Overview

This design specifies the implementation of autonomous agent infrastructure for Kernova. The work builds on existing modules in `@kernova/core` (scheduler, background-loop, task-queue, triggers, channels, planning, reflection, conversation) by:

1. Renaming `NexusKernel` → `KernovaKernel` and `Nexus` → `Kernova` across all packages
2. Adding a Daemon mode for persistent execution (`kernova serve` / `app.serve()`)
3. Enhancing the SDK with fluent methods for all autonomy features
4. Extending the CLI with management commands
5. Adding agent config file loading (YAML/JSON) with hot-reload
6. Adding built-in tools (http-fetch, file-read/write, shell-exec, date-time, web-search)
7. Enhancing existing modules where gaps exist (one-shot jobs, concurrency limits, etc.)

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Developer Code                            │
│   app.schedule() / app.channel() / app.serve() / app.plan()     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    @kernova/sdk (Kernova class)                   │
│   Fluent API → delegates to KernovaKernel subsystems             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    @kernova/core (KernovaKernel)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Scheduler│ │TaskQueue │ │ Channels │ │ Triggers │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Daemon   │ │ Planner  │ │Reflection│ │  Convo   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │ConfigLoad│ │BuiltTools│ │  Loops   │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
│                    ▼                                             │
│            [ SQLite + FTS5 ]                                     │
└─────────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    @kernova/cli                                   │
│   kernova serve | init | schedule | queue | triggers | status    │
└─────────────────────────────────────────────────────────────────┘
```

### Module Layout (in packages/core/src/)

```
core/src/
├── kernel.ts                  # KernovaKernel (renamed from NexusKernel)
├── daemon/
│   └── index.ts               # DaemonRunner class
├── scheduler/
│   └── index.ts               # Enhanced Scheduler (add one-shot jobs)
├── task-queue/
│   └── index.ts               # Enhanced TaskQueue (concurrency limit)
├── channels/
│   └── index.ts               # ConnectorRegistry + adapters
├── triggers/
│   └── index.ts               # ProactiveTriggerEngine
├── conversation/
│   └── index.ts               # ConversationManager
├── planning/
│   └── index.ts               # AgentPlanner
├── reflection/
│   └── index.ts               # SelfReflection
├── config-manager/
│   └── index.ts               # Enhanced ConfigManager (YAML/JSON agent files)
├── built-in-tools/
│   ├── index.ts               # Tool registry
│   ├── http-fetch.ts
│   ├── file-read.ts
│   ├── file-write.ts
│   ├── shell-exec.ts
│   ├── date-time.ts
│   └── web-search.ts
└── background-loop/
    └── index.ts               # BackgroundLoopModule
```

## Components and Interfaces

### KernovaKernel (packages/core/src/kernel.ts)

The central runtime class that orchestrates all subsystems. Renamed from `NexusKernel`.

```typescript
export class KernovaKernel {
  // Existing subsystems
  readonly events: EventBus;
  readonly memoryEngine: MemoryEngine;
  readonly agentRegistry: AgentRegistry;
  readonly models: ModelRouter;
  readonly plugins: PluginRegistry;
  readonly workflows: WorkflowEngine;
  readonly identity: IdentityManager;
  readonly budget: BudgetManager;

  // Autonomy modules
  readonly scheduler: Scheduler;
  readonly loops: BackgroundLoopModule;
  readonly taskQueue: TaskQueue;
  readonly triggers: ProactiveTriggerEngine;
  readonly channels: ConnectorRegistry;

  // Intelligence modules
  readonly planner: AgentPlanner;
  readonly reflection: SelfReflection;
  readonly conversation: ConversationManager;

  // New
  readonly builtInTools: BuiltInToolRegistry;

  start(): Promise<void>;
  stop(): Promise<void>;
  submit(intent: Partial<Intent> & { goal: string }): Promise<Intent>;
  getStatus(): KernelStatus;
}
```

### DaemonRunner (packages/core/src/daemon/index.ts)

```typescript
export interface DaemonConfig {
  configPath?: string;
  watch?: boolean;
  port?: number;
  dataDir?: string;
  shutdownTimeoutMs?: number;    // default: 30000
  heartbeatIntervalMs?: number;  // default: 60000
}

export class DaemonRunner {
  constructor(kernel: KernovaKernel, config: DaemonConfig);
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
```

### ChannelAdapter Interface (packages/types/src/autonomy.ts)

```typescript
export interface ChannelAdapter {
  readonly id: string;
  readonly type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: OutboundMessage): Promise<DeliveryReceipt>;
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}
```

### AgentConfigSchema (packages/core/src/config-manager/)

```typescript
export interface AgentConfigFile {
  name: string;
  description?: string;
  instructions: string;
  model?: string;
  tools?: string[];
  schedules?: Array<{
    name: string;
    cron?: string;
    delayMs?: number;
    goal: string;
  }>;
  triggers?: Array<{
    name: string;
    event: string;
    condition?: string;
    goal: string;
  }>;
  extends?: string;
}
```

### BuiltInToolRegistry (packages/core/src/built-in-tools/index.ts)

```typescript
export interface BuiltInToolConfig {
  enabled?: string[];     // Whitelist of enabled tool IDs
  disabled?: string[];    // Blacklist of disabled tool IDs
  sandboxDir?: string;    // Root directory for file operations
  shellTimeout?: number;  // Timeout for shell-exec (default: 30000ms)
}

export class BuiltInToolRegistry {
  constructor(config: BuiltInToolConfig);
  getTools(): ToolDefinition[];
  isEnabled(toolId: string): boolean;
}
```

### Kernova SDK Class (packages/sdk/src/kernova.ts)

```typescript
export class Kernova {
  static create(config?: KernovaConfig): Promise<Kernova>;

  // Existing methods
  agent(name: string, spec: AgentSpec): this;
  tool(name: string, spec: ToolSpec): this;
  ask(goal: string, options?: AskOptions): Promise<AskResult>;
  stream(goal: string): AsyncGenerator<string>;
  remember(content: string, layer?: MemoryLayer): Promise<MemoryEntry>;
  recall(query: string, options?: RecallOptions): Promise<MemoryEntry[]>;

  // New autonomy methods
  schedule(name: string, cronOrDelay: string | number, handler: () => Promise<void>): this;
  channel(name: string, adapter: ChannelAdapter): this;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): this;
  serve(options?: DaemonConfig): Promise<void>;
  enqueue(handler: string, payload: unknown, options?: EnqueueOptions): Promise<string>;
  trigger(name: string, eventPattern: string, action: TriggerActionDef): this;
  plan(goal: string, options?: PlanOptions): Promise<IntentResult>;
  thread(threadId: string): ThreadHandle;

  getKernel(): KernovaKernel;
  close(): Promise<void>;
}
```

## Data Models

### Scheduled Job (SQLite: `scheduled_jobs` table)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | Unique job identifier |
| name | TEXT NOT NULL | Human-readable job name |
| cron_expression | TEXT | 5-field cron (NULL for one-shot) |
| delay_ms | INTEGER | One-shot delay in ms (NULL for cron) |
| one_shot | INTEGER | 1 if auto-disable after fire |
| target_type | TEXT | 'intent' or 'agent' |
| target_goal | TEXT | Intent goal string |
| target_metadata | TEXT | JSON-serialized metadata |
| enabled | INTEGER | 1 = enabled, 0 = disabled |
| last_execution_at | TEXT | ISO timestamp |
| next_execution_at | TEXT | ISO timestamp |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### Task Queue Item (SQLite: `task_queue` table)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | Unique task identifier |
| handler | TEXT NOT NULL | Handler name for routing |
| payload | TEXT | JSON-serialized payload |
| priority | INTEGER | 0=low, 1=medium, 2=high, 3=critical |
| status | TEXT | pending/running/completed/failed/dead-lettered |
| attempt | INTEGER | Current attempt number |
| max_retries | INTEGER | Maximum retry count |
| scheduled_at | TEXT | When to attempt next (for backoff) |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### Dead Letter Item (SQLite: `dead_letter_queue` table)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | Dead letter entry ID |
| task_id | TEXT | Original task ID |
| handler | TEXT | Handler name |
| payload | TEXT | JSON payload |
| error_message | TEXT | Final error message |
| error_type | TEXT | Error class name |
| attempts | TEXT | JSON array of attempt records |
| dead_lettered_at | TEXT | ISO timestamp |
| status | TEXT | 'active' or 'replayed' |

### Conversation Thread (SQLite: `conversation_threads` table)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | Thread identifier |
| summary | TEXT | Summarized older messages |
| window_size | INTEGER | Max messages in active window |
| status | TEXT | 'active' or 'archived' |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### Conversation Message (SQLite: `conversation_messages` table)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | Message ID |
| thread_id | TEXT | FK to conversation_threads |
| role | TEXT | 'user', 'assistant', 'system' |
| content | TEXT | Message content |
| position | INTEGER | Order within thread |
| created_at | TEXT | ISO timestamp |

### Trigger Rule (SQLite: `trigger_rules` table)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PRIMARY KEY | Rule identifier |
| name | TEXT NOT NULL | Human-readable name |
| event_pattern | TEXT | Glob pattern for event matching |
| condition_description | TEXT | Human-readable condition |
| action_goal | TEXT | Intent goal to submit |
| action_priority | TEXT | Intent priority |
| action_metadata | TEXT | JSON metadata |
| enabled | INTEGER | 1 = enabled |
| cooldown_ms | INTEGER | Minimum ms between firings |
| last_fired_at | TEXT | ISO timestamp |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

## Error Handling

### Daemon Startup Failures

- If the Kernel fails to initialize (e.g., SQLite cannot open), the DaemonRunner logs the error and exits with code 1.
- Individual autonomy module failures during startup cause a rollback: previously started modules are stopped in reverse order before re-throwing.

### Scheduler Job Failures

- If a job handler throws, the error is caught, a `scheduler.job.failed` event is emitted, and other jobs continue unaffected.
- One-shot jobs that fail are still marked as executed (they don't retry automatically).

### Task Queue Retries

- Failed tasks are retried with exponential backoff: `delay = baseDelay * 2^attempt` (base: 1000ms).
- After `maxRetries` failures, the task is moved to the dead-letter queue with full error history.
- Dead-lettered tasks can be manually replayed via CLI or SDK.

### Channel Connection Failures

- On connection failure, the adapter retries with exponential backoff (1s, 2s, 4s, 8s, 16s) up to 5 attempts.
- After 5 failed attempts, the channel is marked as `failed` and a `channel.connection.failed` event is emitted.
- The channel can be manually reconnected later.

### Config File Errors

- Invalid YAML/JSON syntax: error logged with file path, file skipped.
- Missing required fields: validation error with field name, file skipped.
- Hot-reload errors: old agent definition remains active, error logged.

### Sandbox Violations

- `file-read`, `file-write`, and `shell-exec` reject operations outside the configured sandbox directory.
- Violations throw a `SandboxViolationError` that is returned to the agent as a tool error result.

## Design Decisions

### 1. Rename Strategy: Re-export with Deprecation

**Decision:** Rename the class to `KernovaKernel` and create a deprecated re-export alias `NexusKernel = KernovaKernel`. Same pattern for `Kernova` (SDK) and all `Nexus`-prefixed types.

**Rationale:** Breaks no existing consumer code. Allows gradual migration. TypeScript `@deprecated` JSDoc tag provides IDE warnings.

### 2. Daemon Mode: Thin Wrapper over Kernel

**Decision:** The `DaemonRunner` is a lightweight class that wraps `KernovaKernel.start()` with signal handling, heartbeat, and config file loading. It is NOT a separate process manager (no PM2/systemd integration).

**Rationale:** Kernova is a developer platform. Developers choose their own process managers. The daemon provides the minimal lifecycle: start → run → graceful stop.

### 3. Agent Config Files: YAML-First with JSON Fallback

**Decision:** Use a YAML-based format (`.agent.yaml`) as the primary declarative format. JSON is supported for programmatic generation. Config schema is validated with a JSON Schema.

**Rationale:** YAML is more human-friendly for configuration. Supports comments. Aligns with industry patterns (Docker Compose, GitHub Actions, Kubernetes).

### 4. Built-in Tools: Registered as Internal Plugins

**Decision:** Built-in tools are registered via the existing `PluginRegistry` as an internal plugin (`@kernova/built-in-tools`). They respect the sandbox policy.

**Rationale:** Reuses existing tool execution infrastructure. No special code paths. Sandbox policy is already implemented.

### 5. One-Shot Jobs: Delay-Based with Scheduler

**Decision:** Extend the existing `Scheduler` to accept a `delayMs` field instead of `cronExpression`. One-shot jobs auto-disable after firing.

**Rationale:** Keeps all time-based execution in one module. Avoids a separate `setTimeout` system.

### 6. Task Queue Concurrency: Configurable Worker Pool

**Decision:** The `TaskQueue` gets a `concurrency` option (default: 5). Tasks are dequeued in priority+FIFO order and executed up to the concurrency limit.

**Rationale:** Prevents resource exhaustion while allowing parallel processing. SQLite handles ordering.

### 7. Channel Adapters: Interface + Built-in Webhook/WebSocket

**Decision:** Define a `ChannelAdapter` interface in types. Ship `WebhookChannelAdapter` and `WebSocketChannelAdapter` in core. Third-party adapters (Slack, Discord, etc.) remain as separate packages.

**Rationale:** Webhooks and WebSockets are universal. Platform-specific adapters have dependencies that shouldn't be in core.

### 8. Conversation Summarization: Model-Based with Fallback

**Decision:** When messages exceed the sliding window, use the configured model to summarize. If no model is available, truncate to the most recent messages.

**Rationale:** Graceful degradation. Not all environments have model access at all times.

## Implementation Details

### Phase 1: Rename (Requirement 1)

1. Rename `NexusKernel` class to `KernovaKernel` in `packages/core/src/kernel.ts`
2. Add `export const NexusKernel = KernovaKernel;` with `@deprecated` tag
3. Rename `Nexus` class to `Kernova` in `packages/sdk/src/nexus.ts` (file rename to `kernova.ts`)
4. Add `export const Nexus = Kernova;` with `@deprecated` tag
5. In `@kernova/types`, rename all `Nexus*` types to `Kernova*` with deprecated aliases
6. Update all internal imports to use new names

### Phase 2: Daemon Mode (Requirement 2)

```typescript
// packages/core/src/daemon/index.ts
export interface DaemonConfig {
  configPath?: string;        // Path to agent config file or directory
  watch?: boolean;            // Enable hot-reload of config files
  port?: number;              // Port for webhook/gateway listeners
  dataDir?: string;           // Data directory override
  shutdownTimeoutMs?: number; // Graceful shutdown timeout (default: 30000)
  heartbeatIntervalMs?: number; // Heartbeat interval (default: 60000)
}

export class DaemonRunner {
  constructor(private kernel: KernovaKernel, private config: DaemonConfig) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
```

### Phase 3: Scheduler Enhancement (Requirement 3)

Extend existing `ScheduledJobInput` with optional one-shot support:

```typescript
export interface ScheduledJobInput {
  name: string;
  cronExpression?: string;    // 5-field cron (mutually exclusive with delayMs)
  delayMs?: number;           // One-shot delay in ms
  target: ScheduleTarget;
  oneShot?: boolean;          // Auto-disable after first execution
}
```

### Phase 4: Task Queue Enhancement (Requirement 4)

Add concurrency configuration:

```typescript
export interface TaskQueueConfig {
  dataDir: string;
  concurrency?: number;       // Default: 5
  pollIntervalMs?: number;    // Default: 1000
}
```

### Phase 5: Channel System (Requirement 5)

```typescript
// packages/types/src/autonomy.ts (additions)
export interface ChannelAdapter {
  readonly id: string;
  readonly type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: OutboundMessage): Promise<DeliveryReceipt>;
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}
```

Built-in adapters:
- `WebhookChannelAdapter`: Starts an HTTP server, accepts POST at configurable path
- `WebSocketChannelAdapter`: Starts a WS server, manages client connections

### Phase 6: Agent Config Files (Requirement 8)

```yaml
# example.agent.yaml
name: my-assistant
instructions: |
  You are a helpful assistant that manages tasks.
model: gpt-4o
tools:
  - http-fetch
  - file-read
  - date-time
schedules:
  - name: hourly-check
    cron: "0 * * * *"
    goal: "Check for new tasks"
triggers:
  - name: on-new-email
    event: "channel.message.received"
    condition: "event.data.channel === 'email'"
    goal: "Process new email"
```

### Phase 7: Built-in Tools (Requirement 9)

Each tool follows the existing `ToolDefinition` interface:

```typescript
export const httpFetchTool: ToolDefinition = {
  id: 'http-fetch',
  name: 'HTTP Fetch',
  description: 'Make HTTP requests to external URLs',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
      headers: { type: 'object' },
      body: { type: 'string' },
    },
    required: ['url'],
  },
  execute: async (params) => { /* implementation */ },
};
```

### Phase 8: SDK Extensions (Requirement 13)

```typescript
// packages/sdk/src/kernova.ts (new methods on Kernova class)
class Kernova {
  schedule(name: string, cronOrDelay: string | number, handler: () => Promise<void>): this;
  channel(name: string, adapter: ChannelAdapter): this;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): this;
  serve(options?: DaemonConfig): Promise<void>;
  enqueue(handler: string, payload: unknown, options?: { priority?: Priority; maxRetries?: number }): Promise<string>;
  trigger(name: string, eventPattern: string, handler: TriggerActionDef): this;
  plan(goal: string, options?: { maxSteps?: number }): Promise<IntentResult>;
  thread(threadId: string): ThreadHandle;
}
```

### Phase 9: CLI Extensions (Requirement 12)

New commands added to `packages/cli/src/commands/`:
- `serve.ts` — Starts daemon mode
- `schedule.ts` — `list`, `enable <id>`, `disable <id>`
- `queue.ts` — `status`, `replay <id>`
- `triggers.ts` — `list`

## Correctness Properties

### Property 1: Scheduler Cron Parsing Produces Valid Next Execution Times

For all valid 5-field cron expressions, the scheduler SHALL compute a `nextExecutionAt` timestamp that is in the future relative to the current time.

**Validates: Requirements 3.1**

```
∀ cron ∈ ValidCronExpressions:
  nextExecution(cron, now) > now
```

### Property 2: Task Queue Priority Ordering

For any set of enqueued tasks, the task queue SHALL dequeue tasks in descending priority order (critical > high > medium > low). Within the same priority level, tasks SHALL be dequeued in FIFO order.

**Validates: Requirements 4.1, 4.2**

```
∀ tasks ∈ Queue where tasks[i].priority > tasks[j].priority:
  dequeueOrder(tasks[i]) < dequeueOrder(tasks[j])
  
∀ tasks ∈ Queue where tasks[i].priority == tasks[j].priority ∧ tasks[i].createdAt < tasks[j].createdAt:
  dequeueOrder(tasks[i]) < dequeueOrder(tasks[j])
```

### Property 3: Scheduler Job Persistence Round-Trip

For all scheduled jobs registered with the scheduler, stopping and restarting the scheduler SHALL preserve the job definition (name, cron expression, enabled state) without data loss.

**Validates: Requirements 3.4, 3.5**

```
∀ job ∈ RegisteredJobs:
  stop() → start() → getJob(job.id) ≡ job
```

### Property 4: Task Queue Persistence Round-Trip

For all tasks in the queue (pending or running), stopping and restarting the task queue SHALL preserve the task's payload, priority, and status.

**Validates: Requirements 4.5**

```
∀ task ∈ Queue where task.status ∈ {pending, running}:
  stop() → start() → getTask(task.id).payload ≡ task.payload
```

### Property 5: Conversation Sliding Window Invariant

For any conversation thread, the number of messages in the active window SHALL never exceed the configured sliding window size.

**Validates: Requirements 6.1**

```
∀ thread ∈ Threads:
  thread.activeMessages.length ≤ thread.windowSize
```

### Property 6: Conversation Thread Persistence Round-Trip

For all conversation threads, stopping and restarting the conversation manager SHALL preserve all messages and thread metadata.

**Validates: Requirements 6.6**

```
∀ thread ∈ Threads:
  stop() → start() → getThread(thread.id).messages ≡ thread.messages
```

### Property 7: Trigger Cooldown Enforcement

For any trigger rule with cooldown period C, the trigger SHALL NOT fire more than once within any time window of duration C.

**Validates: Requirements 11.3**

```
∀ trigger ∈ Rules, ∀ t1, t2 ∈ FiringTimes(trigger):
  |t1 - t2| ≥ trigger.cooldownMs
```

### Property 8: Trigger Event Pattern Matching

For all events published on the EventBus, if an event's type matches a trigger's glob pattern, the trigger's condition is evaluated. If both pattern and condition match, an intent is submitted.

**Validates: Requirements 11.1, 11.2**

```
∀ event ∈ Events, ∀ trigger ∈ ActiveRules:
  globMatch(event.eventType, trigger.eventPattern) ∧ trigger.condition(event) → intentSubmitted
```

### Property 9: Task Queue Concurrency Limit

At any point in time, the number of concurrently executing tasks SHALL NOT exceed the configured concurrency limit.

**Validates: Requirements 4.9**

```
∀ t ∈ Time:
  |{task ∈ Queue : task.status == 'running' at time t}| ≤ concurrencyLimit
```

### Property 10: Self-Reflection Confidence Score Range

For all responses evaluated by the reflection module, the assigned confidence score SHALL be in the range [0.0, 1.0].

**Validates: Requirements 10.2**

```
∀ response ∈ EvaluatedResponses:
  0.0 ≤ response.confidenceScore ≤ 1.0
```

### Property 11: Agent Config File Round-Trip (Parse → Serialize → Parse)

For all valid agent config files, parsing to an AgentDefinition and serializing back to YAML/JSON SHALL produce a semantically equivalent config that parses to the same AgentDefinition.

**Validates: Requirements 8.1, 8.2**

```
∀ config ∈ ValidAgentConfigs:
  parse(serialize(parse(config))) ≡ parse(config)
```

### Property 12: Built-in Tool File Read/Write Round-Trip

For all valid file contents written by the `file-write` tool within the sandbox, reading the same path with `file-read` SHALL return the identical content.

**Validates: Requirements 9.2, 9.3**

```
∀ content ∈ ValidFileContents, ∀ path ∈ SandboxPaths:
  fileWrite(path, content) → fileRead(path) ≡ content
```

### Property 13: Trigger Rule Persistence Round-Trip

For all trigger rules registered with the engine, stopping and restarting SHALL preserve the rule definition.

**Validates: Requirements 11.4**

```
∀ rule ∈ RegisteredRules:
  stop() → start() → getRule(rule.id) ≡ rule
```

### Property 14: Backward Compatibility Aliases

For all renamed exports (KernovaKernel/NexusKernel, Kernova/Nexus, KernovaEvent/NexusEvent), the deprecated alias SHALL reference the exact same class/type as the new name.

**Validates: Requirements 1.2, 1.4, 1.7**

```
∀ (newName, oldAlias) ∈ RenamedExports:
  oldAlias === newName
```

## File Changes

### New Files
- `packages/core/src/daemon/index.ts` — DaemonRunner class
- `packages/core/src/built-in-tools/index.ts` — Built-in tools registry
- `packages/core/src/built-in-tools/http-fetch.ts`
- `packages/core/src/built-in-tools/file-read.ts`
- `packages/core/src/built-in-tools/file-write.ts`
- `packages/core/src/built-in-tools/shell-exec.ts`
- `packages/core/src/built-in-tools/date-time.ts`
- `packages/core/src/built-in-tools/web-search.ts`
- `packages/cli/src/commands/serve.ts`
- `packages/cli/src/commands/schedule.ts`
- `packages/cli/src/commands/queue.ts`
- `packages/cli/src/commands/triggers.ts`

### Modified Files
- `packages/core/src/kernel.ts` — Rename class to `KernovaKernel`, add deprecated `NexusKernel` alias
- `packages/core/src/index.ts` — Update exports, add new module exports
- `packages/core/src/scheduler/index.ts` — Add one-shot job support
- `packages/core/src/task-queue/index.ts` — Add concurrency configuration
- `packages/core/src/config-manager/index.ts` — Add YAML agent file parsing
- `packages/sdk/src/nexus.ts` → renamed to `packages/sdk/src/kernova.ts` — Rename class, add new methods
- `packages/sdk/src/index.ts` — Update exports
- `packages/types/src/base.ts` — Rename `NexusId` → `KernovaId`, `NexusObject` → `KernovaObject`
- `packages/types/src/event.ts` — Rename `NexusEvent` → `KernovaEvent`
- `packages/types/src/autonomy.ts` — Add `ChannelAdapter` interface, one-shot job types
- `packages/cli/src/bin.ts` — Register new commands
- `packages/cli/src/index.ts` — Export new command handlers

## Testing Strategy

- **Unit tests** (Vitest): Each module tested in isolation with mocks for EventBus and ModelRouter
- **Property-based tests** (fast-check): For scheduler cron parsing, queue ordering, sliding window, cooldown enforcement, config round-trip, file read/write round-trip
- **Integration tests**: Daemon startup/shutdown, full flow (schedule → fire → execute → complete)
- **Edge case tests**: Signal handling, max retries → dead-letter, invalid configs, sandbox violations

