---
title: "Tutorial: Autonomous DevOps Agent"
description: "Build a production-grade DevOps agent with schedules, triggers, approvals, channels, and durable workflows."
---

# Tutorial: Autonomous DevOps Agent

**Difficulty:** Advanced  
**Time:** 45 minutes  
**What you'll build:** An autonomous agent that monitors infrastructure, responds to incidents, runs scheduled checks, and coordinates with your team via Slack — with human approval for dangerous actions.

## What You'll Learn

- Scheduled agent execution (cron)
- Event-driven triggers
- Human-in-the-loop approvals
- Channel integration (Slack/webhook)
- Durable workflows for multi-step operations
- Background tasks
- Full production architecture

## Step 1: Create the Project

```bash
npx create-kernova-app devops-agent
cd devops-agent
```

## Step 2: Define the DevOps Agent

```typescript
// agents/devops.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'DevOps Agent',
  model: 'gpt-4o',
  instructions: `
    You are an autonomous DevOps agent responsible for infrastructure monitoring,
    incident response, and operational tasks.
    
    RESPONSIBILITIES:
    - Monitor system health and alert on issues
    - Investigate incidents and suggest fixes
    - Execute approved remediation actions
    - Generate daily status reports
    - Manage deployments with proper approval chains
    
    SAFETY RULES:
    - NEVER delete production resources without explicit approval
    - NEVER modify DNS or networking without approval
    - ALWAYS log every action you take
    - If unsure, ask for human guidance
    - Prefer safe, reversible actions over risky ones
    
    WHEN RESPONDING TO INCIDENTS:
    1. Acknowledge the alert
    2. Investigate the root cause
    3. Propose a fix with risk assessment
    4. Wait for approval if the fix is risky
    5. Execute the fix
    6. Verify the fix worked
    7. Document what happened
  `,
  tools: ['check-health', 'get-metrics', 'restart-service', 'scale-service', 'web-search'],
  skills: ['infrastructure'],
  memory: { type: 'persistent', ttl: '90d' },

  // Run health checks every 5 minutes
  schedule: [
    { cron: '*/5 * * * *', goal: 'Run health check on all services' },
    { cron: '0 9 * * *', goal: 'Generate daily infrastructure status report' },
    { cron: '0 0 * * 0', goal: 'Generate weekly summary of incidents and actions taken' },
  ],

  // React to events automatically
  triggers: [
    { event: 'alert.fired', goal: 'Investigate and respond to this alert', priority: 'critical', cooldown: 30000 },
    { event: 'deploy.failed', goal: 'Investigate why this deployment failed', priority: 'high' },
  ],

  // Budget limits (prevent runaway costs)
  budget: {
    maxTokens: 500000,        // Per month
    maxRequestsPerMinute: 10, // Rate limit
  },

  // Permissions
  permissions: [
    'services.read',
    'services.restart',
    'metrics.read',
    'logs.read',
    'alerts.acknowledge',
  ],

  // Listen for webhooks
  channels: ['pagerduty-webhook'],
});
```

## Step 3: Create Custom Tools

