---
title: "Background Loops"
description: Polling monitors that run at configurable intervals — health checks, inbox polling, data sync, and periodic automation.
---

Background loops are continuous polling monitors that execute a function at a fixed interval, inspect the result, and optionally submit an intent or trigger an agent when something actionable is detected. They form the backbone of any autonomous system that needs to watch external state — inboxes, APIs, databases, queues — without relying on webhooks or push notifications.

## How loops differ from scheduled jobs

| Concern | Background Loops | Scheduler |
|---------|-----------------|-----------|
| Timing | Fixed-interval polling (every _n_ ms) | Cron expressions or one-shot delays |
| State | Context threaded between ticks | Stateless per execution |
| Trigger condition | Non-null return from monitor function | Time-based (cron match) |
| Purpose | Continuous monitoring with memory | Timed, fire-and-forget actions |
| Examples | Health checks, inbox polling, price tracking | Daily reports, hourly cleanup |

Use background loops when you need to _repeatedly check_ something and react when conditions change. Use the scheduler when you need something to happen _at a specific time_.

## Common use cases

- **Health monitoring** — ping an endpoint every 30 seconds, alert on failure
- **Inbox polling** — check for new emails, tickets, or messages
- **Cache warming** — refresh hot data before it expires
- **Data sync** — pull changes from an external system periodically
- **Queue draining** — process items from a work queue in controlled batches

---

## Quick start

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });
await kernel.start();

// Poll for new emails every 5 minutes
kernel.loops.register({
  name: 'email-checker',
  intervalMs: 5 * 60 * 1000,
  monitor: async (previousResult) => {
    const emails = await emailClient.checkInbox();
    if (emails.length > 0) {
      return { newEmails: emails }; // Non-null = actionable
    }
    return null; // null = nothing to do
  },
  target: {
    type: 'intent',
    goal: 'Process new incoming emails',
  },
});
```

When `monitor` returns a non-null value, the loop submits the configured `target` (an intent in this case) with the result attached as context. When it returns `null`, nothing happens and the next tick is scheduled.

---

## API reference

All methods are available on `kernel.loops`.

### `register(input: BackgroundLoopInput): BackgroundLoopDef`

Registers a new background loop and immediately starts polling.

```typescript
const loop = kernel.loops.register({
  name: 'my-monitor',
  intervalMs: 10_000,
  monitor: async (prev) => { /* ... */ },
  target: { type: 'intent', goal: 'Handle result' },
});
// loop.id → auto-generated UUID (or your custom ID)
```

### `pause(loopId: string): void`

Stops polling for the specified loop. State is preserved and the paused status is persisted to SQLite.

```typescript
kernel.loops.pause('email-checker');
```

### `resume(loopId: string): void`

Resumes a paused loop. Context is reset to `null` and polling starts fresh.

```typescript
kernel.loops.resume('email-checker');
```

### `remove(loopId: string): void`

Permanently removes a loop. Clears the timer, deletes persisted metadata, and emits `loop.removed`.

```typescript
kernel.loops.remove('email-checker');
```

### `list(): BackgroundLoopDef[]`

Returns all registered loops with their current state.

```typescript
const loops = kernel.loops.list();
// [{ id, name, intervalMs, state: 'active' | 'paused' }, ...]
```

---

## BackgroundLoopInput

```typescript
interface BackgroundLoopInput {
  id?: string;              // Optional custom ID (auto-generated UUID if omitted)
  name: string;             // Human-readable name (required)
  intervalMs: number;       // Polling interval in milliseconds
  monitor: MonitorFunction; // The polling function called each tick
  target?: ScheduleTarget;  // What to execute when monitor returns non-null
}

