# Autonomy Modules

Kernova ships with a complete autonomy layer that enables agents to operate independently — scheduling tasks, monitoring conditions, processing queues, reacting to events, and communicating through external channels.

## Overview

| Module | Purpose | Key Pattern |
|--------|---------|-------------|
| **Scheduler** | Run tasks on cron schedules | `kernel.scheduler.register(...)` |
| **BackgroundLoop** | Continuous monitoring | `kernel.loops.register(...)` |
| **TaskQueue** | Async execution with priorities | `kernel.taskQueue.enqueue(...)` |
| **ProactiveTriggerEngine** | Event-driven rules | `kernel.triggers.register(...)` |
| **ConnectorRegistry** | Channel messaging | `kernel.channels.register(...)` |

All modules follow the same lifecycle pattern: `constructor(eventBus, config)` → `start()` → `stop()`.

---

## Scheduler

Cron-based task scheduling with overlap detection and missed execution recovery.

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
const kernel = app.getKernel();

// Register a job that runs every hour
kernel.scheduler.register({
  name: 'hourly-digest',
  cronExpression: '0 * * * *',
  target: {
    type: 'intent',
    goal: 'Generate an hourly summary of system events',
  },
});

// List registered jobs
const jobs = kernel.scheduler.list();

// Remove a job
kernel.scheduler.remove(jobs[0].id);
```

### Features
- 5-field cron expressions
- setTimeout chaining (no drift)
- Overlap detection: skips if previous run is still active
- Timeout enforcement with AbortController
- Missed execution detection on startup
- EventBus integration (`scheduler.job.completed`, `scheduler.job.failed`, `scheduler.job.missed`)

---

## Background Loop

Continuous monitoring with configurable polling intervals.

```typescript
// Monitor external API health every 30 seconds
kernel.loops.register({
  name: 'health-check',
  intervalMs: 30_000,
  monitor: async (previousResult) => {
    const response = await fetch('https://api.example.com/health');
    const healthy = response.ok;

    // Return non-null to trigger action
    if (!healthy) return { status: 'down', since: Date.now() };
    return null; // No action needed
  },
  target: {
    type: 'intent',
    goal: 'External API is down, investigate and notify team',
  },
});

// Pause/resume
kernel.loops.pause(loopId);
kernel.loops.resume(loopId);
```

### Features
- Configurable interval (1s to 24h)
- Context threading: previous monitor result is passed to next invocation
- Pause/resume lifecycle
- Error isolation: monitor errors don't crash the loop
- EventBus integration (`loop.action.triggered`, `loop.error`)

---

## Task Queue

Priority-based async task execution with retries and dead-letter queue.

```typescript
// Register a handler
kernel.taskQueue.registerHandler('send-email', async (payload, signal) => {
  const { to, subject, body } = payload as any;
  await sendEmail(to, subject, body);
});

// Enqueue tasks with priority
kernel.taskQueue.enqueue({
  handler: 'send-email',
  payload: { to: 'user@example.com', subject: 'Hello', body: 'World' },
  priority: 'high',
});

// Check stats
const stats = kernel.taskQueue.stats();
// { pending: 5, active: 2, completed: 100, failed: 3, deadLettered: 1 }

// Replay dead-lettered items
const deadLetters = kernel.taskQueue.deadLetters();
kernel.taskQueue.replay(deadLetters[0].id);
```

### Features
- Semaphore-based concurrency (1–50 concurrent tasks)
- 4 priority levels: `critical`, `high`, `medium`, `low`
- Exponential backoff retry: `min(baseDelay × 2^(attempt-1), maxDelay)`
- Task timeout via AbortController
- Dead-letter queue for exhausted tasks
- Graceful shutdown: waits for in-flight tasks
- EventBus integration (`queue.task.enqueued`, `queue.task.completed`, `queue.task.dead-lettered`)

---

## Proactive Trigger Engine

Event-driven rules that fire actions when patterns match.

```typescript
// Trigger on high-severity events
kernel.triggers.register({
  name: 'alert-on-failure',
  eventPattern: 'intent.failed',
  condition: (event) => event.severity === 'error',
  conditionDescription: 'Only error-severity failures',
  action: {
    goal: 'An intent failed with error severity. Investigate and alert the team.',
    priority: 'high',
  },
  cooldownMs: 60_000, // Don't fire more than once per minute
});

// Enable/disable rules
kernel.triggers.disable(ruleId);
kernel.triggers.enable(ruleId);

// List rules
const rules = kernel.triggers.list();
```

### Features
- Wildcard event pattern matching (`intent.*`, `scheduler.job.*`)
- Runtime condition functions (not serialized)
- Per-rule cooldown to prevent event storms
- Individual enable/disable without removing
- EventBus integration (`trigger.fired`, `trigger.action.failed`)

---

## Connector Registry (Channels)

Pluggable messaging integrations for Slack, Discord, Telegram, WhatsApp, and Email.

```typescript
// Register a Slack connector
const connector = kernel.channels.register({
  channelType: 'slack',
  name: 'My Workspace',
  config: {
    type: 'slack',
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },
});

// Connect
await kernel.channels.connect(connector.id);

// Send messages
await kernel.channels.send({
  connectorId: connector.id,
  message: { content: 'Hello from Kernova!' },
});

// Check status
const statuses = kernel.channels.status();
```

### Supported Channels
- **Slack**: Bot token + signing secret
- **Discord**: Bot token + application ID
- **Telegram**: Bot token + optional webhook URL
- **WhatsApp**: Access token + phone number ID + verify token
- **Email**: SMTP + IMAP configuration

### Features
- Adapter pattern: implement `ChannelAdapter` for custom channels
- Auto-reconnection with exponential backoff
- Delivery timeout enforcement
- Structured content degradation (falls back to text if rich content fails)
- Inbound message normalization and validation
- EventBus integration (`channel.connected`, `channel.message.received`, `channel.message.sent`)
