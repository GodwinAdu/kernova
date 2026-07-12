---
title: CLI Reference
description: Complete reference for all kernova CLI commands.
---

# CLI Reference

The `kernova` CLI is your primary tool for developing and deploying Kernova applications.

## Installation

The CLI is included when you install `@kernova/cli`:

```bash
npm install -g @kernova/cli
```

Or use it via npx (no install needed):

```bash
npx @kernova/cli dev
```

## Commands

### `kernova create <name>`

Scaffold a new full-stack project.

```bash
kernova create my-app
kernova create my-app --template multi-agent
kernova create my-app --no-frontend
kernova create my-app --react        # Use Vite instead of Next.js
kernova create my-app --no-install   # Skip npm install
```

| Flag | Description |
|------|-------------|
| `--template, -t` | Template: `default`, `minimal`, `multi-agent` |
| `--no-frontend` | Agents only (no React/Next.js) |
| `--react` | Use Vite + React instead of Next.js |
| `--no-install` | Don't run `npm install` |

---

### `kernova dev`

Start the development server.

```bash
kernova dev
kernova dev --port 4000
kernova dev --agent-port 5000
kernova dev --agents-only
kernova dev --app-only
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port, -p` | `3000` | Frontend port |
| `--agent-port` | `4555` | Agent backend port |
| `--agents-only` | — | Only start agent backend |
| `--app-only` | — | Only start frontend |

In full-stack mode, this starts both the Next.js frontend and the agent backend behind a single URL.

---

### `kernova build`

Build the project for production.

```bash
kernova build
kernova build --agents-only
kernova build --app-only
kernova build --verbose
```

| Flag | Description |
|------|-------------|
| `--agents-only` | Only compile agents |
| `--app-only` | Only build frontend |
| `--verbose, -v` | Show full build output |

This:
1. Validates `kernova.config.ts`
2. Compiles agents (TypeScript → JavaScript)
3. Builds frontend (`next build`)
4. Generates build manifest

---

### `kernova start`

Start the production server (must run `kernova build` first).

```bash
kernova start
kernova start --port 8080
kernova start --agents-only
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `3000` | Frontend port |
| `--agent-port` | `4555` | Agent backend port |
| `--agents-only` | — | Only start agent backend |

---

### `kernova deploy`

Deploy to Kernova Cloud or generate deploy artifacts.

```bash
kernova deploy                    # Deploy to Kernova Cloud
kernova deploy --agents-only      # Deploy only agents
kernova deploy --app-only         # Deploy only frontend
kernova deploy --region eu-west-1 # Deploy to specific region
kernova deploy docker             # Generate Dockerfile
kernova deploy node               # Generate Node.js entry
```

| Flag | Description |
|------|-------------|
| `--agents-only` | Deploy only the agent backend |
| `--app-only` | Deploy only the frontend |
| `--region` | Deploy region (`us-east-1`, `eu-west-1`, etc.) |
| `docker` | Generate Dockerfile for self-hosting |
| `node` | Generate Node.js production entry |

---

### `kernova login`

Authenticate with Kernova Cloud.

```bash
kernova login                        # Opens browser for key creation
kernova login --key kn_live_xxxxx    # Use existing key
```

Credentials are saved to `~/.kernova/credentials.json`.

---

### `kernova logout`

Remove saved Kernova Cloud credentials.

```bash
kernova logout
```

---

### `kernova init`

Create a legacy project (agents-only, no frontend). Use `kernova create` for full-stack projects.

```bash
kernova init my-agent-app
```

---

### `kernova serve`

Start the agent runtime with the Gateway API (legacy mode).

```bash
kernova serve
kernova serve --port 4200
```

---

### `kernova studio`

Open the Kernova Studio dashboard.

```bash
kernova studio
kernova studio --port 4200
```

---

### `kernova agent`

Manage agent definitions.

```bash
kernova agent create my-agent    # Create a new agent file
kernova agent list               # List registered agents
kernova agent inspect my-agent   # Show agent details
```

---

### `kernova status`

Show the runtime status.

```bash
kernova status
```

Shows: instance ID, environment, registered agents, providers, memory status.
