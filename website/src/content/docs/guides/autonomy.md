---
title: Autonomy Modules
description: Build agents that run independently — scheduling, monitoring, queuing, and reacting to events.
---

Kernova's autonomy layer gives your agents the ability to operate independently without constant user input. Five modules work together to enable proactive, always-on AI systems.

## Overview

| Module | What It Does | When to Use |
|--------|-------------|-------------|
| **Scheduler** | Run tasks on cron schedules | Hourly reports, daily digests, periodic cleanup |
| **Background Loop** | Continuously monitor conditions | Health checks, inbox polling, price monitoring |
| **Task Queue** | Execute work with priorities and retries | Email sending, API calls, batch processing |
| **Proactive Triggers** | React to system events | Alert on failures, auto-respond to patterns |
| **Channel Connectors** | Send/receive via Slack, Discord, etc. | Chat interfaces, notifications, integrations |

## Scheduler (Cron Jobs)

Schedule agents to run tasks at specific times.

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();
const kernel = app.getKernel();

// Run a daily summary at 8am
kernel.scheduler.register({
  name: 'morning-briefing',
  cronExpression: '0 8 * * *',
  target: {
    type: 'intent',
    goal: 'Generate a morning briefing with overnight alerts and today\'s priorities',
  },
});

// Run every 15 minutes
kernel.scheduler.register({
  name: 'inbox-check',
  cronExpression: '*/15 * * * *',
  target: {
    type: 'agent',
    id: 'email-agent',
    goal: 'Check inbox for urgent messages and summarize',
  },
});

// List all jobs
const jobs = kernel.scheduler.list();
console.log(`${jobs.length} scheduled jobs`);

// Remove a job
kernel.scheduler.remove(jobs[0].id);
```

### Cron Expression Format

Standard 5-field cron: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|-----------|---------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 9 * * 1-5` | 9am on weekdays |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First of every month |

### What Happens Under the Hood

1. The scheduler uses `setTimeout` chaining (not `setInterval`) to avoid drift
2. If a job is still running when its next tick fires, it's skipped (overlap protection)
3. If the kernel restarts, missed executions are detected and reported via events
4. Each execution has a configurable timeout (default: 5 minutes)

---

## Background Loop

Continuously monitor a condition and act when something changes.

```typescript
// Monitor an external API for outages
kernel.loops.register({
  name: 'api-health',
  intervalMs: 30_000, // Every 30 seconds
  monitor: async (previousResult) => {
    const res = await fetch('https://api.myservice.com/health');
    if (!res.ok) {
      return { status: 'down', since: previousResult?.since ?? Date.now() };
    }
    return null; // null = no action needed
  },
  target: {
    type: 'intent',
    goal: 'Our external API is down. Investigate the cause and notify the team.',
  },
});

// Monitor a database for new records
kernel.loops.register({
  name: 'new-orders',
  intervalMs: 60_000,
  monitor: async (lastCheckedId) => {
    const newOrders = await db.query('SELECT * FROM orders WHERE id > ?', [lastCheckedId ?? 0]);
    if (newOrders.length > 0) {
      return newOrders[newOrders.length - 1].id; // Return latest ID as context for next check
    }
    return null;
  },
  target: {
    type: 'agent',
    goal: 'Process new orders and send confirmation emails',
  },
});

// Pause when not needed
kernel.loops.pause(loopId);

// Resume
kernel.loops.resume(loopId);
```

### Key Behavior

- **Context threading**: The return value of each monitor call is passed as `previousResult` to the next call. This lets you track state between checks (like the last processed ID).
- **Non-null = action**: Returning anything other than `null` or `undefined` triggers the target action.
- **Error isolation**: If the monitor throws, the loop logs the error and continues on the next tick.

---

## Task Queue

Async execution with priorities, retries, and dead-letter handling.

