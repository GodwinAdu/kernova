---
title: "Step 1: Project Setup"
description: "Create the project structure for an autonomous agent."
---

# Step 1: Project Setup

## Create the Project

```bash
npx create-kernova-app devops-agent
cd devops-agent
```

Add your API key:
```
OPENAI_API_KEY=sk-proj-your-key
```

## Create the File Structure

We need more directories than a simple project:

```bash
mkdir triggers
mkdir channels
mkdir workflows
mkdir tasks
```

Your final structure:
```
devops-agent/
├── agents/
│   └── devops.agent.ts       ← Main agent (schedule, triggers, permissions)
├── agents/tools/
│   ├── check-health.ts       ← Hit /health endpoints
│   ├── get-metrics.ts        ← Read CPU/memory/requests
│   ├── restart-service.ts    ← Restart (requires approval!)
│   └── web-search.ts         ← Default web search
├── triggers/
│   └── on-alert.ts           ← React to infrastructure alerts
├── channels/
│   └── webhook.ts            ← Receive external webhooks
├── workflows/
│   └── incident-response.ts  ← Multi-step durable workflow
├── tasks/
│   └── send-notification.ts  ← Background notification task
├── memory/
│   └── incidents.ts          ← Remember past incidents
├── app/
│   └── chat/page.tsx         ← Dashboard/chat interface
└── kernova.config.ts
```

## Delete the Default Agent

```bash
rm agents/assistant.agent.ts
```

## Understanding This Architecture

This project is different from the previous tutorials:

| Previous tutorials | This tutorial |
|---|---|
| Agent waits for user messages | Agent acts on its own (schedule + triggers) |
| Single interaction model | Continuous monitoring model |
| No approval needed | Dangerous actions need human approval |
| Simple request → response | Multi-step durable workflows |

The DevOps agent is **always running**. It checks health every 5 minutes, generates reports at 9am, and responds to alerts instantly — without anyone typing a message.

## Key Concept: Autonomous vs Reactive

Most AI agents are **reactive** — they respond when you ask. This agent is **autonomous** — it acts on its own based on:

1. **Schedules** — "Check health every 5 minutes"
2. **Triggers** — "When an alert fires, investigate"
3. **Channels** — "When a webhook arrives, process it"

The user still can chat with it (to ask questions or approve actions), but the agent doesn't need the user to initiate work.

---

[Continue to Step 2: Define the Agent →](/framework/tutorials/devops/03-agent)
