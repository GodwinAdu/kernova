---
title: "Scheduler, Task Queue & Triggers"
description: Time-based jobs, priority task processing with retries, and event-driven rules — the three autonomy primitives that power always-on agents.
---

Autonomous agents need to act without being asked. They need to wake up on a schedule, process work reliably under load, and react to events the moment they happen. Kernova provides three primitives for this — each solving a distinct temporal problem:

- **Scheduler** — "Do X at time Y" (cron jobs, delayed one-shots)
- **Task Queue** — "Do X when capacity is available" (prioritized, retried, concurrent)
- **Proactive Triggers** — "Do X when event Y happens" (pattern-matched, cooldown-enforced)

Together, these modules give agents full temporal autonomy: they can schedule future work, process it reliably, and chain reactions to outcomes — all without human intervention.

---

## When to Use Each

| Primitive | Use When | Example |
|-----------|----------|---------|
| **Scheduler** | Work must happen at specific times | Daily reports, hourly syncs, delayed notifications |
| **Task Queue** | Work must be processed reliably under load | Email sending, data processing, API calls with retries |
| **Triggers** | Work must happen in response to events | React to failures, chain workflows, alert on conditions |

They compose naturally: a scheduled job enqueues tasks into the queue, and triggers react when those tasks complete or fail.

---

## Scheduler

The `Scheduler` manages time-based job execution using `setTimeout` chaining for precise scheduling. It supports recurring cron jobs and one-shot delayed executions, with SQLite persistence and missed-execution detection on restart.

### Cron Jobs (Recurring)

Standard 5-field cron expressions (`minute hour day-of-month month day-of-week`):

```typescript
kernel.scheduler.register({
  name: 'hourly-sync',
  cronExpression: '0 * * * *',
  target: { type: 'intent', goal: 'Sync external data sources' },
});

kernel.scheduler.register({
  name: 'morning-report',
  cronExpression: '0 9 * * 1-5', // Weekdays at 9am
  target: { type: 'intent', goal: 'Generate daily standup report' },
});
```

### One-Shot Delayed Jobs

For work that should happen once after a delay (auto-disabled after execution):

```typescript
kernel.scheduler.register({
  name: 'follow-up-reminder',
  delayMs: 30 * 60 * 1000,
  oneShot: true,
  target: { type: 'intent', goal: 'Send follow-up email to user' },
});
```

One-shot jobs don't retry — if you need retries, enqueue a task instead.

### register(), remove(), list(), get()

```typescript
// Register a job (returns ScheduledJob)
const job = kernel.scheduler.register({
  name: 'my-job',              // unique, non-empty, ≤128 chars
  cronExpression: '0 * * * *', // required for recurring
  target: { type: 'intent', goal: 'Do something', metadata: {} },
});

// Remove by ID
kernel.scheduler.remove(job.id);

// List all jobs
const jobs = kernel.scheduler.list();

// Get specific job
const found = kernel.scheduler.get(job.id);
```

### Persistence & Missed Execution Detection

All jobs persist to SQLite (`{dataDir}/kernova.db`). On restart the scheduler loads all jobs, detects missed executions by comparing `lastExecutionAt` against the cron expression, emits `scheduler.job.missed` for each skipped tick, and schedules timers for all enabled jobs.

```typescript
kernel.events.subscribe('scheduler.job.missed', (event) => {
  console.warn(`Job "${event.data.jobName}" missed at ${event.data.missedAt}`);
});
```

### Overlap & Timeout

- **Overlap detection** — If a cron job is still running when its next tick arrives, the execution is skipped and `scheduler.job.skipped` is emitted.
- **Execution timeout** — Jobs are enforced with a max timeout (default: 300s). An `AbortSignal` is passed to the handler; when the timeout fires, the signal aborts and the job fails.

### Events

