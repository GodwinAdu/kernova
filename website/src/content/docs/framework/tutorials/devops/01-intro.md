---
title: "DevOps Agent — Introduction"
description: "Build an autonomous agent that monitors infrastructure and responds to incidents."
---

# Build an Autonomous DevOps Agent

**Difficulty:** Advanced  
**Time:** 45-60 minutes  
**Prerequisites:** Complete the Personal Assistant and Research Pipeline tutorials

## What We're Building

An AI agent that operates **autonomously** — it doesn't wait for users to ask questions. It:

- **Monitors** your infrastructure on a schedule (every 5 minutes)
- **Reacts** to alerts from PagerDuty/Slack via webhooks
- **Investigates** incidents using tools (check health, read metrics)
- **Proposes** fixes with risk assessments
- **Waits for approval** before executing risky actions
- **Executes** fixes and verifies they worked
- **Documents** everything in a durable workflow that survives crashes

This is the most complex tutorial — it uses nearly every Kernova feature.

## Concepts You'll Use

| Feature | What It Does Here |
|---------|------------------|
| `defineAgent` | The main DevOps agent with instructions |
| `defineTool` | Health checks, metrics, service restart |
| `schedule` | Run checks every 5 minutes, daily reports |
| `triggers` | React to alert events automatically |
| `defineChannel` | Receive PagerDuty/Slack webhooks |
| `defineWorkflow` | Multi-step incident response with checkpoints |
| `requiresApproval` | Human must approve before restarting services |
| `budget` | Prevent the agent from running too many times |
| `permissions` | What the agent is allowed to do |

## Why This Matters

Most monitoring tools alert you. Most chatbots answer questions. But an **autonomous DevOps agent** does both — it monitors, alerts, investigates, and fixes. It turns 3am pages into "I fixed it, here's the report" messages.

The key innovation: **human-in-the-loop for safety**. The agent can investigate freely, but it must ask before executing dangerous actions.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                DevOps Agent                           │
│  instructions + tools + permissions                  │
└──────┬───────────────┬──────────────────┬───────────┘
       │               │                  │
  ┌────▼────┐   ┌─────▼─────┐    ┌──────▼──────┐
  │Schedule │   │ Triggers  │    │  Channels   │
  │(cron)   │   │ (events)  │    │ (webhooks)  │
  │         │   │           │    │             │
  │• */5 min│   │• alert    │    │• PagerDuty  │
  │• 9am    │   │• deploy   │    │• Slack      │
  │• Weekly │   │  failed   │    │             │
  └────┬────┘   └─────┬─────┘    └──────┬──────┘
       │               │                  │
       └───────────────┼──────────────────┘
                       │
              ┌────────▼────────┐
              │ Durable Workflow │
              │ (incident flow)  │
              ├─────────────────┤
              │ 1. Detect       │
              │ 2. Investigate  │
              │ 3. Propose fix  │
              │ 4. ⚠️ APPROVE   │ ← Human reviews here
              │ 5. Execute fix  │
              │ 6. Verify       │
              │ 7. Document     │
              └─────────────────┘
```

## Let's Start

[Continue to Step 1: Project Setup →](/framework/tutorials/devops/02-setup)
