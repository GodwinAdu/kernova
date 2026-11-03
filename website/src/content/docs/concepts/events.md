---
title: Events
description: Understand the event-native architecture — how everything is tracked.
---

# Events

Kernova is **event-native**. This doesn't mean "we have an event system." It means **every single action in the runtime emits a structured event** that is persisted, queryable, and streamable.

## Why This Matters

Without events, when something goes wrong with an AI system, you're debugging blind:
- "Why did the agent say that?"
- "When did the memory change?"
- "Which tool was called?"
- "How long did it take?"

With Kernova events, you have a complete timeline of everything that happened.

## What Gets Tracked

Every state change in the runtime emits an event:

| Category | Events |
|----------|--------|
| **Intents** | created, planning, executing, completed, failed, cancelled |
| **Agents** | registered, executing, completed, delegation.started/completed/failed |
| **Tools** | executed, failed |
| **Memory** | stored |
| **Identity** | registered, permission.denied, role.assigned |
| **Workflows** | defined, started, completed, failed, step.started/completed/failed, approval.requested |
| **Models** | completed, fallback |
| **Governance** | budget.exceeded |
| **System** | kernel.started, kernel.stopping |

## Event Structure

Every event has the same shape:

```typescript
{
  id: "evt_abc123",                    // Unique ID
  eventType: "intent.completed",       // What happened
  category: "intent",                  // Which system
  severity: "info",                    // debug, info, warn, error, critical
  timestamp: "2026-07-08T20:15:36Z",  // When
  subjectId: "intent_xyz",            // What this is about
  actorId: "kernel_123",              // Who caused it
  correlationId: "intent_xyz",        // Trace related events together
  data: { ... },                       // Event-specific payload
}
```

## Subscribing to Events (Real-Time)

```typescript
// Listen to all intent events
kernel.events.subscribe(['intent.*'], (event) => {
  console.log(`[${event.timestamp}] ${event.eventType}:`, event.data);
});

// Listen to everything
kernel.events.subscribe(['*'], (event) => { ... });

// Listen to specific patterns
kernel.events.subscribe(['agent.tool_call'], (event) => {
  console.log(`Tool called: ${event.data.toolName}`);
});
```

**Pattern matching:**
- `intent.*` — matches `intent.created`, `intent.completed`, etc.
- `*.failed` — matches `intent.failed`, `agent.delegation.failed`, etc.
- `*` — matches everything

## Querying Events (Historical)

Events persist to SQLite. Query them anytime:

```typescript
// Recent events
const recent = kernel.events.query({ 
  type: 'intent.*', 
  limit: 50, 
  order: 'desc' 
});

// Events for a specific intent
const timeline = kernel.events.getTimeline(intentId);
// Returns: [intent.created, intent.planning, intent.executing, intent.completed]

// Trace a full request flow (all related events)
const flow = kernel.events.getCorrelated(correlationId);

// Filter by time
const todayEvents = kernel.events.query({
  after: '2026-07-08T00:00:00Z',
  category: 'agent',
});
```

## Real-Time Streaming (Studio)

The development dashboard that `kernova dev` starts at http://localhost:4200 (core projects; `DevServer`) streams events live via Server-Sent Events:

```
GET /api/events/stream

→ data: {"eventType":"intent.created","data":{"goal":"..."}}
→ data: {"eventType":"intent.executing","data":{"agentId":"..."}}
→ data: {"eventType":"agent.tool_call","data":{"toolName":"search"}}
→ data: {"eventType":"intent.completed","data":{"status":"completed"}}
```

Open Studio while developing and you can watch your agents work in real time.

## Persistence

Events are stored in SQLite (`Kernova-data/Kernova.db`). They survive process restarts.

**Retention:** Events accumulate over time. Use retention policies to manage disk usage:

```typescript
// Delete events older than 30 days
kernel.events.applyRetention(30);
```

Run this on a cron schedule in production.

## Statistics

```typescript
const stats = kernel.events.getStats();
// {
//   totalEvents: 15234,
//   byCategory: { intent: 8000, agent: 4000, tool: 2000, ... },
//   oldestEvent: "2026-07-01T...",
//   newestEvent: "2026-07-08T...",
//   databaseSizeBytes: 2048000,
// }
```

## Use Cases

1. **Debugging** — "Why did the agent call that tool?" → Check the timeline
2. **Auditing** — "Who accessed this data?" → Query by actor and resource
3. **Monitoring** — Subscribe to `*.failed` events and alert
4. **Analytics** — Count events by type to understand usage patterns
5. **Replay** — Re-examine historical decisions with full context
6. **Compliance** — Prove what the AI did and why (evidence trail)

## Custom Events

Agents can emit their own events:

```typescript
tools.emit('report.generated', { 
  reportType: 'quarterly', 
  pages: 15, 
  format: 'pdf' 
});
```

These appear in the timeline alongside system events, giving you full visibility into your application's behavior.