| Event | Data |
|-------|------|
| `scheduler.job.completed` | `jobName`, `executionStart`, `executionEnd`, `oneShot` |
| `scheduler.job.failed` | `jobName`, `error`, `timeout`, `oneShot` |
| `scheduler.job.missed` | `jobName`, `missedAt`, `lastExecutionAt` |
| `scheduler.job.skipped` | `jobName`, `reason: 'overlap'` |

---

## Task Queue

The `TaskQueue` provides prioritized async task execution with concurrency control, exponential backoff retries, and a dead-letter queue for exhausted tasks.

### Priority Levels

Tasks are dequeued in strict priority order (FIFO within the same level):

| Priority | Use For |
|----------|---------|
| `critical` | System-critical operations, incident response |
| `high` | User-facing tasks, time-sensitive work |
| `medium` | Default — standard background processing |
| `low` | Housekeeping, analytics, non-urgent work |

```typescript
kernel.taskQueue.enqueue({
  handler: 'send-alert',
  payload: { channel: 'pagerduty', incident: 'db-down' },
  priority: 'critical',
});

kernel.taskQueue.enqueue({
  handler: 'cleanup-logs',
  payload: { olderThanDays: 30 },
  priority: 'low',
});
```

### Concurrency Control

A semaphore limits parallel execution between 1 and 50 tasks (default: 5). This prevents resource exhaustion regardless of how many tasks are enqueued.

### Registering Handlers

```typescript
kernel.taskQueue.registerHandler('send-email', async (payload, signal) => {
  const { to, subject, body } = payload as { to: string; subject: string; body: string };
  if (signal.aborted) return;
  await sendEmail({ to, subject, body });
});
```

The `signal` is an `AbortSignal` — it fires on task timeout or graceful shutdown. Long-running handlers should check `signal.aborted` periodically.

### Retry with Exponential Backoff

Failed tasks retry with: `delay = min(baseDelay × 2^(attempt-1), maxDelay)`

Defaults (`baseDelay: 1000ms`, `maxDelay: 30000ms`): 1st → 1s, 2nd → 2s, 3rd → 4s, 4th → 8s, 5th+ → 30s (capped). After exhausting `maxRetries` (default: 3), the task moves to the dead-letter queue.

### Dead-Letter Queue & Replay

```typescript
// Query dead-lettered tasks
const deadLetters = kernel.taskQueue.deadLetters();
for (const item of deadLetters) {
  console.log(`${item.handler} failed: ${item.attempts.at(-1)?.errorMessage}`);
}

// Filter by handler
const emailFailures = kernel.taskQueue.deadLetters({ handler: 'send-email' });

// Replay back into the queue (fresh retry count, original priority)
const replayed = kernel.taskQueue.replay(deadLetterId);
```

### registerHandler(), enqueue(), stats(), deadLetters(), replay()

```typescript
kernel.taskQueue.registerHandler(name, handler);

const task = kernel.taskQueue.enqueue({
  handler: 'send-email',
  payload: { to: 'a@b.com' },
  priority: 'high',   // default: 'medium'
  maxRetries: 5,      // default: 3
});

const stats = kernel.taskQueue.stats();   // { pending, running, completed, failed, total }
const dead = kernel.taskQueue.deadLetters(filter?);
const replayed = kernel.taskQueue.replay(deadLetterId);
```

### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | `5` (1–50) | Max parallel task executions |
| `maxRetries` | `3` | Default retry count per task |
| `baseDelay` | `1000ms` | Base delay for backoff |
| `maxDelay` | `30000ms` | Maximum backoff cap |
| `taskTimeout` | `30000ms` | Per-task execution timeout |
| `maxQueueDepth` | `1000` | Max pending tasks before rejection |
| `shutdownTimeout` | `10000ms` | Wait for in-flight tasks on stop |

### Graceful Shutdown

When `stop()` is called: stops accepting tasks → stops polling → waits up to `shutdownTimeout` for in-flight tasks → force-cancels remaining via AbortController → closes the store.

### Events

