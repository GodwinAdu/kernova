---
title: "Step 6: Deploy to Production"
description: "Deploy your autonomous DevOps agent to Kernova Cloud with environment variables, domains, and monitoring."
---

# Step 6: Deploy to Production

Your DevOps agent is complete. It has:

- ✅ An intelligent agent that diagnoses infrastructure problems
- ✅ Tools for health checks, metrics, and restarts
- ✅ Channels for webhooks (alerts, GitHub, Slack)
- ✅ Triggers that auto-react to events
- ✅ Durable workflows with approval gates

Time to deploy it to production so it runs 24/7.

---

## Step 1: Set Up Environment Variables

Create a `.env.local` file (for local development):

```bash
# Required: Your AI provider
OPENAI_API_KEY=sk-...

# Optional: Slack integration
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Optional: For Render API restarts
RENDER_API_KEY=rnd_...
```

These will also need to be added on Kernova Cloud.

---

## Step 2: Update the Config

Make sure `kernova.config.ts` is production-ready:

```typescript
import { defineConfig } from '@kernova/framework';

export default defineConfig({
  name: 'devops-agent',
  description: 'Autonomous DevOps agent for infrastructure monitoring and incident response',

  model: {
    provider: 'openai',
    name: 'gpt-4o',
    temperature: 0.3, // Low temperature for reliable ops decisions
  },

  deploy: {
    platform: 'kernova-cloud',
    region: 'us-east',
  },
});
```

---

## Step 3: Push to GitHub

If you haven't already, initialize git and push:

```bash
git init
git add .
git commit -m "feat: autonomous devops agent with workflows and triggers"
git remote add origin https://github.com/YOUR_USERNAME/devops-agent.git
git push -u origin main
```

---

## Step 4: Connect to Kernova Cloud

### Option A: Deploy from the CLI

```bash
# Login to Kernova Cloud
kernova login

# Deploy
kernova deploy
```

The CLI:
1. Pushes your code to the connected GitHub repo
2. Sends a deploy request to Kernova Cloud
3. Kernova Cloud creates a Render service
4. Render builds and starts your app
5. Your agent is live

### Option B: Deploy from the Dashboard

