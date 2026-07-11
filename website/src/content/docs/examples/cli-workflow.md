---
title: "CLI Workflow"
description: Build, develop, and deploy a Kernova project using the CLI — from init to production.
---

This example walks through the entire CLI-based developer experience. Follow along to see every command in action — from installing the CLI to deploying in production.

## Prerequisites

Kernova runs on Node.js. You need:

- **Node.js 20+** — [download from nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)

Verify your setup:

```bash
node --version   # v20.0.0 or higher
npm --version    # 10.0.0 or higher
```

## Install the Kernova CLI

Kernova is distributed as an npm package. Install it globally so the `kernova` command is available system-wide:

```bash
npm install -g @kernova/cli
```

Verify the installation:

```bash
kernova --version
# kernova v0.1.1
```

Alternatively, use `npx` to run without a global install:

```bash
npx @kernova/cli init my-app
npx @kernova/cli dev
```

---

## 1. Create a new project

```bash
kernova init my-support-bot
```

```
 ╭─────────────────────────────────────╮
 │                                     │
 │   ◆ Kernova — Project Scaffolder    │
 │                                     │
 ╰─────────────────────────────────────╯

 ✔ Creating project directory...
 ✔ Generating agent config...
 ✔ Setting up data directory...
 ✔ Writing package.json...

 Project created at ./my-support-bot

   my-support-bot/
   ├── agents/
   │   └── main.agent.yaml
   ├── kernova-data/
   │   └── kernova.db
   ├── tools/
   ├── package.json
   └── kernova.config.ts

 Next steps:
   cd my-support-bot
   kernova dev
```

## 2. Explore the generated project

**`kernova.config.ts`** — project-level configuration:

```ts
import { defineConfig } from "kernova";

export default defineConfig({
  dataDir: "./kernova-data",
  model: "gpt-4o",
  tools: ["http-fetch", "date-time"],
});
```

**`agents/main.agent.yaml`** — the default agent:

```yaml
name: main
instructions: |
  You are a helpful support bot.
  Answer user questions clearly and concisely.
model: gpt-4o
tools:
  - http-fetch
  - date-time
```

**`package.json`** — dependencies and scripts:

```json
{
  "name": "my-support-bot",
  "private": true,
  "scripts": {
    "dev": "kernova dev",
    "start": "kernova serve"
  },
  "dependencies": {
    "kernova": "^0.1.0"
  }
}
```

## 3. Create agents

```bash
kernova agent create escalation-handler
```

```
 ✔ Created agents/escalation-handler.agent.yaml

 Agent "escalation-handler" is ready.
 Edit the file to customize instructions, tools, and triggers.
```

```bash
kernova agent create feedback-collector
```

```
 ✔ Created agents/feedback-collector.agent.yaml

 Agent "feedback-collector" is ready.
 Edit the file to customize instructions, tools, and triggers.
```

```bash
kernova agent list
```

```
 Agents (3)
 ──────────────────────────────────────
 NAME                   STATUS    MODEL
 main                   active    gpt-4o
 escalation-handler     active    gpt-4o
 feedback-collector     active    gpt-4o
 ──────────────────────────────────────
```

## 4. Run in development mode

```bash
kernova dev
```

```
 ╭──────────────────────────────────────╮
 │                                      │
 │   ◆ Kernova Dev Server               │
 │   Runtime:  local                    │
 │   Agents:   3 loaded                 │
 │   Data:     ./kernova-data           │
 │   Watching: agents/, tools/          │
 │                                      │
 ╰──────────────────────────────────────╯

 [09:14:01] ✔ Kernel booted — 3 agents, 2 tools registered
 [09:14:01] ✔ Scheduler started (1 job queued)
 [09:14:01] ✔ Trigger engine listening
 [09:14:01] ◆ Ready — press q to quit, r to reload
```

Edit `agents/escalation-handler.agent.yaml` and save — hot-reload kicks in:

```
 [09:14:38] ↻ File changed: agents/escalation-handler.agent.yaml
 [09:14:38] ✔ Agent "escalation-handler" reloaded
```

## 5. Manage scheduled jobs

```bash
kernova schedule list
```

```
 Scheduled Jobs (2)
 ──────────────────────────────────────────────────────────────────
 ID            AGENT                CRON           NEXT RUN           STATUS
 job_abc123    main                 0 9 * * *      2025-07-11 09:00   enabled
 job_def456    feedback-collector   0 18 * * 5     2025-07-11 18:00   enabled
 ──────────────────────────────────────────────────────────────────
```

```bash
kernova schedule disable job_abc123
```

```
 ✔ Disabled schedule "job_abc123" (agent: main)
```

```bash
kernova schedule enable job_abc123
```

```
 ✔ Enabled schedule "job_abc123" (agent: main)
   Next run: 2025-07-12 09:00
```

## 6. Monitor the task queue

```bash
kernova queue status
```

```
 Task Queue
 ──────────────────────────────────────────────────────────────────
 Pending:     0
 Processing:  1
 Completed:   47
 Dead Letter:  2
 ──────────────────────────────────────────────────────────────────

 Dead Letter Queue (2)
 ID            AGENT                FAILED AT            REASON
 dl_abc123     escalation-handler   2025-07-10 14:22     Tool timeout (http-fetch)
 dl_def789     main                 2025-07-10 16:05     Model rate limited
 ──────────────────────────────────────────────────────────────────
```

```bash
kernova queue replay dl_abc123
```

```
 ✔ Replaying task dl_abc123...
 ✔ Task requeued as task_gh1011 (pending)
```

## 7. Inspect trigger rules

```bash
kernova triggers list
```

