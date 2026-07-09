# @kernova/cli

**Developer tools for the Kernova Intelligent Systems Runtime.**

Project scaffolding, development server with hot-reload, web dashboard, and deployment.

## Installation

```bash
npm install -g @kernova/cli
```

## Commands

### `kernova init [name]`

Create a new project with the standard structure:

```bash
kernova init my-app
cd my-app
npm install
```

Generates:
- `kernova.config.json` — Runtime configuration
- `src/main.ts` — Entry point
- `src/agents/assistant.ts` — Your first agent
- `package.json` + `tsconfig.json`

### `kernova dev`

Start the development runtime:

```bash
kernova dev
```

What you get:
- ✓ Agents loaded from `src/agents/`
- ✓ Hot-reload on file changes (no restart needed)
- ✓ Kernova Studio at **http://localhost:4200** (web dashboard)
- ✓ Persistent events and memory (SQLite)
- ✓ Auto-detects model providers from environment

Output:
```
  ╔══════════════════════════════════════╗
  ║   ◆  K E R N O V A                   ║
  ║      Intelligent Systems Runtime     ║
  ╚══════════════════════════════════════╝

  ✓ Agent 'assistant' loaded (201ms)
  → Watching: src/agents
  → Studio: http://localhost:4200

  ✓ Kernova runtime is running
    Agents:     1
    Providers:  openai
    Events:     persistent (SQLite)
    Memory:     persistent (SQLite + FTS5)
```

### `kernova deploy [target]`

Prepare for production:

```bash
kernova deploy docker    # Generates Dockerfile + production entry
kernova deploy node      # Generates production entry only
```

### `kernova agent create <name>`

Generate a new agent file:

```bash
kernova agent create code-reviewer
# → Created src/agents/code-reviewer.ts
```

### `kernova agent list`

List agents in the project.

### `kernova status`

Show project and runtime status.

## Development Flow

```bash
kernova init my-app     # Create project
cd my-app && npm install
kernova dev             # Start (hot-reload + Studio at :4200)

# Edit src/agents/assistant.ts → auto-reloads
# Open http://localhost:4200 → inspect events, memory, agents

kernova deploy docker   # When ready for production
docker build -t my-app .
docker run -p 4200:4200 --env-file .env my-app
```

## Requirements

- Node.js 20+
- At least one AI model provider API key

## Documentation

Full docs at [kernova.dev](https://kernova.dev)