| Event | Data |
|-------|------|
| `queue.task.enqueued` | `taskId`, `priority`, `handler` |
| `queue.task.completed` | `taskId`, `handler` |
| `queue.task.dead-lettered` | `taskId`, `handler`, `errorMessage`, `errorType`, `attempts` |

---

## Proactive Triggers

The `ProactiveTriggerEngine` is an event-driven rule engine that monitors the EventBus for matching patterns and fires actions when conditions are met. Triggers are purely reactive — they respond to events the moment they occur.

### Event Pattern Matching

Patterns use dot-separated segments with glob-style `*` wildcards:

```typescript
kernel.triggers.register({
  name: 'log-intents',
  eventPattern: 'intent.*',
  action: { goal: 'Log intent lifecycle event' },
});

kernel.triggers.register({
  name: 'on-task-failure',
  eventPattern: 'queue.task.dead-lettered',
  action: { goal: 'Investigate dead-lettered task and alert team' },
});
```

Pattern rules:
- Each segment is alphanumeric or `*` (matches one segment)
- Separated by dots: `intent.*` matches `intent.created` but not `intent.created.sub`
- Maximum length: 256 characters

### Cooldown Enforcement

Minimum 100ms, default 1000ms. Events matching within the cooldown window after a fire are silently dropped:

```typescript
kernel.triggers.register({
  name: 'rate-limited-alert',
  eventPattern: 'intent.failed',
  action: { goal: 'Alert on failure', priority: 'high' },
  cooldownMs: 5000, // At most once per 5 seconds
});
```

### Condition Functions

Attach a runtime condition for fine-grained filtering. The trigger only fires when the condition returns `true`:

```typescript
kernel.triggers.register({
  name: 'critical-failures-only',
  eventPattern: 'intent.failed',
  action: { goal: 'Escalate critical failure to on-call' },
  cooldownMs: 10000,
  condition: (event) => event.data?.priority === 'critical',
  conditionDescription: 'Only fire for critical-priority intents',
});
```

Conditions are runtime-only (not persisted). The `conditionDescription` string is stored for observability.

### register(), remove(), enable(), disable(), list()

```typescript
const rule = kernel.triggers.register({
  name: 'my-trigger',
  eventPattern: 'intent.*',
  action: { goal: 'Handle the event', priority: 'high' },
  cooldownMs: 2000,                   // ≥100ms, default: 1000ms
  condition: (event) => true,          // Optional runtime filter
  conditionDescription: 'Always fires', // Persisted for observability
  enabled: true,                       // Default: true
});

kernel.triggers.remove(rule.id);    // Permanent delete
kernel.triggers.enable(rule.id);    // Re-subscribe to EventBus
kernel.triggers.disable(rule.id);   // Unsubscribe, keep rule
const rules = kernel.triggers.list();
```

### Persistence & Restore

Rules persist to SQLite. On restart: loads all rules, restores `lastFiredAt` for cooldown continuity, re-subscribes enabled rules. Condition functions are **not** persisted — re-register them in application setup.

### Duplicate Detection

A unique index on `(eventPattern, conditionDescription)` for enabled rules prevents duplicates.

### Events

| Event | Data |
|-------|------|
| `trigger.fired` | `ruleId`, `triggeringEventId`, `action` |
| `trigger.action.failed` | `ruleId`, `triggeringEventId`, `error` |
| `trigger.condition.error` | `ruleId`, `eventId`, `error` |
| `trigger.removed` | `ruleId`, `name` |

---

## SDK Integration

The `@kernova/sdk` provides ergonomic shortcuts for all three primitives:

### SDK: app.schedule()

```typescript
import { Kernova } from '@kernova/sdk';
const app = await Kernova.create();

// String → cron expression (recurring)
app.schedule('hourly-report', '0 * * * *', async () => {
  await sendToSlack(await generateReport());
});

// Number → delayMs (one-shot)
app.schedule('delayed-init', 5000, async () => {
  await initializeExternalConnections();
});
```

### SDK: app.enqueue()

