---
title: "Step 3: Build the Tools"
description: "Create health check, metrics, and restart tools with approval gates."
---

# Step 3: Build the Tools

The DevOps agent needs tools to interact with infrastructure. We'll build three:

1. **check-health** — Ping a service's health endpoint (safe, no approval needed)
2. **get-metrics** — Read CPU/memory/requests (safe, no approval needed)
3. **restart-service** — Restart a service (**dangerous — requires human approval**)

## Tool 1: Health Check (Safe)

Create `agents/tools/check-health.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'check-health',
  description: 'Check if a service is healthy by calling its /health endpoint. Returns status, latency, and any error messages.',
  parameters: {
    service: {
      type: 'string',
      description: 'Service name (e.g., "api-gateway") or full URL',
      required: true,
    },
  },
  execute: async ({ service }, ctx) => {
    ctx.log(`Checking health: ${service}`);

    // Build the URL — if it's just a name, construct the Render URL
    const url = (service as string).startsWith('http')
      ? `${service}/health`
      : `https://kn-${service}.onrender.com/health`;

    try {
      const start = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const latency = Date.now() - start;

      if (res.ok) {
        const data = await res.json();
        return {
          status: 'healthy',
          latency: `${latency}ms`,
          uptime: data.uptime ? `${Math.round(data.uptime)}s` : undefined,
          agents: data.agents?.length || 0,
          details: data,
        };
      }

      return {
        status: 'unhealthy',
        statusCode: res.status,
        latency: `${latency}ms`,
        message: await res.text().catch(() => 'No response body'),
      };
    } catch (err: any) {
      return {
        status: 'unreachable',
        error: err.message,
        suggestion: err.message.includes('timeout')
          ? 'Service is not responding — may be down or overloaded'
          : 'Cannot connect — DNS issue or service is offline',
      };
    }
  },
});
```

**Why this tool is safe:** It only reads data. It can't break anything.

## Tool 2: Get Metrics (Safe)

Create `agents/tools/get-metrics.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'get-metrics',
  description: 'Get performance metrics for a service: CPU usage, memory, request count, error rate, and response latency.',
  parameters: {
    service: {
      type: 'string',
      description: 'Service name to get metrics for',
      required: true,
    },
  },
  execute: async ({ service }, ctx) => {
    ctx.log(`Getting metrics for: ${service}`);

    const url = `https://kn-${service}.onrender.com/metrics`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

      if (res.ok) {
        const data = await res.json();
        return {
          status: 'live',
          uptime: `${Math.round(data.uptime || 0)}s`,
          memory: data.memory ? {
            used: `${Math.round(data.memory.heapUsed / 1024 / 1024)}MB`,
            total: `${Math.round(data.memory.heapTotal / 1024 / 1024)}MB`,
            percentage: `${Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100)}%`,
          } : 'unknown',
          agents: data.agents || 0,
          providers: data.providers || [],
        };
      }

      return { status: 'unavailable', reason: `HTTP ${res.status}` };
    } catch (err: any) {
      return { status: 'offline', error: err.message };
    }
  },
});
```

## Tool 3: Restart Service (DANGEROUS — Requires Approval)

Create `agents/tools/restart-service.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'restart-service',
  description: 'Restart a production service. CAUTION: This causes brief downtime (30-60 seconds). Only use when a service is unhealthy and restart is the appropriate fix.',

  // ⚠️ THIS IS THE KEY LINE
  requiresConfirmation: true,  // Human must approve before this executes

  parameters: {
    service: {
      type: 'string',
      description: 'Service name to restart',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Why the restart is needed (for audit trail)',
      required: true,
    },
  },
  execute: async ({ service, reason }, ctx) => {
    ctx.log(`⚠️ RESTARTING: ${service}`);
    ctx.log(`Reason: ${reason}`);

    // In production, this would call:
    // - Render API: POST /services/{id}/deploys
    // - Or Kubernetes: kubectl rollout restart
    // - Or AWS ECS: update-service --force-new-deployment

    // For now, simulate:
    return {
      restarted: true,
      service,
      reason,
      timestamp: new Date().toISOString(),
      expectedDowntime: '30-60 seconds',
      note: 'Service will be back online shortly. Monitor health endpoint.',
    };
  },
});
```

## Understanding `requiresConfirmation: true`

This is the **human-in-the-loop** mechanism. When the agent decides to call `restart-service`:

```
Agent thinks: "The API is unhealthy, I should restart it"
  ↓
Agent calls: restart-service({ service: "api-gateway", reason: "High memory" })
  ↓
Framework intercepts: "This tool requires confirmation"
  ↓
Approval request created → shows in dashboard
  ↓
Human reviews → clicks "Approve" or "Deny"
  ↓
If approved → tool executes → service restarts
If denied → agent is told "action was denied" → tries alternative
```

The agent **never** restarts a service without a human saying "yes." This is critical for production safety.

## Testing the Tools

```bash
kernova dev
```

In the chat, ask:

1. **"Check the health of support-bot"**
   - Agent calls `check-health` → shows healthy/unhealthy status

2. **"What are the metrics for support-bot?"**
   - Agent calls `get-metrics` → shows CPU, memory, uptime

3. **"Restart support-bot"**
   - Agent proposes restart → ⚠️ asks for approval (or in dev mode, auto-approves)

---

[Continue to Step 4: Add Triggers & Channels →](/framework/tutorials/devops/05-triggers)
