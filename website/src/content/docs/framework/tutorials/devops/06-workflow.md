---
title: "Step 5: Durable Workflows"
description: "Build multi-step workflows with checkpointing, retries, and human approval gates."
---

# Step 5: Durable Workflows

So far our agent reacts to events and uses tools. But what happens when you need a **multi-step process** that:

- Takes minutes to complete (not instant)
- Must not lose progress if the server restarts
- Has steps that require human approval
- Needs automatic retries on failure

That's a **durable workflow**. It's like a pipeline where each step is saved to disk, so if your server crashes halfway through step 3, it picks up from step 3 — not step 1.

---

## Why Durable Execution Matters

Without durability:

```
Step 1: Detect problem    ✓ completed
Step 2: Diagnose          ✓ completed
Step 3: Fix (restart)     ... server crashes ...
                          💥 All progress lost
                          Start over from Step 1
```

With durability:

```
Step 1: Detect problem    ✓ checkpointed
Step 2: Diagnose          ✓ checkpointed
Step 3: Fix (restart)     ... server crashes ...
                          🔄 Server restarts
                          ✓ Resumes from Step 3
```

---

## Workflow 1: Incident Response

This is the big one — a full incident response workflow that detects, diagnoses, notifies, fixes, and verifies.

Create `agents/workflows/incident-response.ts`:

```typescript
import { defineWorkflow } from '@kernova/framework';

export default defineWorkflow({
  name: 'incident-response',
  description: 'Full incident response: detect → diagnose → notify → fix → verify',

  // Auto-trigger when a critical alert arrives
  trigger: {
    event: 'channel.message.alerts',
    filter: { severity: 'critical' },
  },

  // Max retries per step
  maxRetries: 3,

  // Each step gets 60 seconds to complete
  stepTimeout: 60000,

  steps: [
    // Step 1: Detect — confirm the problem is real
    {
      name: 'detect',
      description: 'Verify the alert is legitimate (not a false positive)',
      execute: async (ctx) => {
        ctx.log('Step 1: Verifying alert...');

        // Get the alert data from the trigger event
        const alert = ctx.previous.triggerData as any;
        const service = alert?.service || 'unknown';

        // Double-check by calling health endpoint ourselves
        const res = await fetch(`https://kn-${service}.onrender.com/health`, {
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        const isDown = !res || !res.ok;

        // Save our findings for the next step
        await ctx.checkpoint({
          service,
          alertSource: alert?.source,
          confirmed: isDown,
          statusCode: res?.status || 'unreachable',
        });

        ctx.log(isDown
          ? `Confirmed: ${service} is DOWN (${res?.status || 'no response'})`
          : `False alarm: ${service} is healthy`
        );

        return { service, confirmed: isDown };
      },
    },

    // Step 2: Diagnose — figure out what's wrong
    {
      name: 'diagnose',
      description: 'Gather metrics and determine root cause',
      execute: async (ctx) => {
        const { service, confirmed } = ctx.previous.detect as any;

        if (!confirmed) {
          ctx.log('Alert was a false positive. Skipping.');
          return { action: 'none', reason: 'false-positive' };
        }

        ctx.log(`Step 2: Diagnosing ${service}...`);

        // Try to get metrics (might fail if service is totally down)
        let metrics: any = null;
        try {
          const res = await fetch(`https://kn-${service}.onrender.com/metrics`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) metrics = await res.json();
        } catch {
          ctx.log('Cannot reach metrics endpoint — service may be fully down');
        }

        // Determine recommended action
        let action = 'restart';
        let reason = 'Service is unresponsive';

        if (metrics) {
          const memUsage = metrics.memory
            ? (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100
            : 0;

          if (memUsage > 90) {
            reason = `Memory usage at ${Math.round(memUsage)}% — likely OOM`;
          } else if (metrics.uptime > 86400 * 7) {
            reason = `Running for ${Math.round(metrics.uptime / 86400)} days without restart`;
          }
        }

        await ctx.checkpoint({ service, action, reason, metrics });

        ctx.log(`Diagnosis: ${reason}. Recommended action: ${action}`);
        return { service, action, reason };
      },
    },

    // Step 3: Notify — tell the team what's happening
    {
      name: 'notify',
      description: 'Send notification to the team about the incident',
      execute: async (ctx) => {
        const { service, action, reason } = ctx.previous.diagnose as any;

        if (action === 'none') {
          return { notified: false };
        }

        ctx.log(`Step 3: Notifying team about ${service} incident`);

        // In production, this would send to Slack/email/PagerDuty
        const notification = {
          channel: '#incidents',
          message: `🚨 **Incident: ${service}**\n` +
                   `Cause: ${reason}\n` +
                   `Action: ${action}\n` +
                   `Status: Awaiting approval to proceed`,
          timestamp: new Date().toISOString(),
        };

        ctx.log(`Notification sent: ${notification.message}`);

        await ctx.checkpoint({ notification });
        return { notified: true, notification };
      },
    },

    // Step 4: Fix — THIS REQUIRES HUMAN APPROVAL
    {
      name: 'fix',
      description: 'Execute the fix (restart service). Requires human approval because this causes downtime.',

      // ⚠️ THE WORKFLOW PAUSES HERE until a human approves
      requiresApproval: true,

      execute: async (ctx) => {
        const { service, action, reason } = ctx.previous.diagnose as any;

        ctx.log(`Step 4: Executing fix — ${action} on ${service}`);

        if (action === 'restart') {
          // In production: call Render API, Kubernetes, etc.
          ctx.log(`Restarting ${service}...`);

          // Simulate the restart
          await new Promise((r) => setTimeout(r, 2000));

          return {
            fixed: true,
            action: 'restart',
            service,
            reason,
            timestamp: new Date().toISOString(),
          };
        }

        return { fixed: false, reason: 'No automated fix available' };
      },
    },

    // Step 5: Verify — confirm the fix worked
    {
      name: 'verify',
      description: 'Verify the service is back online after the fix',
      execute: async (ctx) => {
        const { service } = ctx.previous.diagnose as any;
        const { fixed } = ctx.previous.fix as any;

        if (!fixed) {
          return { verified: false, reason: 'No fix was applied' };
        }

        ctx.log(`Step 5: Verifying ${service} is back online...`);

        // Wait a bit for the service to boot
        await new Promise((r) => setTimeout(r, 5000));

        // Check health
        let healthy = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          ctx.log(`Health check attempt ${attempt}/3...`);
          try {
            const res = await fetch(`https://kn-${service}.onrender.com/health`, {
              signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
              healthy = true;
              break;
            }
          } catch {
            // Wait 5 seconds between attempts
            await new Promise((r) => setTimeout(r, 5000));
          }
        }

        const result = {
          verified: healthy,
          service,
          message: healthy
            ? `✅ ${service} is back online and healthy`
            : `❌ ${service} is still unhealthy after restart`,
        };

        ctx.log(result.message);
        return result;
      },
    },
  ],
});
```

---

## How This Workflow Executes

Here's the timeline of what happens when a critical alert fires:

```
t=0s   [Alert received]
       ↓
