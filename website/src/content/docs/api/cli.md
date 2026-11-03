---
title: "@kernova/cli"
description: Complete reference for the Kernova command-line interface — every command, flag, and workflow explained with examples.
---

# @kernova/cli

The Kernova CLI is your primary interface for creating, developing, running, and managing autonomous agent applications. It handles the full lifecycle: from scaffolding a new project to running a production daemon with hot-reloadable agent configs.

## Installation

Kernova requires **Node.js 22+** as its runtime. Once Node.js is installed, the CLI is available via npm:

```bash
# Global install (recommended — makes "kernova" command available everywhere)
npm install -g @kernova/cli

# Verify
kernova --version
```

Or use `npx` without installing globally:

```bash
npx @kernova/cli init my-app
npx @kernova/cli dev
```

After installation, the `kernova` command is available globally.

---

## Command Overview

| Command | Purpose |
|---------|---------|
| `kernova init [name]` | Scaffold a new project |
| `kernova dev` | Start development runtime with hot-reload + development dashboard |
| `kernova serve` | Start production daemon (persistent mode), optionally with the HTTP gateway |
| `kernova studio` | Open the Studio dashboard for a running gateway |
| `kernova agent <action>` | Create, list, or inspect agents |
| `kernova schedule <action>` | Manage scheduled jobs (list, enable, disable) |
| `kernova queue <action>` | Manage the task queue (status, replay) |
| `kernova triggers <action>` | Manage proactive trigger rules (list, enable, disable) |
| `kernova status` | Show project + runtime status |
| `kernova doctor` | Test every configured AI provider |
| `kernova deploy [target]` | Generate production deployment artifacts |
| `kernova --version` | Show CLI version |
| `kernova --help` | Show help |

---

## `kernova init`

Creates a new Kernova project with a standard directory structure, starter code, and an agent configuration file.

### Usage

```bash
kernova init my-app
```

### What it generates

```
my-app/
├── kernova.config.json     # Runtime configuration
├── package.json            # Node.js project with @kernova/core dependency
├── tsconfig.json           # TypeScript configuration
├── .agent.yaml             # Starter declarative agent definition
├── .gitignore
└── src/
    ├── main.ts             # Application entry point
    ├── agents/
    │   └── assistant.ts    # Your first agent
    ├── workflows/          # (empty — for workflow definitions)
    └── tools/              # (empty — for custom tools)
```

### The generated `.agent.yaml`

This is a declarative agent definition that `kernova serve --config .agent.yaml` can load without any code:

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

### When to use

Use `kernova init` when starting a brand new project. If you already have a Node.js project and want to add Kernova, install `@kernova/sdk` directly instead.

---

## `kernova dev`

Starts the Kernova development runtime. This is your day-to-day command during development.

### Usage

```bash
kernova dev
```

### What it does

1. Reads `kernova.config.json` from the current directory
2. Starts the KernovaKernel in development mode
3. Loads all agents from `src/agents/`
4. Watches files for changes — agents are hot-reloaded without restart
5. Starts the Studio web UI at `http://localhost:4200`
6. Persists events and memory to SQLite (survives restarts)

### Output

```
  ╔══════════════════════════════════════╗
  ║   ◆  K E R N O V A                   ║
  ║      Intelligent Systems Runtime     ║
  ╚══════════════════════════════════════╝

  → Starting kernova runtime for "my-app"...

  ✓ kernova runtime is running

    Instance:   kern_abc123
    Env:        development
    Agents:     2
    Providers:  openai, anthropic
    Events:     persistent (SQLite)
    Memory:     persistent (SQLite + FTS5)

  → Press Ctrl+C to stop.
```

### Requirements