type MonitorFunction = (previousResult: unknown) => Promise<unknown>;
```

**Constraints:**

- `intervalMs` must be between **1,000** (1 second) and **86,400,000** (24 hours)
- `name` is required and must be a non-empty string
- Duplicate `id` values throw a `ValidationError`
- `target` is optional — if omitted, the loop tracks state but never submits actions

---

## How it works

### setTimeout chaining (no drift)

Background loops use `setTimeout` chaining rather than `setInterval`. Each tick schedules the _next_ tick only after the current monitor function completes. This eliminates timer drift — if a monitor takes 2 seconds to execute on a 10-second interval, the next tick fires 10 seconds after completion, not 8 seconds later.

### Tick lifecycle

```
┌─────────────────────────────────────────────────────────┐
│  1. Call monitor(previousContext)                        │
│  2. Store result as new context                         │
│  3. If result !== null && result !== undefined:          │
│       → Submit target action with result as payload     │
│  4. Schedule next tick via setTimeout(intervalMs)       │
└─────────────────────────────────────────────────────────┘
```

### Error handling

If the monitor function throws, the loop does **not** crash. Instead:

1. The error is logged
2. A `loop.error` event is emitted with `{ loopId, name, error }`
3. Context is preserved from the previous successful tick
4. The next tick is scheduled normally

This makes loops resilient to transient failures like network timeouts or API rate limits.

---

## Context threading

The return value of each tick is passed as the argument to the next tick. This lets monitors maintain state across invocations without external storage.

### The actionability rule

The rule is simple but critical:

> **If `monitor` returns anything other than `null` or `undefined`, it is treated as actionable and the configured `target` is triggered.**

This means you cannot use the return value for _both_ state tracking and conditional triggering without additional structure.

### Problem: naive state tracking triggers every tick

```typescript
// ⚠️ FLAWED — triggers an action EVERY tick because it always returns non-null
kernel.loops.register({
  name: 'price-tracker',
  intervalMs: 60_000,
  monitor: async (previousPrice) => {
    const currentPrice = await fetchBTCPrice();
    if (previousPrice && Math.abs(currentPrice - previousPrice) / previousPrice > 0.05) {
      return currentPrice; // 5% change — actionable! ✓
    }
    return currentPrice; // Still non-null — triggers action every tick! ✗
  },
  target: { type: 'intent', goal: 'Alert on BTC price swing' },
});
```

The monitor always returns `currentPrice` (a number), so the target fires on _every single tick_ — not just when the 5% threshold is crossed.

### Solution: separate state from signal

Use a wrapper object to carry state, and return `null` when no action is needed:

```typescript
kernel.loops.register({
  name: 'price-tracker',
  intervalMs: 60_000,
  monitor: async (context: { lastPrice: number } | null) => {
    const currentPrice = await fetchBTCPrice();
    const lastPrice = context?.lastPrice;

    if (lastPrice && Math.abs(currentPrice - lastPrice) / lastPrice > 0.05) {
      // Actionable — 5% swing detected. Return triggers target.
      return { lastPrice: currentPrice };
    }

    // Not actionable — but we still need to thread state.
    // Return null to suppress action; state is lost.
    return null;
  },
  target: { type: 'intent', goal: 'Alert on BTC price swing' },
});
```

Wait — returning `null` means we lose context. The next tick receives `null` and can't compare prices.

### Best solution: use a closure for persistent state

```typescript
let lastKnownPrice: number | null = null;

kernel.loops.register({
  name: 'price-tracker',
  intervalMs: 60_000,
  monitor: async () => {
    const currentPrice = await fetchBTCPrice();
    const previousPrice = lastKnownPrice;
    lastKnownPrice = currentPrice; // Always update closure state

    if (previousPrice && Math.abs(currentPrice - previousPrice) / previousPrice > 0.05) {
      return { currentPrice, previousPrice, change: (currentPrice - previousPrice) / previousPrice };
    }

    return null; // No action — state is preserved in closure
  },
  target: { type: 'intent', goal: 'Alert on BTC price swing' },
});
```

This cleanly separates _state management_ (the closure) from _action signaling_ (the return value).

---

## Patterns

### Pattern 1: Health monitor

Triggers only on failure. Returns `null` when the service is healthy.

```typescript
kernel.loops.register({
  name: 'api-health',
  intervalMs: 30_000,
  monitor: async () => {
    try {
      const res = await fetch('https://api.example.com/health');
      if (res.status !== 200) {
        return { unhealthy: true, status: res.status };
      }
      return null; // Healthy — no action needed
    } catch (err) {
      return { unhealthy: true, error: err.message };
    }
  },
  target: { type: 'intent', goal: 'Investigate API health failure' },
});
```

### Pattern 2: Inbox poller with cursor

Uses context threading to track the last processed item. Triggers when new items are found.

```typescript
kernel.loops.register({
  name: 'ticket-poller',
  intervalMs: 60_000,
  monitor: async (lastTicketId) => {
    const tickets = await db.query(
      'SELECT * FROM tickets WHERE id > ? AND status = ?',
      [lastTicketId || 0, 'new']
    );
    if (tickets.length > 0) {
      return tickets[tickets.length - 1].id; // Store latest ID as context
    }
    return null; // No new tickets
  },
  target: { type: 'agent', id: 'ticket-handler', goal: 'Process new support tickets' },
});
```

Note: every time new tickets exist, the return value is non-null, so the target _is_ triggered. This is intentional — you want to process tickets as they arrive. The context threading (last ticket ID) ensures you never re-process old tickets.

### Pattern 3: Periodic data sync (always triggers)

When you want the action to fire on every tick unconditionally, always return a non-null value.

```typescript
kernel.loops.register({
  name: 'metrics-sync',
  intervalMs: 5 * 60 * 1000,
  monitor: async () => {
    const metrics = await gatherMetrics();
    return metrics; // Always non-null → always triggers
  },
  target: { type: 'intent', goal: 'Sync metrics to dashboard' },
});
```

### Pattern 4: Conditional with closure state

Combines external state tracking with selective triggering.

```typescript
let consecutiveFailures = 0;