```typescript
// Register handlers for different task types
kernel.taskQueue.registerHandler('send-email', async (payload, signal) => {
  const { to, subject, body } = payload as any;
  await emailService.send(to, subject, body);
});

kernel.taskQueue.registerHandler('generate-report', async (payload, signal) => {
  // signal is an AbortSignal for timeout cancellation
  const report = await generateLongReport(payload, signal);
  await storage.save(report);
});

// Enqueue tasks with different priorities
kernel.taskQueue.enqueue({
  handler: 'send-email',
  payload: { to: 'user@example.com', subject: 'Welcome!', body: '...' },
  priority: 'high',
});

kernel.taskQueue.enqueue({
  handler: 'generate-report',
  payload: { month: 'July', year: 2026 },
  priority: 'low', // Will wait for higher-priority tasks
});

// Check queue stats
const stats = kernel.taskQueue.stats();
console.log(stats);
// { pending: 12, active: 3, completed: 450, failed: 2, deadLettered: 1 }
```

### Priority Levels

Tasks are processed in priority order: `critical` > `high` > `medium` > `low`

### Retry Behavior

Failed tasks are retried with exponential backoff:
- Attempt 1 fails → wait 1s → retry
- Attempt 2 fails → wait 2s → retry
- Attempt 3 fails → moved to dead-letter queue

### Dead-Letter Queue

Tasks that exhaust all retries are moved to the dead-letter queue for manual inspection:

```typescript
// View dead-lettered tasks
const deadLetters = kernel.taskQueue.deadLetters();
for (const dl of deadLetters) {
  console.log(`Failed: ${dl.handler} - ${dl.errorMessage}`);
}

// Replay a dead-lettered task (re-enqueues it)
kernel.taskQueue.replay(deadLetters[0].id);
```

---

## Proactive Triggers

Event-driven rules that fire actions when patterns are detected.

```typescript
// Alert when any intent fails
kernel.triggers.register({
  name: 'failure-alert',
  eventPattern: 'intent.failed',
  condition: (event) => event.data?.priority === 'critical',
  conditionDescription: 'Only critical intent failures',
  action: {
    goal: 'A critical intent just failed. Investigate immediately.',
    priority: 'critical',
  },
  cooldownMs: 300_000, // Don't fire more than once per 5 minutes
});

// React to new user registrations
kernel.triggers.register({
  name: 'welcome-user',
  eventPattern: 'user.registered',
  action: {
    goal: 'Send a personalized welcome message to the new user',
    priority: 'medium',
  },
  cooldownMs: 0, // Fire for every event
});

// React to model fallback events
kernel.triggers.register({
  name: 'model-degradation',
  eventPattern: 'model.fallback',
  action: {
    goal: 'Primary model failed over. Check if the provider is experiencing issues.',
    priority: 'high',
  },
  cooldownMs: 600_000,
});
```

### Event Patterns

Patterns use dot notation with wildcards:
- `intent.failed` — exact match
- `intent.*` — matches `intent.created`, `intent.completed`, etc.
- `*.failed` — matches any `*.failed` event

---

## Channel Connectors

Connect your agents to messaging platforms.

```typescript
// Register a Slack connector
const slack = kernel.channels.register({
  channelType: 'slack',
  name: 'Company Workspace',
  config: {
    type: 'slack',
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },
});

// Connect
await kernel.channels.connect(slack.id);

// Send a message
await kernel.channels.send({
  connectorId: slack.id,
  message: { content: '🚀 Daily report is ready!' },
});

// Inbound messages are automatically routed to agents
// (configured via the onInboundMessage callback)
```

### Supported Channels

| Channel | Required Config |
|---------|----------------|
| Slack | `botToken`, `signingSecret` |
| Discord | `botToken`, `applicationId` |
| Telegram | `botToken` |
| WhatsApp | `accessToken`, `phoneNumberId`, `verifyToken` |
| Email | SMTP + IMAP settings |

### Auto-Reconnection

If a connection drops, connectors automatically reconnect with exponential backoff (1s → 2s → 4s → ... → 60s max).
