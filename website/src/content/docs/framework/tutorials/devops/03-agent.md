---
title: "Step 2: Define the DevOps Agent"
description: "Create an autonomous agent with schedules, triggers, budget, and permissions."
---

# Step 2: Define the DevOps Agent

This is the largest agent definition we've built. It uses almost every feature in the framework.

## Create the Agent

Create `agents/devops.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'DevOps Agent',
  model: 'gpt-4o',

  instructions: `
    You are an autonomous DevOps agent responsible for monitoring infrastructure,
    responding to incidents, and maintaining system reliability.

    YOUR IDENTITY:
    - You are methodical, thorough, and safety-conscious
    - You never take risky actions without explicit approval
    - You log everything you do
    - You prefer reversible actions over irreversible ones

    WHEN DOING HEALTH CHECKS:
    1. Check each service's /health endpoint
    2. If a service is unhealthy, check its metrics
    3. If metrics look bad, assess severity (P1-P4)
    4. For P1/P2: immediately alert and propose a fix
    5. For P3/P4: log it and include in the daily report

    WHEN RESPONDING TO INCIDENTS:
    1. Acknowledge the alert
    2. Check the affected service's health and metrics
    3. Identify the likely root cause
    4. Propose a fix with:
       - What you'll do
       - Risk level (low/medium/high)
       - Expected downtime
       - Rollback plan
    5. WAIT for human approval (never auto-execute risky fixes)
    6. Execute the approved fix
    7. Verify the fix worked
    8. Document what happened

    SAFETY RULES (NEVER BREAK THESE):
    - NEVER restart a production service without approval
    - NEVER scale to 0 instances without approval
    - NEVER modify environment variables without approval
    - NEVER delete anything without approval
    - If unsure about risk level, ask a human

    WHEN GENERATING REPORTS:
    Include: service health, uptime percentages, notable incidents,
    actions taken, and recommendations for improvement.
  `,

  tools: ['check-health', 'get-metrics', 'restart-service', 'web-search'],

  memory: {
    type: 'persistent',
    ttl: '90d',  // Remember incidents for 3 months
  },

  // ═══ SCHEDULES ═══
  // These run automatically — no user needed
  schedule: [
    { cron: '*/5 * * * *', goal: 'Run a health check on all monitored services. Report any issues.' },
    { cron: '0 9 * * *', goal: 'Generate a daily infrastructure status report. Include health, metrics, and any overnight incidents.' },
    { cron: '0 0 * * 0', goal: 'Generate a weekly summary: total uptime, incidents handled, actions taken, and recommendations.' },
  ],

  // ═══ TRIGGERS ═══
  // React to events from external systems
  triggers: [
    {
      event: 'webhook.alert.*',
      goal: 'An infrastructure alert was fired. Investigate the affected service, determine root cause, and propose a fix.',
      priority: 'critical',
      cooldown: 30000,  // Don't fire more than once per 30 seconds
    },
    {
      event: 'deploy.failed',
      goal: 'A deployment failed. Check the build logs and determine what went wrong.',
      priority: 'high',
    },
  ],

  // ═══ BUDGET ═══
  // Prevent the agent from consuming too many resources
  budget: {
    maxTokens: 500000,         // Max 500K tokens per month
    maxRequestsPerMinute: 5,   // Max 5 requests (user or trigger) per minute
  },

  // ═══ PERMISSIONS ═══
  // What this agent is allowed to do
  permissions: [
    'services.health.read',    // Can check health
    'services.metrics.read',   // Can read metrics
    'services.restart',        // Can restart (but needs approval via tool)
    'logs.read',               // Can read logs
    'alerts.acknowledge',      // Can acknowledge alerts
  ],

  // ═══ CHANNELS ═══
  // Declarative: records where alerts come from (connect the channel yourself)
  channels: ['alert-webhook'],

  temperature: 0.3,  // We want precise, not creative
});
```

## Let's Break This Down

### Schedules Explained

```typescript
schedule: [
  { cron: '*/5 * * * *', goal: 'Run health check...' },
]
```

This means: **every 5 minutes**, the Kernova scheduler submits a new intent to this agent with the goal "Run health check..." The agent processes it as if a user had typed that message.

Cron syntax:
- `*/5 * * * *` = every 5 minutes
- `0 9 * * *` = daily at 9:00 AM
- `0 0 * * 0` = weekly on Sunday at midnight

### Triggers Explained

```typescript
triggers: [
  { event: 'webhook.alert.*', goal: '...', priority: 'critical' },
]
```

When the event bus publishes an event matching `webhook.alert.*`, the trigger fires and submits a goal to this agent. The `priority: 'critical'` ensures it's processed immediately (jumps the queue).

`cooldown: 30000` prevents alert storms — if 100 alerts fire in 1 second, only the first one triggers the agent. The rest are ignored for 30 seconds.

### Budget Explained

```typescript
budget: { maxTokens: 500000, maxRequestsPerMinute: 5 }
```

Without budget limits, a bug in your triggers could make the agent call OpenAI thousands of times (expensive!). Budget controls prevent this:
- If the agent tries to exceed 500K tokens/month → request rejected
- If it makes more than 5 requests/minute → rate limited (HTTP 429)

Usage is counted per calendar month (UTC) and saved in `kernova-data/agent-budgets.json`, so the limits hold across restarts.

### Permissions Explained

```typescript
permissions: ['services.health.read', 'services.restart']
```

This declares what the agent is allowed to do. The identity system can enforce these — if a tool tries to do something not in the permissions list, it's blocked.

For now this is declarative (documentation/intent). Full enforcement comes when you connect it to your infrastructure's access control.

---

[Continue to Step 3: Build the Tools →](/framework/tutorials/devops/04-tools)