```typescript
// agents/tools/check-health.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'check-health',
  description: 'Check the health status of a service by hitting its health endpoint',
  parameters: {
    service: { type: 'string', description: 'Service name or URL', required: true },
  },
  execute: async ({ service }, ctx) => {
    ctx.log(`Checking health of: ${service}`);
    
    const url = (service as string).startsWith('http') 
      ? service 
      : `https://${service}.onrender.com/health`;

    try {
      const start = Date.now();
      const res = await fetch(url as string, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      
      if (res.ok) {
        const data = await res.json();
        return { status: 'healthy', latency, uptime: data.uptime, agents: data.agents };
      }
      return { status: 'unhealthy', statusCode: res.status, latency };
    } catch (err: any) {
      return { status: 'unreachable', error: err.message };
    }
  },
});
```

```typescript
// agents/tools/get-metrics.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'get-metrics',
  description: 'Get resource metrics (CPU, memory, requests) for a service',
  parameters: {
    service: { type: 'string', description: 'Service name', required: true },
  },
  execute: async ({ service }, ctx) => {
    ctx.log(`Getting metrics for: ${service}`);
    
    // In production, this would call your metrics API (Datadog, Prometheus, etc.)
    return {
      cpu: Math.round(Math.random() * 80) + '%',
      memory: Math.round(Math.random() * 70) + '%',
      requests: Math.floor(Math.random() * 1000),
      errors: Math.floor(Math.random() * 5),
      p99Latency: Math.floor(Math.random() * 500) + 'ms',
    };
  },
});
```

```typescript
// agents/tools/restart-service.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'restart-service',
  description: 'Restart a service. USE WITH CAUTION — causes brief downtime.',
  requiresConfirmation: true, // Requires human approval
  parameters: {
    service: { type: 'string', description: 'Service to restart', required: true },
    reason: { type: 'string', description: 'Why are we restarting', required: true },
  },
  execute: async ({ service, reason }, ctx) => {
    ctx.log(`RESTARTING service: ${service}. Reason: ${reason}`);
    
    // In production: call Render/Railway/K8s API to restart
    return { restarted: true, service, timestamp: new Date().toISOString() };
  },
});
```

```typescript
// agents/tools/scale-service.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'scale-service',
  description: 'Scale a service up or down. Requires approval for scaling to 0.',
  requiresConfirmation: true,
  parameters: {
    service: { type: 'string', description: 'Service to scale', required: true },
    instances: { type: 'number', description: 'Number of instances', required: true },
  },
  execute: async ({ service, instances }, ctx) => {
    ctx.log(`Scaling ${service} to ${instances} instances`);
    return { scaled: true, service, instances, timestamp: new Date().toISOString() };
  },
});
```

## Step 4: Define a Trigger

```typescript
// triggers/on-alert.ts
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'on-alert-fired',
  description: 'Respond to infrastructure alerts',
  event: 'webhook.pagerduty.*',
  agent: 'devops',
  goal: 'Investigate and respond to the infrastructure alert. Check service health, review metrics, and propose a fix.',
  priority: 'critical',
  cooldown: 30000, // Don't fire more than once per 30 seconds
});
```

## Step 5: Define a Channel (Webhook)

```typescript
// channels/pagerduty.ts
import { defineChannel } from '@kernova/framework';

export default defineChannel({
  name: 'pagerduty-webhook',
  type: 'webhook',
  port: 3100,
  path: '/webhooks/pagerduty',
  onMessage: async (msg) => {
    // Route PagerDuty alerts to the devops agent
    return {
      agent: 'devops',
      input: `ALERT: ${msg.content}. Investigate immediately.`,
    };
  },
});
```

## Step 6: Define a Durable Workflow

```typescript
// workflows/incident-response.ts
import { defineWorkflow } from '@kernova/framework';

