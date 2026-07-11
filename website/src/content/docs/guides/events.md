---
title: "Events & EventBus"
description: The event-driven nervous system of Kernova — pub/sub, wildcard patterns, persistent storage, querying, timelines, and retention policies.
---

Every state change in Kernova flows through the EventBus. When an intent is submitted, an agent completes a step, a memory is stored, or a tool executes — an event is published. This makes the entire runtime observable, auditable, and reactive.

The EventBus operates in dual mode:

- **In-memory pub/sub** — Real-time delivery to active subscribers with a hot cache
- **Persistent storage** — SQLite-backed history for querying, timelines, and replay

---

## Event Structure

Every event follows the `KernovaEvent` interface. Events are immutable once created.

```typescript
import type { KernovaEvent } from '@kernova/types';

const event: KernovaEvent = {
  id: 'evt_abc123',
  eventType: 'intent.completed',       // "domain.action" format
  category: 'intent',
  severity: 'info',
  timestamp: '2025-01-15T10:30:00.000Z',
  subjectId: 'int_xyz789',             // What this event is about
  subjectType: 'intent',
  actorId: 'agt_worker01',             // Who caused it
  correlationId: 'cor_request456',     // Groups related events
  causationId: 'evt_previous999',      // Which event triggered this one
  data: {
    goal: 'Summarize the quarterly report',
    result: 'The Q3 report shows a 12% increase...',
    durationMs: 3400,
  },
  metadata: {
    schemaVersion: '1.0',
    source: 'kernel',
    environment: 'production',
  },
};
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `KernovaId` | Unique event identifier |
| `eventType` | `string` | Type in `domain.action` format |
| `category` | `EventCategory` | One of the 10 categories |
| `severity` | `EventSeverity` | `debug`, `info`, `warn`, `error`, `critical` |
| `timestamp` | `Timestamp` | ISO 8601 when the event occurred |
| `subjectId` | `KernovaId` | The object this event is about |
| `actorId` | `KernovaId` | Who or what caused this event |
| `correlationId` | `KernovaId` | Groups events across a request flow |
| `causationId` | `KernovaId?` | The event that directly caused this one |
| `data` | `Record<string, unknown>` | Event payload (domain-specific) |
| `metadata` | `EventMetadata` | Schema version, source, environment, trace context |

---

## Publishing Events

The kernel publishes events automatically for all internal state changes. You can also publish custom events through the bus.

```typescript
import { KernovaKernel, generateId, now } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });
await kernel.start();

// Access the EventBus
const bus = kernel.events;

// Publish a custom event
bus.publish({
  id: generateId('evt'),
  eventType: 'workflow.step_completed',
  category: 'workflow',
  severity: 'info',
  timestamp: now(),
  subjectId: 'wf_pipeline01',
  subjectType: 'workflow',
  actorId: 'agt_orchestrator',
  correlationId: 'cor_request789',
  data: { stepName: 'data-validation', durationMs: 120, passed: true },
  metadata: { schemaVersion: '1.0', source: 'custom-workflow', environment: 'development' },
});
```

Events are delivered synchronously to subscribers and buffered for async persistence to SQLite. The `publish()` call never blocks on disk writes.

---

## Subscribing with Wildcard Patterns

Patterns use dot-separated segments with wildcard support:

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `intent.*` | `intent.created`, `intent.completed` | `agent.created` |
| `*.created` | `intent.created`, `agent.created` | `intent.completed` |
| `*` | Everything | — |
| `workflow.*` | `workflow.started`, `workflow.failed` | `workflow.step.completed` |

Wildcards match exactly one segment — `intent.*` won't match `intent.step.done`.

```typescript
// Subscribe to all intent events
const subId = bus.subscribe(['intent.*'], (event) => {
  console.log(`Intent ${event.subjectId}: ${event.eventType}`);
});

// Multiple patterns in one subscription
bus.subscribe(['agent.created', 'agent.destroyed'], (event) => {
  console.log(`Agent lifecycle: ${event.eventType}`);
});

// Catch-all
bus.subscribe(['*'], (event) => {
  console.log(`[${event.category}] ${event.eventType}`);
});

// Async handlers are supported — errors are caught and logged
bus.subscribe(['memory.*'], async (event) => {
  await externalService.notify(event);
});

// Unsubscribe when done
bus.unsubscribe(subId);
```

---

## Event Persistence

When persistence is enabled (the default), all events are stored in SQLite with batched writes.

**How it works:**

1. Event lands in the hot cache and write buffer
2. Buffer accumulates events (default batch size: 100)
3. When the buffer fills or the flush timer fires (every 1s), events write in a single transaction
4. Queries flush pending events first so results always reflect the latest state

**Storage configuration:**

- WAL mode for concurrent read/write performance
- Indexes on `subject_id`, `event_type`, `correlation_id`, `timestamp`, `category`
- JSON columns for flexible `data` and `metadata` payloads

```typescript
// Persistent (default)
const kernel = new KernovaKernel({
  environment: 'production',
  dataDir: '/var/lib/kernova/data',
});

// Ephemeral — in-memory only, no SQLite
const testKernel = new KernovaKernel({
  environment: 'development',
  ephemeral: true,
});
```

---

## Querying Events

The persistent store supports rich filtering:

```typescript
// All intent events in the last hour
const recent = bus.query({
  category: 'intent',
  after: new Date(Date.now() - 3600000).toISOString(),
  order: 'desc',
  limit: 50,
});

