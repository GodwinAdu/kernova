---
title: "DevOps Automation Agent"
description: Autonomous infrastructure monitoring with scheduled health checks, auto-remediation, and Slack alerts.
---

An autonomous DevOps agent that monitors infrastructure health, detects failures, attempts automatic remediation, and alerts your team via Slack. It runs health checks every 5 minutes, tracks metrics in a background loop, queues remediation tasks in priority order, and learns from past incidents.

---

## Project Structure

```
devops-automation/
├── src/
│   └── index.ts          # Main application entry point
├── package.json
├── tsconfig.json
└── .env
```

---

## Setup

```bash
mkdir devops-automation && cd devops-automation
npm init -y
npm install @kernova/sdk @kernova/core
npm install -D typescript @types/node
npx tsc --init
```

### Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../xxx
MONITOR_TARGETS=https://api.myapp.com/health,https://dashboard.myapp.com/ping
DISK_THRESHOLD_PERCENT=85
MEMORY_THRESHOLD_PERCENT=90
```

---

## Full Source Code

```typescript
// src/index.ts
import { Kernova } from '@kernova/sdk';

// ─── Configuration ──────────────────────────────────────────────
const TARGETS = (process.env.MONITOR_TARGETS || 'http://localhost:3000/health').split(',');
const DISK_THRESHOLD = Number(process.env.DISK_THRESHOLD_PERCENT) || 85;
const MEMORY_THRESHOLD = Number(process.env.MEMORY_THRESHOLD_PERCENT) || 90;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

