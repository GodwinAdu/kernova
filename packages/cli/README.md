# @kernova/cli

**Developer tools for the Kernova AI Agent Platform.**

Create projects, develop with hot-reload, build for production, and deploy to Kernova Cloud.

## Installation

```bash
npm install -g @kernova/cli
```

Or use via npx (no install needed):

```bash
npx @kernova/cli create my-app
```

## Commands

### `kernova create <name>` — Scaffold a full-stack project

```bash
kernova create my-app
kernova create my-app --template multi-agent
kernova create my-app --no-frontend
```

Generates a complete project with agents, tools, React frontend, and configuration.

### `kernova dev` — Start development server

```bash
kernova dev
```

Starts both the frontend (Next.js on port 3000) and agent backend (port 4555) behind a single URL. Includes hot-reload for agents.

```
  ✓ Ready at http://localhost:3000

    App:     http://localhost:3000
    Chat:    http://localhost:3000/chat
    Agents:  http://localhost:3000/api/agents/*
    Health:  http://localhost:3000/v1/health
```

### `kernova build` — Build for production

```bash
kernova build
```

Compiles agents (TypeScript), builds frontend (Next.js), validates config.

### `kernova start` — Run production server

```bash
kernova start
```

Runs the built project in production mode.

### `kernova deploy` — Deploy to Kernova Cloud

```bash
kernova deploy
```

Deploys your app to [Kernova Cloud](https://cloud.kernova.app). One command, both frontend and agents.

### `kernova login` — Authenticate with Kernova Cloud

```bash
kernova login --key kn_live_xxxxx
```

### `kernova logout` — Remove credentials

```bash
kernova logout
```

### `kernova init <name>` — Create a legacy project (agents-only)

```bash
kernova init my-agent
```

### `kernova serve` — Start agent runtime with Gateway API

```bash
kernova serve
```

### `kernova studio` — Open the admin dashboard

```bash
kernova studio
```

### `kernova agent` — Manage agent definitions

```bash
kernova agent create my-agent
kernova agent list
kernova agent inspect my-agent
```

### `kernova status` — Show runtime status

```bash
kernova status
```

## Development Flow

```bash
# Create and start
npx create-kernova-app my-app
cd my-app
kernova dev

# Develop: edit agents/ and app/ → hot reload

# Build and deploy
kernova build
kernova login --key kn_live_xxx
kernova deploy
# → https://my-app.kernova.app
```

## Requirements

- Node.js 20+
- At least one AI model provider API key (e.g., `OPENAI_API_KEY`)

## Documentation

Full docs at [kernova.dev](https://kernova.dev)