t=1s   Step 1: detect
       → Calls health endpoint → confirms service is down
       → Checkpoints: { service: "api", confirmed: true }
       ✓ Saved to disk

t=3s   Step 2: diagnose
       → Gets metrics → memory at 95%
       → Recommends: restart
       → Checkpoints: { action: "restart", reason: "OOM" }
       ✓ Saved to disk

t=5s   Step 3: notify
       → Sends Slack notification to #incidents
       ✓ Saved to disk

t=6s   Step 4: fix
       ⚠️ requiresApproval: true
       → WORKFLOW PAUSES
       → Approval request created
       → Shows in dashboard + Slack

t=???  [Human reviews and clicks "Approve"]
       → Step 4 executes → restarts service
       ✓ Saved to disk

t+7s   Step 5: verify
       → Waits for service to boot
       → Runs 3 health check attempts
       → Confirms service is back online
       ✓ WORKFLOW COMPLETE
```

If the server crashes at any point (say during Step 3), it resumes from Step 3 on restart — Steps 1 and 2 are already checkpointed.

---

## Workflow 2: Scheduled Audit

A simpler workflow that runs on a schedule:

Create `agents/workflows/daily-audit.ts`:

```typescript
import { defineWorkflow } from '@kernova/framework';

export default defineWorkflow({
  name: 'daily-audit',
  description: 'Daily infrastructure audit: check all services, report issues',

  trigger: 'schedule.24h', // Runs once per day

  steps: [
    {
      name: 'scan',
      description: 'Check health of all monitored services',
      execute: async (ctx) => {
        ctx.log('Running daily audit scan...');

        const services = ['api-gateway', 'support-bot', 'worker'];
        const results: any[] = [];

        for (const service of services) {
          try {
            const res = await fetch(`https://kn-${service}.onrender.com/health`, {
              signal: AbortSignal.timeout(10000),
            });
            results.push({
              service,
              status: res.ok ? 'healthy' : 'unhealthy',
              statusCode: res.status,
            });
          } catch (err: any) {
            results.push({ service, status: 'unreachable', error: err.message });
          }
        }

        await ctx.checkpoint({ results });
        return { results, scannedAt: new Date().toISOString() };
      },
    },

    {
      name: 'report',
      description: 'Generate and send the daily report',
      execute: async (ctx) => {
        const { results } = ctx.previous.scan as any;

        const unhealthy = results.filter((r: any) => r.status !== 'healthy');
        const healthy = results.filter((r: any) => r.status === 'healthy');

        const report = {
          date: new Date().toISOString().split('T')[0],
          total: results.length,
          healthy: healthy.length,
          unhealthy: unhealthy.length,
          issues: unhealthy,
          summary: unhealthy.length === 0
            ? '✅ All services healthy'
            : `⚠️ ${unhealthy.length} service(s) need attention`,
        };

        ctx.log(report.summary);
        return report;
      },
    },
  ],
});
```

---

## The Approval Flow (Human-in-the-Loop)

When a workflow step has `requiresApproval: true`, here's what happens behind the scenes:

### 1. Approval Request Created

```typescript
// Internally, the framework creates:
{
  id: "apr_abc123",
  workflow: "incident-response",
  step: "fix",
  description: "Execute the fix (restart service). Requires human approval.",
  context: {
    service: "api-gateway",
    action: "restart",
    reason: "Memory usage at 95%",
  },
  status: "pending",
  createdAt: "2025-01-15T10:30:00Z",
  expiresAt: "2025-01-15T11:30:00Z", // 1 hour TTL
}
```

### 2. Shows in the Dashboard

On the Kernova Cloud dashboard, under Workflows/Approvals:

```
┌────────────────────────────────────────────┐
│ ⚠️ Pending Approval                        │
│                                            │
│ Workflow: incident-response                │
│ Step: fix                                  │
│ Service: api-gateway                       │
│ Action: Restart service                    │
│ Reason: Memory usage at 95%               │
│                                            │
│ [✓ Approve]  [✗ Deny]                     │
└────────────────────────────────────────────┘
```

### 3. Human Decides

- **Approve** → Step executes → workflow continues to next step
- **Deny** → Step is skipped → agent is told "action denied" → workflow ends or tries alternative
- **Timeout** (1 hour) → Automatically denied → workflow records timeout

### 4. Approval via API

You can also approve programmatically:

```bash
# Approve
curl -X POST https://your-app.onrender.com/api/approvals/apr_abc123/approve

