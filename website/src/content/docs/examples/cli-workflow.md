---
title: "CLI Workflow"
description: Build, develop, and run a Kernova core project with the CLI — from init to production.
---

This example walks through the CLI with a core project (`@kernova/core`, created by `kernova init`). For full-stack apps with a frontend, start with `npx create-kernova-app` instead and see the [framework CLI reference](/framework/cli-reference).

## Prerequisites

- **Node.js 22+** — [download from nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)
- An API key for a model provider (for example `OPENAI_API_KEY`), or a local model server

```bash
node --version   # v22.0.0 or higher
```

## Install the Kernova CLI

```bash
npm install -g @kernova/cli
kernova --version
# kernova v1.2.0
```

Or run it without installing: `npx @kernova/cli <command>`.

---

## 1. Create a project

```bash
kernova init my-support-bot
```

```
  → Creating Kernova project: my-support-bot
  → Created .agent.yaml — starter agent configuration
  ✓ Project created at ./my-support-bot

  → Next steps:
    cd my-support-bot
    npm install
    kernova dev
```

## 2. Explore the generated project

```
my-support-bot/
├── .agent.yaml            # starter agent config file (used by `kernova serve`)
├── kernova.config.json    # project name, environment, default model
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts            # starts a kernel, registers the agent, submits an intent
    └── agents/
        └── assistant.ts   # defineAgent() example
```

**`src/main.ts`** registers the agent and runs one intent:

```ts
import { KernovaKernel } from '@kernova/core';
import assistant from './agents/assistant.js';

const kernel = new KernovaKernel({ environment: 'development', debug: true });
kernel.agentRegistry.register(assistant.definition, assistant.executor);
await kernel.start();

const result = await kernel.submit({ goal: 'Hello, Kernova!', intentType: 'query', priority: 'medium' });
console.log('Result:', result.result?.summary);
await kernel.stop();
```

**`.agent.yaml`** is a declarative agent with a schedule:

```yaml
name: my-assistant
instructions: |
  You are a helpful assistant powered by Kernova.
  Help users with their tasks and answer questions clearly.
# model: gpt-4o   # optional; default: the model of the first provider with an API key
tools:
  - http-fetch
  - date-time
schedules:
  - name: hourly-check
    cron: "0 * * * *"
    goal: "Check for pending tasks and process them"
```

Install and run the entry point:

```bash
npm install
npm run dev
# Kernova runtime started.
# Result: Processed: Hello, Kernova!
```

## 3. Create agents

```bash
kernova agent create escalation-handler
#  ✓ Agent "escalation-handler" created at src/agents/escalation-handler.ts

kernova agent list
#   Registered Agents:
#   ──────────────────
#     ◆ assistant
#     ◆ escalation-handler
```

Register new agents in `src/main.ts` the same way as `assistant`.

## 4. Run in development mode

`kernova dev` loads the agents in `src/agents/`, reloads them when files change, and starts the development dashboard:

```
  → Starting legacy kernova runtime for "my-support-bot"...
  ✓ Agent 'assistant' loaded (178ms)
  ✓ Agent 'escalation-handler' loaded (4ms)
  → Watching: src/agents
  → Studio: http://localhost:4200

  ✓ kernova runtime is running
    Agents:  2
```

## 5. Run agent config files with the daemon

Agent config files (`*.agent.yaml`, `*.agent.yml`, `*.agent.json`) describe agents, schedules, and triggers without code:

```bash
mkdir -p agents
cat > agents/support-bot.agent.yaml << 'EOF'
name: support-bot
instructions: |
  You are a customer support agent.
  Handle billing and account questions.
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

kernova serve --config ./agents/ --watch
```

```
  → Starting kernova daemon...
  → Config: ./agents/
  → Watch mode: enabled
  ✓ Daemon is running. Press Ctrl+C to stop.
```

With `--watch`, edits to the files are picked up without a restart. Add `--port 3000` to also serve the [HTTP gateway](/guides/gateway-api) (it needs `KERNOVA_API_KEY`), which [Studio](/guides/studio) connects to.

## 6. Manage scheduled jobs

```bash
kernova schedule list
```

```
  Scheduled Jobs (1)
  ID                Name                    Cron/Delay   Enabled   Next Execution
  job_97cda2fb-91…  support-bot:daily-sum…  0 9 * * *    yes       2026-11-04T09:00:00.000Z
```

Enable or disable a job by name, full ID, or ID prefix:

```bash
kernova schedule disable support-bot:daily-summary
#  ✓ Job "support-bot:daily-summary" (job_97cda2fb-91cb-4849-a96d-1a0802483635) disabled.
kernova schedule enable job_97cda2fb
```

## 7. Monitor the task queue

```bash
kernova queue status
```

```
  Task Queue Status
  ═════════════════
    Pending:       0
    Active:        0
    Completed:     0
    Failed:        0
    Dead-lettered: 0
```

Replay a dead-lettered task with `kernova queue replay <task-id>`.

## 8. Inspect trigger rules

```bash
kernova triggers list
```

```
  Trigger Rules (1)
  ID              Name                  Pattern         Enabled   Cooldown   Last Fired
  trigger_e7d4b…  support-bot:on-esca…  intent.failed   yes       1.0s       never
```

```bash
kernova triggers disable support-bot:on-escalation
#  → Trigger rule "support-bot:on-escalation" (trigger_e7d4b858-…) disabled.
kernova triggers enable trigger_e7d4b
```

## 9. Check project status

```bash
kernova status
```

```
  Kernova Project Status
  ════════════════════════
    Name:        my-support-bot
    Version:     0.1.0
    Environment: development
    Model:       openai/gpt-4o

  Runtime
  ─────────
    Daemon:      Running (last heartbeat: 12s ago)
    Agents:      3 defined (from files)
    Schedules:   1 total (1 enabled)
    Task Queue:  0 pending, 0 active
    Triggers:    1 rules (1 enabled)
```

`kernova status`, `schedule`, `queue`, and `triggers` read the data directory directly: `--data-dir <path>`, or `$KERNOVA_DATA_DIR`, or `./kernova-data`.

## 10. Deploy with Docker

```bash
kernova deploy docker
```

```
  ✓ Generated Dockerfile
  ✓ Generated .dockerignore

  → Build and run:
    docker build -t my-support-bot .
    docker run --env-file .env my-support-bot
```

For a core project the Dockerfile builds with your `build` script and runs `npm start`, so your start script decides what runs. To run the agent config files as a service, add `@kernova/cli` to your dependencies and use:

```json
"start": "kernova serve --config ./agents --port 3000 --host 0.0.0.0"
```

Set `KERNOVA_API_KEY` in the container's environment: the gateway refuses to start without a token.

## 11. Production monitoring

Point the inspection commands at the production data directory:

```bash
export KERNOVA_DATA_DIR=/var/lib/kernova
kernova status
kernova schedule list
kernova queue status
kernova triggers list
```

---

That's the lifecycle from `kernova init` to production. See the [CLI reference](/api/cli) for every command and option.