async function main() {
  // ─── 1. Initialize Kernova with shell and HTTP tools ──────────
  const app = await Kernova.create({
    env: 'production',
    dataDir: './devops-data',
    builtInTools: {
      enabled: ['shell-exec', 'http-fetch', 'date-time'],
      shellTimeout: 30_000,
    },
  });

  // ─── 2. Define the monitoring agent ───────────────────────────
  app.agent('infra-monitor', {
    instructions: `You are an infrastructure monitoring agent.
Your responsibilities:
- Run health checks against configured endpoints
- Analyze system metrics (disk, memory, CPU)
- Determine if services are healthy, degraded, or down
- Report findings in structured JSON format

When reporting status, use this format:
{ "service": "name", "status": "healthy|degraded|down", "details": "..." }

Be precise. Never guess — only report what you can verify.`,
    description: 'Infrastructure health monitoring agent',
    tools: ['shell-exec', 'http-fetch'],
  });

  // ─── 3. Define the remediation agent ──────────────────────────
  app.agent('auto-remediator', {
    instructions: `You are an auto-remediation agent for infrastructure issues.
You receive alerts about failing services and attempt safe, reversible fixes:

Safe actions (proceed automatically):
- Restart a Docker container or systemd service
- Clear disk caches (apt clean, docker prune, log rotation)
- Kill runaway processes consuming excessive memory
- Flush DNS cache
- Restart nginx/caddy after config validation

Unsafe actions (report but DO NOT execute):
- Deleting data files or databases
- Modifying firewall rules
- Scaling infrastructure (needs human approval)
- Changing environment variables in production

Always log what you did and verify the fix worked after remediation.`,
    description: 'Automated remediation for common infrastructure failures',
    tools: ['shell-exec', 'http-fetch'],
  });

  // ─── 4. Slack notification tool ───────────────────────────────
  app.tool('slack-alert', {
    description: 'Send an alert message to the ops Slack channel',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Alert message text' },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
        service: { type: 'string', description: 'Affected service name' },
      },
    },
    execute: async (params) => {
      const { message, severity, service } = params as Record<string, string>;
      const emoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';

      if (!SLACK_WEBHOOK) {
        console.log(`[SLACK ${severity.toUpperCase()}] ${emoji} [${service}] ${message}`);
        return { sent: false, reason: 'No SLACK_WEBHOOK_URL configured' };
      }

      const payload = {
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *${severity.toUpperCase()}* — \`${service}\`\n${message}`,
            },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `_${new Date().toISOString()}_` }],
          },
        ],
      };

      const response = await fetch(SLACK_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      return { sent: response.ok, status: response.status };
    },
  });

  // ─── 5. Scheduled health checks (every 5 minutes) ────────────
  app.schedule('health-check', '*/5 * * * *', async () => {
    console.log(`[HEALTH CHECK] Running checks against ${TARGETS.length} targets...`);

    for (const target of TARGETS) {
      const { answer } = await app.ask(
        `Perform a health check on ${target}. 
         Use http-fetch to GET the endpoint. 
         Report the HTTP status code, response time, and whether the service is healthy.
         If it fails or returns non-200, report it as degraded or down.`,
        { type: 'action', priority: 'high' },
      );

      // Check if the response indicates a problem
      const isDown = answer.toLowerCase().includes('down') ||
                     answer.toLowerCase().includes('failed') ||
                     answer.toLowerCase().includes('unreachable');
      const isDegraded = answer.toLowerCase().includes('degraded') ||
                         answer.toLowerCase().includes('slow') ||
                         answer.toLowerCase().includes('timeout');

      if (isDown || isDegraded) {
        const severity = isDown ? 'critical' : 'warning';

        // Store the incident in memory for pattern analysis
        await app.remember(
          `Incident: ${target} reported ${isDown ? 'DOWN' : 'DEGRADED'} at ${new Date().toISOString()}. Details: ${answer}`,
          'session',
          ['incident', target],
        );

        // Queue a remediation task
        await app.enqueue('remediate', {
          target,
          severity,
          diagnosis: answer,
        }, { priority: isDown ? 'critical' : 'high' });
      }
    }
  });

  // ─── 6. System metrics background loop ────────────────────────
  // Runs continuously, checking disk and memory every 60 seconds
  const kernel = app.getKernel();
  kernel.loops.register({
    name: 'system-metrics',
    intervalMs: 60_000,
    handler: async () => {
      const { answer } = await app.ask(
        `Check system resource usage using shell-exec:
         1. Run "df -h /" to check disk usage
         2. Run "free -m" to check memory usage
         
         Report: disk_percent, memory_percent, and whether either exceeds thresholds:
         - Disk threshold: ${DISK_THRESHOLD}%
         - Memory threshold: ${MEMORY_THRESHOLD}%
         
         Format your response as: DISK=xx% MEMORY=xx% STATUS=ok|warning|critical`,
        { type: 'action', priority: 'medium' },
      );

      // Parse metrics from agent response
      const diskMatch = answer.match(/DISK=(\d+)%/);
      const memMatch = answer.match(/MEMORY=(\d+)%/);

      if (diskMatch && Number(diskMatch[1]) > DISK_THRESHOLD) {
        await app.enqueue('remediate', {
          target: 'disk-space',
          severity: 'warning',
          diagnosis: `Disk usage at ${diskMatch[1]}% (threshold: ${DISK_THRESHOLD}%)`,
        }, { priority: 'high' });
      }

      if (memMatch && Number(memMatch[1]) > MEMORY_THRESHOLD) {
        await app.enqueue('remediate', {
          target: 'memory-pressure',
          severity: 'critical',
          diagnosis: `Memory usage at ${memMatch[1]}% (threshold: ${MEMORY_THRESHOLD}%)`,
        }, { priority: 'critical' });
      }
    },
  });

  // ─── 7. Trigger: fire Slack alert on any intent failure ───────
  app.trigger('alert-on-failure', 'intent.failed', {
    goal: `An infrastructure operation failed. Use the slack-alert tool to notify the ops team with severity "critical". Include the error details and which service was affected.`,
    priority: 'critical',
    cooldownMs: 120_000, // 2 minute cooldown to prevent alert storms
  });

  // ─── 8. Task queue: ordered remediation steps ─────────────────
  // Tasks enqueued in steps 5 and 6 are processed here in priority order.
  // The task queue ensures remediation actions don't overlap.
  kernel.taskQueue.registerHandler('remediate', async (task) => {
    const { target, severity, diagnosis } = task.payload as Record<string, string>;
    console.log(`[REMEDIATION] Processing: ${target} (${severity})`);

    // Ask the remediator agent to fix it
    const { answer, success } = await app.ask(
      `Infrastructure issue detected:
       Target: ${target}
       Severity: ${severity}
       Diagnosis: ${diagnosis}
       
       Recall any previous incidents for this target from memory.
       Attempt safe auto-remediation. After remediation, verify the fix worked.
       Report what you did and whether the service is now healthy.`,
      { type: 'action', priority: 'high' },
    );

    // Alert the team about what happened
    await app.ask(
      `Use slack-alert to notify the team:
       Service: ${target}
       Severity: ${severity}
       Remediation ${success ? 'succeeded' : 'failed'}: ${answer.slice(0, 200)}`,
      { type: 'action', priority: 'medium' },
    );

    // Remember what worked (or didn't) for future reference
    await app.remember(
      `Remediation for ${target}: ${success ? 'SUCCESS' : 'FAILED'}. Action taken: ${answer.slice(0, 300)}`,
      'longterm',
      ['remediation', target, success ? 'success' : 'failure'],
    );
  });

  // ─── 9. Scheduled weekly incident review ──────────────────────
  app.schedule('weekly-review', '0 10 * * 1', async () => {
    // Every Monday at 10 AM
    const incidents = await app.recall('incident', { layer: 'session', limit: 50 });
    const remediations = await app.recall('remediation', { layer: 'longterm', limit: 20 });

    const { answer } = await app.ask(
      `Generate a weekly infrastructure report based on recent incidents and remediations.
       
       Recent incidents (${incidents.length}):
       ${incidents.map(i => i.content).join('\n')}
       
       Remediation history (${remediations.length}):
       ${remediations.map(r => r.content).join('\n')}
       
       Provide:
       1. Total incidents this week
       2. Most common failure modes
       3. Remediation success rate
       4. Recommendations for preventing recurring issues`,
      { type: 'query', priority: 'low' },
    );

    console.log(`[WEEKLY REVIEW]\n${answer}`);
  });

  // ─── 10. Start the daemon ─────────────────────────────────────
  console.log('🔧 DevOps Automation Agent starting...');
  console.log(`   Monitoring ${TARGETS.length} targets every 5 minutes`);
  console.log('   System metrics checked every 60 seconds');
  console.log('   Slack alerts enabled:', !!SLACK_WEBHOOK);
  console.log('   Auto-remediation task queue active');

  await app.serve({
    shutdownTimeoutMs: 15_000,
    heartbeatIntervalMs: 30_000,
  });
}

main().catch(console.error);
```

---

## Testing It

Simulate a failing endpoint:

```bash
# Start a mock server that returns 500
npx http-echo-server --status 500 --port 3000 &

# Set the target and run
MONITOR_TARGETS=http://localhost:3000/health npx tsx src/index.ts
```

The agent will detect the failure, queue a remediation task, and send a Slack alert (or log it if no webhook is configured).

---

## What This Demonstrates

| Feature | Guide |
|---------|-------|
| Scheduled recurring tasks (cron) | [Scheduler](/guides/scheduler-queue-triggers) |
| Background loops for continuous monitoring | [Background Loops](/guides/background-loops) |
| Task queue for ordered remediation | [Task Queue](/guides/scheduler-queue-triggers) |
| Proactive triggers on failures | [Triggers](/guides/scheduler-queue-triggers) |
| Built-in tools (shell-exec, http-fetch) | [Built-in Tools](/concepts/tools) |
| Custom tool (Slack alerts) | [Tools](/concepts/tools) |
| Long-term memory for incident patterns | [Context & Memory](/guides/context-memory) |
| Multi-agent (monitor + remediator) | [Building Agents](/guides/agents) |
| Daemon mode | [Daemon Mode](/guides/daemon) |