```
 Trigger Rules (2)
 ──────────────────────────────────────────────────────────────────
 ID           AGENT                  EVENT              STATUS
 trig_xyz     escalation-handler     intent.failed      enabled
 trig_abc     feedback-collector     session.ended      enabled
 ──────────────────────────────────────────────────────────────────
```

```bash
kernova triggers disable trig_xyz
```

```
 ✔ Disabled trigger "trig_xyz" (event: intent.failed)
```

```bash
kernova triggers enable trig_xyz
```

```
 ✔ Enabled trigger "trig_xyz" (event: intent.failed)
```

## 8. Check system status

```bash
kernova status
```

```
 ╭──────────────────────────────────────╮
 │   ◆ Kernova Status                   │
 ╰──────────────────────────────────────╯

 Runtime
 ──────────────────────────────────────
 Version:     0.1.0
 Mode:        development
 Uptime:      2h 14m
 Data Dir:    ./kernova-data
 DB Size:     1.2 MB

 Agents
 ──────────────────────────────────────
 Loaded:      3
 Active:      3
 Errored:     0

 Scheduler
 ──────────────────────────────────────
 Jobs:        2 (2 enabled)
 Next Run:    2025-07-11 09:00 (job_abc123)

 Task Queue
 ──────────────────────────────────────
 Pending:     0
 Processing:  0
 Completed:   47
 Dead Letter: 2

 Triggers
 ──────────────────────────────────────
 Rules:       2 (2 enabled)
 Fired (24h): 12
```

## 9. Start daemon mode with agent configs

Create a production-ready agent configuration:

```bash
cat > agents/support-bot.agent.yaml << 'EOF'
name: support-bot
instructions: |
  You are a customer support agent.
  Handle billing and account questions.
model: gpt-4o
tools:
  - http-fetch
  - date-time
schedules:
  - name: daily-summary
    cron: "0 9 * * *"
    goal: "Generate daily support summary"
triggers:
  - name: on-escalation
    event: "intent.failed"
    goal: "Escalate unresolved issue to human"
EOF
```

Start the daemon with file watching:

```bash
kernova serve --config ./agents/ --watch
```

```
 ╭──────────────────────────────────────╮
 │                                      │
 │   ◆ Kernova Daemon                   │
 │   Mode:     serve (watched)          │
 │   Config:   ./agents/                │
 │   Agents:   4 loaded                 │
 │   PID:      48291                    │
 │                                      │
 ╰──────────────────────────────────────╯

 [10:30:00] ✔ Kernel booted — 4 agents, 2 tools
 [10:30:00] ✔ Scheduler: 3 jobs registered
 [10:30:00] ✔ Triggers: 3 rules active
 [10:30:00] ✔ Watching ./agents/ for changes
 [10:30:00] ◆ Daemon ready
```

## 10. Deploy to production

```bash
kernova deploy docker
```

```
 ✔ Generating Dockerfile...
 ✔ Generating .dockerignore...
 ✔ Writing docker-compose.yml...

 Generated files:
   Dockerfile
   .dockerignore
   docker-compose.yml

 ── Dockerfile ──────────────────────────
 FROM node:20-slim AS base
 WORKDIR /app
 COPY package*.json ./
 RUN npm ci --omit=dev
 COPY . .
 ENV NODE_ENV=production
 ENV KERNOVA_DATA_DIR=/var/lib/kernova
 EXPOSE 3000
 CMD ["npx", "kernova", "serve", "--config", "./agents/"]
 ─────────────────────────────────────────

 Next steps:
   docker compose up -d
   docker compose logs -f
```

## 11. Production monitoring

Once deployed, inspect the running system using `--data-dir` to point at the production data location:

```bash
kernova status --data-dir /var/lib/kernova
```

```
 ╭──────────────────────────────────────╮
 │   ◆ Kernova Status (production)      │
 ╰──────────────────────────────────────╯

 Runtime
 ──────────────────────────────────────
 Version:     0.1.0
 Mode:        production
 Uptime:      14d 6h 32m
 Data Dir:    /var/lib/kernova
 DB Size:     48.7 MB

 Agents:      4 loaded, 4 active
 Scheduler:   3 jobs (3 enabled)
 Queue:       0 pending, 1,284 completed, 3 dead letter
 Triggers:    3 rules, 892 fired (24h)
```

```bash
kernova schedule list --data-dir /var/lib/kernova
```

```
 Scheduled Jobs (3)
 ──────────────────────────────────────────────────────────────────
 ID            AGENT            CRON           NEXT RUN           STATUS
 job_p001      support-bot      0 9 * * *      2025-07-12 09:00   enabled
 job_p002      main             0 9 * * *      2025-07-12 09:00   enabled
 job_p003      feedback-coll.   0 18 * * 5     2025-07-11 18:00   enabled
 ──────────────────────────────────────────────────────────────────
```

```bash
kernova queue status --data-dir /var/lib/kernova
```

```
 Task Queue
 ──────────────────────────────────────────────────────────────────
 Pending:      0
 Processing:   2
 Completed:    1,284
 Dead Letter:  3
 ──────────────────────────────────────────────────────────────────
```

```bash
kernova triggers list --data-dir /var/lib/kernova
```

```
 Trigger Rules (3)
 ──────────────────────────────────────────────────────────────────
 ID           AGENT                  EVENT              STATUS
 trig_p01     escalation-handler     intent.failed      enabled
 trig_p02     feedback-collector     session.ended      enabled
 trig_p03     support-bot            intent.failed      enabled
 ──────────────────────────────────────────────────────────────────
```

---

That's the full lifecycle — from `kernova init` to production monitoring. Every subsystem (agents, schedules, queues, triggers) is manageable through a single CLI surface.
