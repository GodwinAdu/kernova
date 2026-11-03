# @kernova/cli

[![npm version](https://img.shields.io/npm/v/@kernova/cli.svg)](https://www.npmjs.com/package/@kernova/cli)
[![npm downloads](https://img.shields.io/npm/dm/@kernova/cli.svg)](https://www.npmjs.com/package/@kernova/cli)
[![license](https://img.shields.io/npm/l/@kernova/cli.svg)](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@kernova/cli.svg)](https://nodejs.org)

**The `kernova` command: create, develop, build, diagnose, and deploy Kernova AI agent apps.**

**[Documentation](https://kernova2026.vercel.app)** · [CLI reference](https://kernova2026.vercel.app/framework/cli-reference/) · [GitHub](https://github.com/GodwinAdu/kernova)

```bash
npx create-kernova-app my-app && cd my-app
npm run dev   # → kernova dev
```

---

## Installation

Projects created with [`create-kernova-app`](https://www.npmjs.com/package/create-kernova-app) already include the CLI as a dependency, so run it through `npm run <script>` or `npx kernova <command>` inside the project.

To run it anywhere without installing:

```bash
npx @kernova/cli <command>
```

To use it globally:

```bash
npm install -g @kernova/cli
kernova --help
```

Requirements: Node.js **22+** and an API key for at least one model provider (for example `OPENAI_API_KEY`).

## Commands at a glance

| Command | Description |
|---------|-------------|
| [`kernova create <name>`](#kernova-create) | Scaffold a full-stack project |
| [`kernova dev`](#kernova-dev) | Start frontend + agents with hot reload |
| [`kernova build`](#kernova-build) | Build for production |
| [`kernova start`](#kernova-start) | Run the production build |
| [`kernova deploy [target]`](#kernova-deploy) | Deploy to Kernova Cloud, or generate Docker/Node artifacts |
| [`kernova login` / `logout`](#kernova-login) | Manage Kernova Cloud credentials |
| [`kernova doctor`](#kernova-doctor) | Test every configured AI provider |
| [`kernova serve`](#kernova-serve) | Run agents as a long-lived daemon |
| [`kernova studio`](#kernova-studio) | Open the admin dashboard |
| [`kernova agent <action>`](#kernova-agent) | Create, list, and inspect agents |
| [`kernova schedule <action>`](#kernova-schedule) | Manage scheduled jobs |
| [`kernova queue <action>`](#kernova-queue) | Inspect the task queue and replay dead letters |
| [`kernova triggers <action>`](#kernova-triggers) | Manage proactive triggers |
| [`kernova status`](#kernova-status) | Show runtime status |
| [`kernova init <name>`](#kernova-init) | Create an agents-only project (legacy) |

Global flags: `-h, --help` and `-v, --version`.

---

## Develop

### `kernova create`

```bash
kernova create my-app
kernova create my-app --template multi-agent
kernova create my-app --react          # Vite + React instead of Next.js
kernova create my-app --no-frontend    # agents only
kernova create my-app --no-install
```

Templates: `default`, `minimal`, `multi-agent`. Same as `npx create-kernova-app`.

### `kernova dev`

```bash
kernova dev
kernova dev --port 3001 --agent-port 4600
kernova dev --agents-only
```

Starts the Next.js frontend (port `3000`) and the agent server (port `4555`) behind one URL, with hot reload for both.

```
  ✓ Ready at http://localhost:3000

    App:     http://localhost:3000
    Chat:    http://localhost:3000/chat
    Agents:  http://localhost:3000/api/agents/*
```

| Flag | Description |
|------|-------------|
| `--port <n>` | Frontend port (default `3000`) |
| `--agent-port <n>` | Agent server port (default `4555`, or `KERNOVA_PORT`) |
| `--agents-only` | Start only the agent server |
| `--app-only` | Start only the frontend |

### `kernova doctor`

```bash
kernova doctor
kernova doctor --verbose
kernova doctor --provider bedrock,vertex   # check only these providers
```

Finds every configured AI provider (from environment variables, `.env.local`, or `.env`) and a local Ollama server, then tests chat completion, tool calling, streaming, and embeddings against each one with the same provider classes the kernel uses, so Azure, Bedrock, and Vertex AI sign-in is checked too. `--provider` checks only the providers you name, for example Bedrock with your AWS credentials (which isn't auto-detected). Exits with code 1 when no provider works. Run this first when something isn't working.

## Build and run

### `kernova build`

```bash
kernova build
kernova build --agents-only | --app-only
kernova build --verbose
```

Compiles agents, builds the frontend, and validates `kernova.config.ts`.

### `kernova start`

```bash
kernova start
kernova start --port 8080 --agent-port 4555
```

Runs the production build. Accepts the same `--port`, `--agent-port`, `--agents-only`, and `--app-only` flags as `dev`.

## Deploy

### `kernova login`

```bash
kernova login                       # opens the browser to create an API key
kernova login --key kn_live_xxxxx   # use an existing key (CI-friendly)
kernova logout
```

Credentials are saved to `~/.kernova/credentials.json`.

### `kernova deploy`

```bash
kernova deploy                  # frontend + agents to Kernova Cloud
kernova deploy --agents-only
kernova deploy --app-only
kernova deploy --region us-east-1

kernova deploy docker           # generate Docker artifacts to self-host
kernova deploy node             # generate a Node.js production entry
```

`KERNOVA_CLOUD_URL` overrides the Kernova Cloud endpoint.

## Operate

### `kernova serve`

```bash
kernova serve
kernova serve --config ./agents/ --watch
KERNOVA_API_KEY=secret kernova serve --port 3000 --data-dir ./data
```

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Agent config file or directory (`.agent.yaml` / `.agent.json`) |
| `-w, --watch` | Hot-reload config changes |
| `-p, --port <n>` | Serve the HTTP gateway on this port (needs `KERNOVA_API_KEY`) |
| `--host <address>` | Interface the gateway binds to (default `127.0.0.1`; `0.0.0.0` in containers) |
| `-d, --data-dir <path>` | Data directory (default `$KERNOVA_DATA_DIR` or `./kernova-data`) |
| `--shutdown-timeout <ms>` | Wait for active intents on shutdown (default `30000`) |
| `--heartbeat <ms>` | Heartbeat event interval (default `60000`) |

Starts the kernel and runs the scheduler, task queue, and triggers persistently, and shuts down gracefully on `SIGINT` / `SIGTERM`.

### `kernova studio`

```bash
kernova studio                                 # http://localhost:4200, token from $KERNOVA_API_KEY
kernova studio --port 8080
kernova studio --gateway https://staging.example.com --token $STAGING_TOKEN
```

A web dashboard for agents, events, memory, workflows, logs, monitoring, plugins, and permissions. It ships inside the CLI package, so there is nothing else to install. `--gateway` sets the Kernova Gateway the dashboard reads from (default `http://localhost:3000`) and `--token` its token. Studio listens on localhost and forwards API calls to the gateway with the token, so the token never reaches the browser.

### `kernova agent`

```bash
kernova agent create my-agent
kernova agent list
kernova agent inspect my-agent
```

### `kernova schedule`

```bash
kernova schedule list
kernova schedule enable job_abc123
kernova schedule disable job_abc123 --data-dir /var/kernova/data
```

### `kernova queue`

```bash
kernova queue status
kernova queue replay dl_abc123   # retry a dead-lettered task
```

### `kernova triggers`

```bash
kernova triggers list
kernova triggers enable my-rule-id
kernova triggers disable my-rule-id
```

`schedule`, `queue`, and `triggers` accept `--data-dir <path>` to inspect a specific runtime's data.

### `kernova status`

Shows runtime status for the current project.

### `kernova init`

```bash
kernova init my-agent
```

Creates an agents-only project with a starter `.agent.yaml`. New projects should use `kernova create`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, ... | Model provider keys |
| `KERNOVA_PORT` | Agent server port (default `4555`) |
| `KERNOVA_API_KEY` | Require a bearer token on agent requests; the gateway token for `serve --port` and `studio` |
| `KERNOVA_DATA_DIR` | Default data directory for `serve`, `status`, `schedule`, `queue`, `triggers` |
| `KERNOVA_CLOUD_URL` | Override the Kernova Cloud endpoint |

## Typical workflow

```bash
npx create-kernova-app my-app
cd my-app
npm run dev              # edit agents/ and app/, everything hot-reloads

npx kernova doctor       # verify providers
npx kernova build
npx kernova login
npx kernova deploy
```

## Related packages

| Package | Use it for |
|---------|-----------|
| [`create-kernova-app`](https://www.npmjs.com/package/create-kernova-app) | Scaffold a new project |
| [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) | File-based agents and React hooks |
| [`@kernova/sdk`](https://www.npmjs.com/package/@kernova/sdk) | Backend-only agent services |

## Documentation and support

- [CLI reference](https://kernova2026.vercel.app/framework/cli-reference/)
- [Create a project](https://kernova2026.vercel.app/framework/create-project/)
- [Deploy to Kernova Cloud](https://kernova2026.vercel.app/framework/deploy/) · [Self-hosting](https://kernova2026.vercel.app/framework/self-hosting/)
- [Studio](https://kernova2026.vercel.app/guides/studio/) · [Daemon mode](https://kernova2026.vercel.app/guides/daemon/)
- [Troubleshooting](https://kernova2026.vercel.app/framework/troubleshooting/)
- [Report a bug or request a feature](https://github.com/GodwinAdu/kernova/issues)

## Contributing

Contributions are welcome. See the [contributing guide](https://github.com/GodwinAdu/kernova/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