# Deny
curl -X POST https://your-app.onrender.com/api/approvals/apr_abc123/deny \
  -d '{ "reason": "Not during business hours" }'
```

---

## Error Handling & Retries

Each step gets automatic retries:

```typescript
// If Step 2 fails:
Attempt 1: fetch('/metrics') → timeout → RETRY
Attempt 2: fetch('/metrics') → timeout → RETRY
Attempt 3: fetch('/metrics') → timeout → FAIL

// After maxRetries (3), the step is marked "failed"
// The workflow stops and records the error
```

You can customize retry behavior per workflow:

```typescript
export default defineWorkflow({
  name: 'my-workflow',
  maxRetries: 5,       // 5 retries per step
  stepTimeout: 120000, // 2 minutes per step (instead of default 60s)
  steps: [...]
});
```

---

## Checkpointing Deep Dive

`ctx.checkpoint()` saves state to SQLite (or your configured store):

```typescript
execute: async (ctx) => {
  // Do expensive work
  const data = await fetchLargeDataset();

  // Save it — if server crashes after this line,
  // the data is preserved and won't be re-fetched
  await ctx.checkpoint({ data });

  // Continue processing
  const result = processData(data);

  return result;
}
```

**When to checkpoint:**
- After expensive API calls
- After fetching data you don't want to re-fetch
- Before starting a dangerous operation
- Anytime you'd be sad if the work was lost

---

## Updated Project Structure

```
devops-agent/
├── agents/
│   ├── devops.ts
│   ├── tools/
│   │   ├── check-health.ts
│   │   ├── get-metrics.ts
│   │   └── restart-service.ts
│   ├── channels/
│   │   ├── alerts.ts
│   │   ├── github.ts
│   │   └── slack.ts
│   ├── triggers/
│   │   ├── on-alert.ts
│   │   ├── on-deploy.ts
│   │   └── scheduled-check.ts
│   └── workflows/                    # NEW
│       ├── incident-response.ts      # Full incident pipeline
│       └── daily-audit.ts            # Scheduled daily check
├── app/
│   └── page.tsx
├── kernova.config.ts
└── package.json
```

---

## Testing the Workflow

```bash
kernova dev
```

In the chat:

1. **"Run the incident response workflow for api-gateway"**
   - Agent runs Steps 1–3 automatically
   - Pauses at Step 4 (asks for approval)
   - Type "approve" → Step 4 executes → Step 5 verifies

2. **"Run the daily audit"**
   - Scans all services
   - Generates a report

3. **Simulate a crash:**
   - Start the workflow
   - Kill the server (Ctrl+C) during Step 2
   - Restart with `kernova dev`
   - The workflow resumes from Step 2 (not Step 1)

---

## Summary

| Feature | What It Does |
|---|---|
| `defineWorkflow` | Multi-step durable pipeline |
| `ctx.checkpoint()` | Save state to disk (survives crashes) |
| `requiresApproval` | Pause workflow until human approves |
| `maxRetries` | Auto-retry failed steps |
| `stepTimeout` | Kill stuck steps after N ms |
| `trigger` | Auto-start workflow on events |

This is the most powerful part of Kernova — workflows that are reliable, resumable, and safe.

---

[Continue to Step 6: Deploy to Production →](/framework/tutorials/devops/07-deploy)