```typescript
const taskId = await app.enqueue('send-email', { to: 'user@example.com', subject: 'Welcome' });

const urgentId = await app.enqueue('process-payment', paymentData, {
  priority: 'critical',
  maxRetries: 5,
});
```

### SDK: app.trigger()

```typescript
app.trigger('on-message', 'channel.message.*', {
  goal: 'Process incoming message',
});

app.trigger('on-failure', 'intent.failed', {
  goal: 'Investigate and recover from failure',
  priority: 'high',
  cooldownMs: 5000,
});
```

---

## How They Work Together

The canonical composition pattern:

```
Schedule fires → Enqueues task → Task completes → Trigger reacts
```

### Example: Autonomous Daily Digest

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create({ env: 'production', dataDir: './data' });
const kernel = app.getKernel();

// 1. SCHEDULE: Fire daily at 8am
app.schedule('daily-digest', '0 8 * * *', async () => {
  const users = await getActiveUsers();
  for (const user of users) {
    await app.enqueue('generate-digest', { userId: user.id }, { priority: 'medium' });
  }
});

// 2. HANDLER: Process each digest task
kernel.taskQueue.registerHandler('generate-digest', async (payload, signal) => {
  const { userId } = payload as { userId: string };
  if (signal.aborted) return;
  const digest = await compileDigestForUser(userId);
  await sendDigestEmail(userId, digest);
});

// 3. TRIGGER: React to failures
app.trigger('digest-failure', 'queue.task.dead-lettered', {
  goal: 'Alert ops team about failed digest generation',
  priority: 'high',
  cooldownMs: 60000,
});

await app.serve();
```

### Example: Self-Healing Agent

```typescript
// React to failures and missed jobs
app.trigger('self-heal', 'intent.failed', {
  goal: 'Analyze failure and attempt recovery',
  priority: 'high',
  cooldownMs: 10000,
});

app.trigger('catch-up', 'scheduler.job.missed', {
  goal: 'Enqueue catch-up tasks for missed work',
  cooldownMs: 5000,
});

// Periodic health check that enqueues remediation
app.schedule('health-audit', '*/10 * * * *', async () => {
  const health = await checkSystemHealth();
  if (!health.ok) {
    await app.enqueue('remediate', { issues: health.issues }, { priority: 'critical' });
  }
});
```

---

## Best Practices

**Scheduler:**
- Use cron for recurring work, one-shot for deferred single actions
- Monitor `scheduler.job.missed` — indicates downtime during expected executions
- Don't put heavy logic in the scheduler callback — enqueue a task for reliability

**Task Queue:**
- Register handlers before enqueueing — tasks without handlers fail immediately
- Check `signal.aborted` in long-running handlers for clean cancellation
- Set `maxRetries` per task type — idempotent tasks retry more; non-idempotent less
- Monitor dead letters — they represent permanent failures needing investigation

**Proactive Triggers:**
- Set cooldowns appropriate to the action — alerts need longer cooldowns than logging
- Avoid trigger cascades — design patterns so trigger A's events don't re-fire trigger A
- Re-register condition functions on restart — they're closures, not persisted
- Prefer `disable()` over `remove()` — disabled rules can be re-enabled

### Anti-Patterns

- ❌ Using the scheduler as a retry mechanism (use the queue's built-in retries)
- ❌ Setting cooldown below 100ms (validation rejects it)
- ❌ Enqueueing tasks with no registered handler (immediate failure, no retry)
- ❌ Ignoring dead-letter items (permanent failures need attention)
- ❌ Creating triggers that react to their own action's events (cascade loops)
- ❌ Very short cron intervals with long-running jobs (overlap detection helps but redesign instead)

---

## Next Steps

- [Daemon Mode](/guides/daemon) — Run these primitives as a persistent background service
- [Context & Memory](/guides/context-memory) — How agents receive context for triggered work
- [Building Agents](/guides/agents) — Define agents that scheduled jobs and triggers invoke
- [Channels & Adapters](/guides/channels) — Connect triggers to external message sources