// Errors from a specific agent
const errors = bus.query({
  actorId: 'agt_worker01',
  severity: 'error',
});

// Wildcard type query
const creations = bus.query({ type: '*.created', order: 'asc' });

// Pagination
const page2 = bus.query({ category: 'tool', limit: 25, offset: 25 });

// Count without fetching
const errorCount = bus.count({ severity: 'error', category: 'system' });

// Store statistics
const stats = bus.getStats();
// { totalEvents, byCategory, oldestEvent, newestEvent, databaseSizeBytes }
```

**Query parameters:** `type`, `category`, `severity`, `subjectId`, `actorId`, `correlationId`, `after`, `before`, `limit`, `offset`, `order`.

---

## Timelines & Correlation Tracing

### Timelines

Every object has a timeline — the ordered sequence of all events about it:

```typescript
// Full history of an intent
const timeline = bus.getTimeline('int_abc123');
// → [intent.created, intent.routed, intent.processing, intent.completed]

// Limited to recent history
const recent = bus.getTimeline('agt_worker01', 20);
```

### Correlation Tracing

A correlation ID groups events across agents, tools, and workflows for a single logical operation:

```typescript
// Trace everything in a single request flow
const trace = bus.getCorrelated('cor_request456');
// → [intent.created, agent.invoked, tool.called, tool.returned,
//    memory.stored, agent.responded, intent.completed]
```

---

## Retention Policies

Prune old events to manage storage growth:

```typescript
// Delete events older than 30 days, returns count of deleted events
const deleted = bus.applyRetention(30);

// Automated daily retention
setInterval(() => {
  const pruned = kernel.events.applyRetention(90);
  if (pruned > 0) {
    console.log(`Retention: pruned ${pruned} events older than 90 days`);
  }
}, 86400000);

// Force-flush before shutdown (kernel.stop() does this automatically)
bus.flush();
```

---

## Event Categories

| Category | Description | Example Types |
|----------|-------------|---------------|
| `intent` | Intent lifecycle | `intent.created`, `intent.completed`, `intent.failed` |
| `agent` | Agent lifecycle | `agent.registered`, `agent.invoked`, `agent.destroyed` |
| `workflow` | Workflow execution | `workflow.started`, `workflow.step_completed`, `workflow.failed` |
| `memory` | Memory operations | `memory.stored`, `memory.retrieved`, `memory.expired` |
| `identity` | Auth and access | `identity.authenticated`, `identity.token_refreshed` |
| `system` | Platform events | `system.started`, `system.stopped`, `system.retention_applied` |
| `tool` | Tool invocations | `tool.called`, `tool.returned`, `tool.failed` |
| `model` | Model interactions | `model.prompted`, `model.responded`, `model.fallback` |
| `governance` | Policy and budget | `governance.budget_exceeded`, `governance.policy_denied` |
| `test` | Development events | `test.started`, `test.passed`, `test.failed` |

---

## Common Patterns

### Audit Logging

```typescript
bus.subscribe(['governance.*', 'identity.*'], async (event) => {
  await auditLog.write({
    timestamp: event.timestamp,
    action: event.eventType,
    actor: event.actorId,
    subject: event.subjectId,
    details: event.data,
  });
});
```

### Real-Time Monitoring

```typescript
bus.subscribe(['*'], (event) => {
  if (event.severity === 'error' || event.severity === 'critical') {
    alerting.notify({
      channel: 'ops',
      message: `[${event.severity.toUpperCase()}] ${event.eventType}`,
      data: event.data,
    });
  }
});
```

### Building Triggers

```typescript
// Auto-retry failed intents
bus.subscribe(['intent.failed'], async (event) => {
  const retryCount = (event.data.retryCount as number) || 0;
  if (retryCount < 3) {
    await kernel.submit({
      goal: event.data.goal as string,
      metadata: { retryCount: retryCount + 1 },
    });
  }
});

// Chain events into workflows
bus.subscribe(['memory.stored'], async (event) => {
  if (event.data.layer === 'organizational') {
    await kernel.submit({
      goal: `Index document ${event.subjectId} for RAG retrieval`,
      priority: 'background',
    });
  }
});
```

---

## Best Practices

**Event naming** — Use `category.action` format consistently. `intent.created` and `tool.failed` are clear; `newIntent` and `WORKFLOW_DONE` are not.

**Self-contained payloads** — Include enough data to understand the event without joining against other sources:

```typescript
// Good — self-contained
data: { goal: 'Summarize report', agentId: 'agt_writer', durationMs: 2400 }

// Avoid — requires extra lookups
data: { intentId: 'int_123' }
```

**Propagate correlation IDs** — Always pass the correlation ID through multi-step operations so you can trace the full chain with `getCorrelated()`.

**Protect handlers** — Add timeouts and error handling for subscribers calling external services. The bus catches errors, but slow handlers can accumulate.

**Retention strategy:**
- Development: 7–14 days (or ephemeral mode)
- Staging: 30 days
- Production: 90+ days, consider keeping governance events longer

**Performance tips:**
- Increase `maxHistorySize` for high-throughput workloads needing fast in-memory access
- Use specific `query()` filters rather than fetching all events and filtering client-side
- The default batch buffer (100 events, 1s flush) works for most workloads — tune if you're publishing thousands of events per second
- Call `bus.flush()` before shutdown to avoid losing buffered events (the kernel does this automatically on `stop()`)