1. Go to [kernova-cloud.vercel.app](https://kernova-cloud.vercel.app)
2. Click **"Import Project"**
3. Select your `devops-agent` GitHub repo
4. Kernova Cloud auto-detects the framework and deploys

---

## Step 5: Add Environment Variables

In the Kernova Cloud dashboard:

1. Open your project → **Environment** tab
2. Add each variable:

| Key | Value | Description |
|---|---|---|
| `OPENAI_API_KEY` | `sk-...` | AI provider key |
| `SLACK_BOT_TOKEN` | `xoxb-...` | Slack bot token |
| `SLACK_SIGNING_SECRET` | `...` | Slack app signing secret |
| `RENDER_API_KEY` | `rnd_...` | Render API key (for restarts) |

3. Click **"Save & Redeploy"**

---

## Step 6: Set Up Webhook URLs

Once deployed, your app will be live at something like:

```
https://kn-devops-agent.onrender.com
```

Now configure your monitoring tools to send alerts to:

```
POST https://kn-devops-agent.onrender.com/hooks/alerts
```

And GitHub webhooks to:

```
POST https://kn-devops-agent.onrender.com/hooks/github
```

### UptimeRobot Example

1. Go to UptimeRobot → Alert Contacts → Add Contact
2. Type: Webhook
3. URL: `https://kn-devops-agent.onrender.com/hooks/alerts`
4. POST body:
   ```json
   {
     "source": "uptimerobot",
     "severity": "critical",
     "service": "*monitorFriendlyName*",
     "message": "*alertDetails*"
   }
   ```

### GitHub Webhook Setup

1. Go to your repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://kn-devops-agent.onrender.com/hooks/github`
3. Content type: `application/json`
4. Select events: Push, Releases, Deployment status

---

## Step 7: Set Up a Custom Domain (Optional)

In the Kernova Cloud dashboard:

1. Open your project → **Domains** tab
2. Add: `devops.yourdomain.com`
3. Add the CNAME record to your DNS:
   ```
   devops.yourdomain.com → kn-devops-agent.onrender.com
   ```

---

## Step 8: Monitor in Production

### Check Agent Status

In the dashboard, go to **Agents** tab:

```
┌────────────────────────────────────────────┐
│ 🤖 devops                                  │
│                                            │
│ Status: ● Online                           │
│ Model: gpt-4o                              │
│ Uptime: 3 days, 14 hours                  │
│ Actions today: 47                          │
│                                            │
│ Active Workflows:                          │
│   incident-response — Step 4 (awaiting)    │
│   daily-audit — Completed 2h ago           │
│                                            │
│ Recent Triggers:                           │
│   on-critical-alert — fired 15 min ago     │
│   scheduled-health-check — fired 2 min ago │
└────────────────────────────────────────────┘
```

### Check Workflow History

In the **Workflows** tab:

```
┌────────────────────────────────────────────────────────────┐
│ Workflow Runs                                               │
│                                                            │
│ incident-response  10:30 AM  ✓ Completed (5/5 steps)      │
│ incident-response  09:15 AM  ✗ Denied at step 4           │
│ daily-audit        06:00 AM  ✓ Completed (2/2 steps)      │
│ incident-response  Yesterday  ✓ Completed (5/5 steps)      │
└────────────────────────────────────────────────────────────┘
```

### View Logs

In the **Logs** tab, you'll see real-time output:

```
10:30:02 [Channel: alerts] Received alert from uptime-monitor
10:30:02 [Trigger: on-critical-alert] Firing for api-gateway
10:30:03 [Workflow: incident-response] Starting step: detect
10:30:04 [Tool: check-health] api-gateway → unhealthy (503)
10:30:04 [Workflow] Step "detect" completed. Checkpointed.
10:30:05 [Workflow: incident-response] Starting step: diagnose
10:30:06 [Tool: get-metrics] Memory: 94%, Uptime: 7 days
10:30:06 [Workflow] Step "diagnose" completed. Checkpointed.
10:30:07 [Workflow: incident-response] Starting step: notify
10:30:07 [Slack] Sent to #incidents
10:30:07 [Workflow] Step "fix" — AWAITING APPROVAL
```

---

## Complete Project Structure (Final)

```
devops-agent/
├── agents/
│   ├── devops.ts                         # Main agent definition
│   ├── tools/
│   │   ├── check-health.ts              # Health check tool
│   │   ├── get-metrics.ts               # Metrics tool
│   │   └── restart-service.ts           # Restart tool (requires approval)
│   ├── channels/
│   │   ├── alerts.ts                    # Webhook for monitoring alerts
│   │   ├── github.ts                    # GitHub webhook events
│   │   └── slack.ts                     # Slack two-way communication
│   ├── triggers/
│   │   ├── on-alert.ts                  # Auto-investigate critical alerts
│   │   ├── on-deploy.ts                 # Post-deploy health checks
│   │   └── scheduled-check.ts          # Every 5 minutes health scan
│   └── workflows/
│       ├── incident-response.ts         # Full incident pipeline (5 steps)
│       └── daily-audit.ts               # Scheduled daily report
├── app/
│   ├── page.tsx                         # Dashboard UI
│   └── layout.tsx                       # Next.js layout
├── .env.local                           # Local environment variables
├── kernova.config.ts                    # Framework configuration
├── package.json
└── tsconfig.json
```

---

## What You Built

Let's recap the entire system:

| Layer | What You Built | How It Works |
|---|---|---|
| **Agent** | DevOps personality with system prompt | Understands infrastructure, thinks like an SRE |
| **Tools** | health check, metrics, restart | Agent calls these to interact with infra |
| **Channels** | Webhooks (alerts, GitHub), Slack | External systems send events INTO the agent |
| **Triggers** | Critical alerts, post-deploy, schedule | Rules that auto-wake the agent |
| **Workflows** | Incident response, daily audit | Multi-step durable pipelines with approval |
| **Approval** | Human-in-the-loop on restart | Dangerous actions require human sign-off |
| **Deploy** | Kernova Cloud + Render | Runs 24/7 in production |

---

## What's Different from a Basic Chatbot

| Feature | Basic Chatbot | Your DevOps Agent |
|---|---|---|
| Input | Only responds to chat | Reacts to webhooks, schedules, events |
| Safety | No guardrails | Approval gates on dangerous actions |
| Reliability | Loses state on crash | Durable execution with checkpointing |
| Multi-step | Single turn | Workflows with multiple steps |
| Integration | None | Slack, GitHub, monitoring tools |
| Deployment | Manual | One-command deploy with CI/CD |

---

## Next Steps

Now that you've mastered the advanced features, here are ideas to extend your agent:

1. **Add more tools:** Scale up/down instances, roll back deployments, manage DNS
2. **Add more channels:** PagerDuty, Discord, Telegram, email
3. **Add more workflows:** Deployment pipeline, security scan, cost optimization
4. **Add memory:** Track incident history, learn from past issues
5. **Multi-agent:** Create a "security" agent and a "performance" agent that collaborate

---

## Congratulations! 🎉

You've built a production-grade autonomous DevOps agent using the full power of the Kernova framework:

- `defineAgent` — the brain
- `defineTool` — the hands
- `defineChannel` — the ears
- `defineTrigger` — the reflexes
- `defineWorkflow` — the long-term memory and planning
- `requiresApproval` — the safety net

This is what separates a toy chatbot from a real AI agent that runs in production. Ship it.

---

## Full Tutorial Navigation

1. [Introduction](/framework/tutorials/devops/01-intro)
2. [Project Setup](/framework/tutorials/devops/02-setup)
3. [Define the Agent](/framework/tutorials/devops/03-agent)
4. [Build the Tools](/framework/tutorials/devops/04-tools)
5. [Triggers & Channels](/framework/tutorials/devops/05-triggers)
6. [Durable Workflows](/framework/tutorials/devops/06-workflow)
7. **Deploy to Production** (you are here)