export default defineWorkflow({
  name: 'incident-response',
  description: 'Full incident response: detect → investigate → fix → verify',
  maxRetries: 2,
  stepTimeout: 120000, // 2 minutes per step
  steps: [
    {
      name: 'detect',
      execute: async (ctx) => {
        ctx.log('Detecting issue...');
        // Check all services
        return { affectedService: 'api-gateway', symptom: 'high latency' };
      },
    },
    {
      name: 'investigate',
      execute: async (ctx) => {
        ctx.log('Investigating root cause...');
        const service = (ctx.previous.detect as any).affectedService;
        return { rootCause: 'Memory leak in connection pool', confidence: 0.85 };
      },
    },
    {
      name: 'propose-fix',
      execute: async (ctx) => {
        const cause = (ctx.previous.investigate as any).rootCause;
        ctx.log(`Proposing fix for: ${cause}`);
        return { 
          fix: 'Restart the service to clear connection pool',
          risk: 'low',
          downtime: '~30 seconds',
        };
      },
    },
    {
      name: 'execute-fix',
      requiresApproval: true, // Human must approve before executing
      description: 'Restart api-gateway to clear memory leak (30s downtime)',
      execute: async (ctx) => {
        ctx.log('Executing fix: restarting api-gateway');
        // Actually restart the service
        return { executed: true, timestamp: new Date().toISOString() };
      },
    },
    {
      name: 'verify',
      execute: async (ctx) => {
        ctx.log('Verifying fix...');
        // Wait a moment then check health
        return { verified: true, healthStatus: 'healthy', latency: '45ms' };
      },
    },
    {
      name: 'document',
      execute: async (ctx) => {
        ctx.log('Documenting incident...');
        return {
          incident: {
            detected: ctx.previous.detect,
            cause: ctx.previous.investigate,
            fix: ctx.previous['propose-fix'],
            resolution: ctx.previous['execute-fix'],
            verification: ctx.previous.verify,
            resolvedAt: new Date().toISOString(),
          },
        };
      },
    },
  ],
});
```

## Step 7: Define a Background Task

```typescript
// tasks/send-alert.ts
import { defineTask } from '@kernova/framework';

export default defineTask({
  name: 'send-alert',
  description: 'Send alert notifications to the team',
  maxRetries: 3,
  priority: 'high',
  execute: async (payload, ctx) => {
    ctx.log(`Sending alert: ${payload.message}`);
    
    // In production: send to Slack, PagerDuty, email, etc.
    console.log(`[ALERT] ${payload.severity}: ${payload.message}`);
    
    return { sent: true, channel: payload.channel || 'slack' };
  },
});
```

## Step 8: Test It

```bash
kernova dev
```

Try these in the chat:

1. **"Check the health of all services"**
   - Agent uses check-health tool

2. **"What are the current metrics?"**
   - Agent uses get-metrics tool

3. **"The API is slow, investigate"**
   - Agent checks health, reviews metrics, proposes a fix
   - If it wants to restart, it asks for approval first

4. **"Generate a status report"**
   - Agent compiles health + metrics into a report

## Architecture Overview

```
                    ┌─────────────────────────┐
                    │     DevOps Agent         │
                    │  (instructions + tools)  │
                    └────────────┬────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
    ┌─────▼─────┐        ┌──────▼──────┐       ┌──────▼──────┐
    │ Scheduled  │        │  Triggers   │       │  Channels   │
    │ (cron)     │        │  (events)   │       │  (webhook)  │
    ├────────────┤        ├─────────────┤       ├─────────────┤
    │ Health: */5│        │ alert.fired │       │ PagerDuty   │
    │ Report: 9am│        │ deploy.fail │       │ Slack       │
    │ Weekly: Sun│        └─────────────┘       └─────────────┘
    └────────────┘
          │
    ┌─────▼──────────────────────────────────┐
    │ Durable Workflow: Incident Response     │
    │ detect → investigate → fix → verify    │
    │         (approval gate here ↑)          │
    └────────────────────────────────────────┘
```

## What You Built

✅ Autonomous agent with scheduled health checks  
✅ Event-driven triggers (reacts to alerts)  
✅ Human-in-the-loop approvals (for risky actions)  
✅ Durable workflow (survives crashes)  
✅ Channel integration (webhooks)  
✅ Background tasks (notifications)  
✅ Budget controls (prevent runaway costs)  
✅ Permission scoping (agent can only do what's allowed)  

## Key Patterns Learned

1. **Schedule**: `{ cron: '*/5 * * * *', goal: '...' }` for periodic tasks
2. **Triggers**: React to events without polling
3. **Approval**: `requiresConfirmation: true` on tools + `requiresApproval: true` on workflow steps
4. **Channels**: External systems push messages to agents
5. **Durability**: Workflows checkpoint state and resume after crashes
6. **Budget**: Prevent agents from spending too much
7. **Permissions**: Declare what the agent is allowed to do