- A `kernova.config.json` file in the current directory (run `kernova init` if you don't have one)
- At least one AI provider API key set as environment variable (e.g., `OPENAI_API_KEY`)

### When to use

Use `kernova dev` during active development. It provides hot-reload for agents, a visual Studio UI for inspection, and persistent local storage. For production, use `kernova serve` instead.

---

## `kernova serve`

Starts the Kernova daemon in persistent mode. This is the production command for always-on autonomous agents.

### Usage

```bash
kernova serve [options]
```

### Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--config <path>` | `-c` | Path to agent config file or directory | (none) |
| `--watch` | `-w` | Hot-reload agent configs on file change | `false` |
| `--port <number>` | `-p` | Serve the HTTP gateway on this port (needs `KERNOVA_API_KEY`) | (no gateway) |
| `--host <address>` | | Interface the gateway binds to | `127.0.0.1` |
| `--data-dir <path>` | `-d` | Data directory for SQLite persistence | `$KERNOVA_DATA_DIR` or `./kernova-data` |
| `--shutdown-timeout <ms>` | | How long to wait for active intents on shutdown | `30000` |
| `--heartbeat <ms>` | | Heartbeat event interval | `60000` |

### Examples

```bash
# Basic daemon — loads no agent configs, just runs the kernel
kernova serve

# Load agents from a config directory with hot-reload
kernova serve --config ./agents/ --watch

# Specify a single agent config file
kernova serve --config ./my-agent.agent.yaml

# Custom data directory, plus the HTTP gateway on port 3100
KERNOVA_API_KEY=secret kernova serve --config ./agents/ --port 3100 --data-dir /var/kernova/data

# Production deployment with all options
KERNOVA_API_KEY=secret kernova serve -c /etc/kernova/agents/ -d /var/lib/kernova -p 8080 --host 0.0.0.0
```

### What it does

1. Creates a `KernovaKernel` and starts it
2. If `--config` is specified:
   - **Single file**: Loads that `.agent.yaml` / `.agent.yml` / `.agent.json` and registers the agent
   - **Directory**: Scans for all agent config files and registers each one
3. If `--watch` is enabled: monitors config files for changes and hot-reloads agents without restart
4. Starts all autonomy modules: scheduler, task queue, trigger engine, background loops
5. With `--port`: serves the [HTTP gateway](/guides/gateway-api) (it refuses to start without a token)
6. Emits a `daemon.heartbeat` event at start and then every 60 seconds
7. Handles SIGINT/SIGTERM for graceful shutdown (waits up to 30s for active intents to finish)

### Agent config file format

The daemon loads declarative agent definitions in YAML or JSON format:

```yaml
# ops-monitor.agent.yaml
name: ops-monitor
description: Monitors system health and responds to incidents
instructions: |
  You are an operations monitoring agent.
  Check system health metrics and alert on anomalies.
# model: gpt-4o   # optional; default: the model of the first provider with an API key
tools:
  - http-fetch
  - shell-exec
  - date-time
schedules:
  - name: health-check
    cron: "*/5 * * * *"
    goal: "Run system health check and report anomalies"
  - name: daily-summary
    cron: "0 9 * * *"
    goal: "Generate and send daily operations summary"
triggers:
  - name: on-alert
    event: "channel.message.*"
    condition: "event.data.channel === 'alerts'"
    goal: "Triage incoming alert and take corrective action"
extends: ./base-agent.agent.yaml  # Optional: inherit from another config
```

### Graceful shutdown

When the daemon receives SIGINT (Ctrl+C) or SIGTERM:

1. Stops accepting new intents
2. Waits up to 30 seconds for currently-running intents to complete
3. If intents don't finish within the timeout, force-stops
4. Closes SQLite connections and exits cleanly

### When to use

Use `kernova serve` for:
- **Production deployments** — always-on agents that run 24/7
- **Declarative agent management** — define agents in YAML, no code needed
- **Scheduled automation** — agents that run on cron schedules
- **Event-driven workflows** — agents that react to triggers

---

## `kernova studio`

Opens the Studio dashboard for a running [gateway](/guides/gateway-api). Studio listens on `localhost` and forwards its API calls to the gateway with the token, so the token never reaches the browser.

### Usage

```bash
kernova studio [options]
```

### Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--port <number>` | `-p` | Studio port | `4200` |
| `--gateway <url>` | `-g` | Gateway URL | `http://localhost:3000` |
| `--token <token>` | `-t` | Gateway token | `$KERNOVA_API_KEY` |

### Example

```bash
export KERNOVA_API_KEY=pick-a-long-random-token
kernova serve --config ./agents --port 3000   # terminal 1
kernova studio                                # terminal 2 → http://localhost:4200
```

See the [Studio guide](/guides/studio).

---

## `kernova doctor`

Checks every AI provider Kernova finds: providers set up in environment variables (also read from `.env.local` and `.env`) and a local Ollama server, if one is running. Each one gets a chat completion, a tool call, a stream, and an embedding, sent through the same provider classes the kernel uses, so Azure, Bedrock, and Vertex AI sign-in is checked too.

### Usage

```bash
kernova doctor [options]
```

### Options

| Flag | Short | Description |
|------|-------|-------------|
| `--provider <ids>` | | Check only these providers (comma-separated or repeated), e.g. `bedrock,vertex` |
| `--verbose` | `-v` | Show why each check failed, also for providers whose chat failed |

### Example

```bash
$ kernova doctor
  ✓   OpenAI (gpt-4o): working (412ms)

  Provider             Chat  Tools  Stream  Embed
  ─────────────────────────────────────────────────
  OpenAI               ✓     ✓      ✓       ✓

  1/1 providers working.
```

Bedrock isn't auto-detected from plain AWS credentials; when doctor finds some, it suggests `kernova doctor --provider bedrock`. The command exits with code 1 when no provider works.

---

## `kernova agent`

Manage agents within your project.

### `kernova agent create <name>`

Generate a new agent file with boilerplate code.

```bash
kernova agent create code-reviewer
# → Created src/agents/code-reviewer.ts
```

The generated file includes:

```typescript
import { defineAgent } from '@kernova/core';

export default defineAgent({
  name: 'code-reviewer',
  description: 'A code-reviewer agent',
  capabilities: [
    {
      id: 'code-reviewer-default',
      name: 'code-reviewer',
      description: 'Default capability for code-reviewer',
      confidence: 0.8,
    },
  ],
  tools: [],
  instructions: `
    You are the code-reviewer agent in the kernova runtime.
    Define your behavior here.
  `,
  async execute(intent, context, tools) {
    tools.log(`[code-reviewer] Processing: ${intent.goal}`);
    return {
      success: true,
      summary: `code-reviewer processed: ${intent.goal}`,
      evidence: { sources: [], confidence: 0.9, reasoning: 'Direct execution' },
      durationMs: 0,
    };
  },
});
```

### `kernova agent list`

List all agents defined in `src/agents/`.

```bash
kernova agent list
```

```
  Registered Agents:
  ──────────────────
    ◆ assistant
    ◆ code-reviewer
    ◆ researcher
```

### `kernova agent inspect <name>`

Show metadata about an agent.

```bash
kernova agent inspect code-reviewer
```

```
  → Agent: code-reviewer
  → Path: src/agents/code-reviewer.ts
  → Status: Defined (load with "kernova dev")
```

### When to use

Use `kernova agent create` to quickly scaffold new agents with the correct structure. The generated template includes all required fields (`name`, `capabilities`, `instructions`, `execute`) so you can focus on writing the logic.

---

## `kernova schedule`

Manage scheduled jobs that are registered with the Kernova scheduler. Jobs persist in SQLite, so this command reads from the database directly.

### `kernova schedule list`

Display all registered scheduled jobs.

```bash
kernova schedule list
kernova schedule list --data-dir /var/kernova/data
```

```
  Scheduled Jobs
  ══════════════
    ✓ hourly-check (0 * * * *) [job_a1b2c3]
    ✓ daily-report (0 9 * * *) [job_d4e5f6]
    ○ one-shot-task (delay: 5000ms) [job_g7h8i9]
```

- `✓` = enabled
- `○` = disabled

### `kernova schedule enable <id>`

Re-enable a disabled scheduled job. Give the full ID, an ID prefix (the list shortens IDs), or the job name.

```bash
kernova schedule enable job_a1b2c3
# → Job job_a1b2c3 enabled.
```

### `kernova schedule disable <id>`

Disable a scheduled job (it won't fire until re-enabled). Accepts an ID, ID prefix, or name.

```bash
kernova schedule disable job_a1b2c3
# → Job job_a1b2c3 disabled.
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--data-dir <path>` | Path to the kernova data directory | `./kernova-data` |

### When to use

Use these commands to inspect and control scheduled jobs without modifying code or config files. Useful for:
- Temporarily disabling a job during maintenance
- Verifying that your scheduled jobs are registered correctly
- Re-enabling jobs after they were paused

---

## `kernova queue`

Manage the task queue — inspect status and replay failed tasks.

### `kernova queue status`

Display task queue statistics.

```bash
kernova queue status
kernova queue status --data-dir /var/kernova/data
```

```
  Task Queue Status
  ═════════════════
    Pending:       12
    Active:        3
    Completed:     847
    Failed:        2
    Dead-lettered: 1
```

### `kernova queue replay <id>`

Move a dead-lettered task back to the pending queue for retry.

```bash
kernova queue replay dl_abc123
# ✓ Replayed dead-letter dl_abc123 → new task task_xyz789 (status: pending)
```

A task ends up in the dead-letter queue after exhausting all retry attempts. Replaying it creates a fresh pending task with the same handler and payload.

### Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--data-dir` | `-d` | Path to the kernova data directory | `./kernova-data` |

### Error cases

```bash
# Task not found
kernova queue replay dl_nonexistent
# ✗ Dead-letter item not found: dl_nonexistent

# Already replayed
kernova queue replay dl_abc123
# ✗ Dead-letter item already replayed: dl_abc123
```

### When to use

Use `kernova queue status` to monitor your task queue health. If you see dead-lettered items, investigate the failure (check logs), fix the root cause, then `replay` to retry.

---

## `kernova triggers`

Manage proactive trigger rules — event-driven rules that fire actions when conditions are met.

### `kernova triggers list`

Display all registered trigger rules.

```bash
kernova triggers list
kernova triggers list --data-dir /var/kernova/data
```

```
  Trigger Rules (3)
  ────────────────────────────────────────────────────────────────────────
  ID              Name                  Pattern                   Enabled   Cooldown    Last Fired
  ────────────────────────────────────────────────────────────────────────
  trig_a1b2c3     on-new-email          channel.message.*         yes       5.0s        2025-07-10T14:30:00Z
  trig_d4e5f6     daily-digest          scheduler.fired           yes       60.0s       2025-07-10T09:00:00Z
  trig_g7h8i9     error-alert           intent.failed             no        1.0s        never
  ────────────────────────────────────────────────────────────────────────
```

### `kernova triggers enable <id>`

Enable a disabled trigger rule. Give the full ID, an ID prefix (the list shortens IDs), or the rule name.

```bash
kernova triggers enable trig_g7h8i9
# → Trigger rule "error-alert" (trig_g7h8i9) enabled.
```

### `kernova triggers disable <id>`

Disable a trigger rule (it won't fire until re-enabled). Accepts an ID, ID prefix, or name.

```bash
kernova triggers disable trig_a1b2c3
# → Trigger rule "on-new-email" (trig_a1b2c3) disabled.
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--data-dir <path>` | Path to the kernova data directory | `./kernova-data` |

### When to use

Use `kernova triggers list` to verify your trigger rules are registered and see which ones have fired recently. Use `enable`/`disable` to temporarily silence a noisy trigger without removing it.

---

## `kernova status`

Show the current project configuration and runtime state. Reads both the project config file and the SQLite database to display a comprehensive view.

### Usage

```bash
kernova status
kernova status --data-dir /var/kernova/data
```

### Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--data-dir` | `-d` | Path to the kernova data directory | `./kernova-data` |

### Output

```
  Kernova Project Status
  ════════════════════════
    Name:        my-app
    Version:     0.1.0
    Environment: development
    Model:       openai/gpt-4o

  Runtime
  ─────────
    Daemon:      Running (last heartbeat: 12s ago)
    Agents:      3 registered
    Schedules:   5 total (4 enabled)
    Task Queue:  2 pending, 1 active
    Triggers:    3 rules (2 enabled)

  Memory Layers:
    Working:       ✓
    Session:       ✓
    Long-term:     ✓
```

If the daemon hasn't been started yet (no database exists):

```
  Runtime
  ─────────
    No runtime data — daemon has not been started.
```

### What it checks

- **Daemon health**: Looks for recent `daemon.heartbeat` events in the database. If a heartbeat was recorded within the last 2 minutes → "Running", otherwise → "Stopped".
- **Agents**: Counts registered agents from the database, or falls back to counting `.agent.yaml` files.
- **Schedules**: Total and enabled counts from the `scheduled_jobs` table.
- **Task Queue**: Pending and active task counts.
- **Triggers**: Total rules and how many are enabled.

### When to use

Quick sanity check before/after running `kernova serve`. See at a glance whether the daemon is running, how many agents are active, and whether any tasks are stuck.

---

## `kernova deploy`

Generate production deployment artifacts.

### `kernova deploy docker`

Generates a `Dockerfile` and `.dockerignore` (Node 24, the whole project copied in):

- **Framework projects** (`kernova.config.ts`): runs `kernova start` (port 3000 with a frontend, 4555 with `--agents-only` or no `app/`)
- **Core projects** (`kernova.config.json`): runs your `build` script, then `npm start`. To serve agent config files, add `@kernova/cli` and set `"start": "kernova serve --config ./agents --port 3000 --host 0.0.0.0"` (with `KERNOVA_API_KEY` in the container environment)

```bash
kernova deploy docker
```

```
  ✓ Generated Dockerfile
  ✓ Generated .dockerignore

  → Build and run:
    docker build -t my-app .
    docker run --env-file .env my-app
```

### `kernova deploy node`

Generates only the `src/production.ts` entry point (no Docker artifacts).

```bash
kernova deploy node
```

```
  ✓ Generated src/production.ts

  → Run in production:
    npm run build
    NODE_ENV=production node dist/production.js
```

### When to use

Use `kernova deploy` when you're ready to move from development to production. Choose `docker` for containerized deployments or `node` for bare-metal/VM deployments.

---

## Global Flags

These flags work with any command:

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for the current command |
| `--version`, `-v` | Show the CLI version |

---

## Environment Variables

The CLI respects these environment variables:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI provider authentication |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) provider authentication |
| `GEMINI_API_KEY` | Google Gemini provider authentication |
| `DEEPSEEK_API_KEY` | DeepSeek provider authentication |
| `GROQ_API_KEY` | Groq provider authentication |
| `KERNOVA_DATA_DIR` | Default data directory for `serve`, `status`, `schedule`, `queue`, and `triggers` (instead of `./kernova-data`) |
| `KERNOVA_API_KEY` | Gateway token: required by `serve --port`, and sent by `studio` |

Set at least one model provider key for AI functionality.

---

## Typical Workflows

### New project from scratch

```bash
kernova init my-agent-app
cd my-agent-app
npm install
export OPENAI_API_KEY=sk-...
kernova dev
```

### Add an agent to existing project

```bash
kernova agent create email-processor
# Edit src/agents/email-processor.ts with your logic
kernova dev  # Hot-reloads the new agent
```

### Production deployment with declarative agents

```bash
# Create agent configs
mkdir agents/
cat > agents/monitor.agent.yaml << 'EOF'
name: monitor
instructions: You monitor system health.
# model: gpt-4o   # optional; default: the model of the first provider with an API key
tools:
  - http-fetch
  - date-time
schedules:
  - name: health-check
    cron: "*/5 * * * *"
    goal: "Check system health"
EOF

# Start daemon with hot-reload during testing
kernova serve --config ./agents/ --watch

# Once stable, run without --watch in production
kernova serve --config ./agents/ --data-dir /var/lib/kernova
```

### Inspect and manage a running system

```bash
# Check what's running
kernova schedule list
kernova queue status
kernova triggers list

# A task failed and was dead-lettered — replay it after fixing the issue
kernova queue replay dl_abc123

# Temporarily disable a noisy schedule
kernova schedule disable job_xyz789
```

---

## Troubleshooting

### "No kernova.config.json found"

You're not in a Kernova project directory. Either `cd` into your project or run `kernova init` to create one.

### "Database not found"

The `schedule`, `queue`, and `triggers` commands need an existing SQLite database. This is created when you first run `kernova dev` or `kernova serve`. Make sure you specify the correct `--data-dir` if it's not the default `./kernova-data`.

### Port already in use

If `kernova serve --port 3100` fails with an address-in-use error, another process is using that port. Use a different port or stop the other process.

### Agent config not loading

Check that your agent config file:
1. Has a valid extension: `.agent.yaml`, `.agent.yml`, or `.agent.json`
2. Contains the required fields: `name` and `instructions`
3. Has valid YAML/JSON syntax

Syntax errors are logged but don't crash the daemon — check the console output for error messages.
