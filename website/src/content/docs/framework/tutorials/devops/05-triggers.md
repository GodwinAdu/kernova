---
title: "Step 4: Add Triggers & Channels"
description: "Set up webhook channels and event-driven triggers so your DevOps agent reacts automatically."
---

# Step 4: Add Triggers & Channels

Right now our agent only responds when you type in the chat. A **real** DevOps agent needs to react to external events — an alert from Datadog, a webhook from GitHub, a Slack message from an engineer saying "something's broken."

That's what **channels** and **triggers** do:

- **Channel** = a way to receive messages (webhook, Slack, email, etc.)
- **Trigger** = a rule that says "when this event happens, wake up the agent with this goal"

## How It Works

```
External Event (GitHub push, alert, cron)
  ↓
Channel receives message
  ↓
Emits event: "channel.message.webhook"
  ↓
Trigger matches the event pattern
  ↓
Agent receives a goal: "Deploy pushed code to staging"
  ↓
Agent uses tools to accomplish the goal
```

No human had to type anything. The agent **proactively** handled the event.

---

## Channel 1: Webhook (Receive HTTP Alerts)

Create `agents/channels/alerts.ts`:

```typescript
import { defineChannel } from '@kernova/framework';

export default defineChannel({
  name: 'alerts',
  type: 'webhook',
  path: '/hooks/alerts',

  onMessage: async (msg) => {
    // Parse the incoming webhook payload
    const { source, severity, service, message } = msg.metadata as any;

    console.log(`[Alert] ${source}: ${message} (${severity})`);

    // Route to the devops agent with context
    return {
      agent: 'devops',
      input: `Alert from ${source}: ${message}. Service: ${service}. Severity: ${severity}. Investigate and fix if possible.`,
    };
  },
});
```

**What this does:**

1. Exposes a webhook at `POST /hooks/alerts`
2. When any monitoring tool (Datadog, PagerDuty, UptimeRobot) sends a POST request, this channel receives it
3. It parses the payload and routes it to the `devops` agent with a clear goal

### Testing the Webhook

With `kernova dev` running, send a test alert:

```bash
curl -X POST http://localhost:4555/hooks/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "source": "uptime-monitor",
    "severity": "critical",
    "service": "api-gateway",
    "message": "Health check failed 3 times in a row"
  }'
```

The agent will automatically wake up, call `check-health`, and investigate.

---

## Channel 2: GitHub Webhooks (React to Pushes)

Create `agents/channels/github.ts`:

```typescript
import { defineChannel } from '@kernova/framework';

export default defineChannel({
  name: 'github',
  type: 'webhook',
  path: '/hooks/github',

  onMessage: async (msg) => {
    const payload = msg.metadata as any;
    const event = payload.event; // 'push', 'pull_request', 'release'

    if (event === 'push' && payload.ref === 'refs/heads/main') {
      return {
        agent: 'devops',
        input: `New push to main branch by ${payload.pusher?.name || 'unknown'}. ` +
               `Commits: ${payload.commits?.length || 0}. ` +
               `Run health checks on all production services to verify nothing broke.`,
      };
    }

    if (event === 'release') {
      return {
        agent: 'devops',
        input: `New release published: ${payload.release?.tag_name}. ` +
               `Check if deployment is needed.`,
      };
    }

    // Ignore other events
    return undefined;
  },
});
```

**Setup in GitHub:**

1. Go to your repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-app.onrender.com/hooks/github`
3. Content type: `application/json`
4. Events: Push, Releases

---

## Channel 3: Slack (Two-Way Communication)

Create `agents/channels/slack.ts`:

```typescript
import { defineChannel } from '@kernova/framework';

export default defineChannel({
  name: 'slack',
  type: 'slack',
  config: {
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },

  onMessage: async (msg) => {
    // Only respond to direct messages or @mentions
    if (!msg.content.includes('@devops') && msg.metadata?.channelType !== 'im') {
      return undefined;
    }

    return {
      agent: 'devops',
      input: `Slack message from ${msg.sender}: "${msg.content}". Respond helpfully.`,
    };
  },
});
```

With this, engineers can type `@devops check the health of api-gateway` in Slack, and the agent responds.

---

## Adding Triggers

Triggers are rules that fire when specific events happen. They're separate from channels — triggers can react to **any** event in the system.

Create `agents/triggers/on-alert.ts`:

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'on-critical-alert',
  description: 'Auto-investigate when a critical alert fires',
  event: 'channel.message.alerts',
  agent: 'devops',
  goal: 'A critical alert was received. Check the health of the affected service, get metrics, and recommend a fix. If the service is unhealthy, propose a restart.',
  priority: 'critical',
  cooldown: 30000, // Don't fire more than once per 30 seconds
  filter: {
    severity: 'critical',
  },
});
```