kernel.loops.register({
  name: 'degradation-detector',
  intervalMs: 15_000,
  monitor: async () => {
    const latency = await measureApiLatency();

    if (latency > 2000) {
      consecutiveFailures++;
    } else {
      consecutiveFailures = 0;
    }

    // Only alert after 3 consecutive slow responses
    if (consecutiveFailures >= 3) {
      return { latency, consecutiveFailures };
    }
    return null;
  },
  target: { type: 'intent', goal: 'Investigate sustained API degradation' },
});
```

---

## Pause and resume

### `pause(loopId)`

- Clears the active timer (no more ticks fire)
- Preserves the loop definition and metadata
- Persists `state: 'paused'` to SQLite
- Emits `loop.paused` event

### `resume(loopId)`

- Resets context to `null` (fresh start)
- Schedules the first tick immediately
- Persists `state: 'active'` to SQLite
- Emits `loop.resumed` event

Use pause/resume instead of remove when the loop will be needed again. Removing a loop deletes all metadata — resuming simply picks up where the definition left off (with a fresh context).

```typescript
// Pause during maintenance window
kernel.loops.pause('api-health');

// Resume after maintenance
kernel.loops.resume('api-health');
```

---

## Lifecycle and persistence

### Startup (`kernel.start()`)

1. Opens the SQLite store
2. Loads persisted loop definitions (id, name, intervalMs, state)
3. Loops in `active` state wait for their monitor function to be re-registered
4. Loops in `paused` state remain paused

### Re-registration on restart

Monitor functions are JavaScript code — they cannot be serialized to SQLite. After a restart, you must call `register()` again for each loop. If a persisted loop with the same ID already exists, the registration _reattaches_ the monitor function and resumes polling.

```typescript
// On every application boot:
kernel.loops.register({
  id: 'email-checker',       // Same ID as before
  name: 'email-checker',
  intervalMs: 5 * 60 * 1000,
  monitor: emailMonitorFn,   // Re-attached
  target: { type: 'intent', goal: 'Process new incoming emails' },
});
```

### Shutdown (`kernel.stop()`)

1. Clears all active timers
2. Persists current loop states to SQLite
3. Closes the store connection

No data is lost during graceful shutdown.

---

## Events

Background loops emit events through the kernel's event system.

| Event | Emitted when | Payload |
|-------|-------------|---------|
| `loop.paused` | Loop is paused | `{ loopId, name }` |
| `loop.resumed` | Loop is resumed | `{ loopId, name }` |
| `loop.removed` | Loop is permanently deleted | `{ loopId, name }` |
| `loop.error` | Monitor function threw an error | `{ loopId, name, error }` |
| `loop.action.triggered` | Monitor returned an actionable result | `{ loopId, name, result, target }` |
| `loop.action.failed` | Target execution failed | `{ loopId, name, error, result }` |

### Listening to events

```typescript
kernel.events.subscribe('loop.error', ({ data }) => {
  logger.warn(`Loop "${data.name}" (${data.loopId}) encountered an error: ${data.error}`);
});

kernel.events.subscribe('loop.action.triggered', ({ data }) => {
  logger.info(`Loop "${data.name}" triggered action with result:`, data.result);
});
```

---

## Validation rules

| Rule | Constraint |
|------|-----------|
| `intervalMs` minimum | 1,000 ms (1 second) |
| `intervalMs` maximum | 86,400,000 ms (24 hours) |
| Duplicate IDs | Throws `ValidationError` |
| `name` required | Must be a non-empty string |
| `monitor` required | Must be a function |

Validation runs synchronously during `register()`. Invalid inputs throw immediately — no loop is created.

```typescript
// ✗ Throws ValidationError: intervalMs must be >= 1000
kernel.loops.register({ name: 'too-fast', intervalMs: 500, monitor: async () => null });

// ✗ Throws ValidationError: intervalMs must be <= 86400000
kernel.loops.register({ name: 'too-slow', intervalMs: 100_000_000, monitor: async () => null });
```

---

## Best practices

1. **Keep monitors fast.** Avoid CPU-heavy work or long-running I/O inside the monitor. If processing is expensive, return the data and let the target handle it.

2. **Return `null` for "nothing to do."** This prevents unnecessary intent submissions and keeps your system quiet when there's nothing actionable.

3. **Use closures for state that shouldn't trigger actions.** When you need to track values across ticks without firing the target every time, store state in a closure variable and only return non-null when you actually want to trigger.

4. **Handle errors inside the monitor when possible.** While the loop won't crash on unhandled errors, catching them yourself gives you finer control over retry logic and error reporting.

5. **Use pause/resume over remove.** If a loop will be needed again (maintenance windows, temporary disablement), pause it. Removing deletes all metadata.

6. **Use context threading for cursor-based polling.** When polling a database or API with pagination, return the last-seen ID or cursor — the next tick receives it automatically.

7. **Set intervals appropriate to the data source.** Don't poll an API every second if it only updates every minute. Respect rate limits and be a good citizen.

8. **Monitor the `loop.error` event.** Repeated errors from a loop may indicate a configuration issue or a downstream service that's permanently down.