Create `agents/triggers/on-deploy.ts`:

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'on-deploy-complete',
  description: 'Run health checks after every deploy',
  event: 'deploy.completed',
  agent: 'devops',
  goal: 'A deployment just completed. Run health checks on all services to make sure nothing broke. Report the results.',
  priority: 'high',
  cooldown: 10000,
});
```

Create `agents/triggers/scheduled-check.ts`:

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'scheduled-health-check',
  description: 'Run health checks every 5 minutes',
  event: 'schedule.5m',
  agent: 'devops',
  goal: 'Run a routine health check on all monitored services. Only alert if something is wrong.',
  priority: 'low',
  cooldown: 300000, // 5 minutes
});
```

---

## Understanding Event Patterns

Events in Kernova follow a dot-notation pattern:

| Event Pattern | When It Fires |
|---|---|
| `channel.message.alerts` | A message arrives on the "alerts" channel |
| `channel.message.github` | A message arrives on the "github" channel |
| `channel.message.*` | A message arrives on ANY channel |
| `deploy.completed` | A deployment finishes successfully |
| `deploy.failed` | A deployment fails |
| `schedule.5m` | Every 5 minutes (built-in scheduler) |
| `schedule.1h` | Every hour |
| `intent.failed` | An agent fails to complete a goal |

---

## Updated Project Structure

After adding channels and triggers:

```
devops-agent/
├── agents/
│   ├── devops.ts                    # Main agent
│   ├── tools/
│   │   ├── check-health.ts
│   │   ├── get-metrics.ts
│   │   └── restart-service.ts
│   ├── channels/
│   │   ├── alerts.ts               # NEW: Webhook for alerts
│   │   ├── github.ts               # NEW: GitHub webhook
│   │   └── slack.ts                # NEW: Slack integration
│   └── triggers/
│       ├── on-alert.ts             # NEW: React to alerts
│       ├── on-deploy.ts            # NEW: Post-deploy checks
│       └── scheduled-check.ts     # NEW: Periodic health checks
├── app/
│   └── page.tsx
├── kernova.config.ts
└── package.json
```

---

## Testing the Full Flow

1. **Start the dev server:**

```bash
kernova dev
```

2. **Simulate an alert:**

```bash
curl -X POST http://localhost:4555/hooks/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "source": "uptime-monitor",
    "severity": "critical",
    "service": "api-gateway",
    "message": "Service returned 503 for 60 seconds"
  }'
```

3. **Watch the agent react:**

```
[Channel: alerts] Received message from uptime-monitor
[Trigger: on-critical-alert] Matched event: channel.message.alerts
[Agent: devops] Goal: "A critical alert was received..."
[Tool: check-health] Checking api-gateway...
[Tool: get-metrics] Getting metrics for api-gateway...
[Agent: devops] Response: "The API gateway is returning 503.
  Memory usage is at 95%. I recommend restarting the service."
[Tool: restart-service] ⚠️ REQUIRES APPROVAL
[Approval] Waiting for human to approve restart...
```

The agent investigated automatically, diagnosed the problem, and proposed a fix — but **stopped** before the dangerous action, waiting for a human.

---

## Key Concepts Recap

| Concept | What It Does |
|---|---|
| `defineChannel` | Opens a door for external messages to come in |
| `defineTrigger` | Watches for events and wakes up an agent |
| `cooldown` | Prevents trigger spam (won't fire again within the window) |
| `filter` | Only fires if event data matches the filter |
| `priority` | Controls queue ordering (`critical` runs first) |
| `onMessage` | Transforms raw webhook data into an agent goal |

---

[Continue to Step 5: Durable Workflows →](/framework/tutorials/devops/06-workflow)
