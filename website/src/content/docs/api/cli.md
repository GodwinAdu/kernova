---
title: "@kernova/cli"
description: Command-line tools reference.
---

# @kernova/cli

Developer tools for Kernova projects.

## Commands

### `Kernova init [name]`

Create a new project with standard structure.

```bash
Kernova init my-app
```

Generates: `Kernova.config.json`, `package.json`, `tsconfig.json`, `src/main.ts`, `src/agents/assistant.ts`

### `Kernova dev`

Start the development runtime with hot-reload and Studio.

```bash
Kernova dev
```

- Loads agents from `src/agents/`
- Watches for file changes (auto-reload)
- Starts Studio at http://localhost:4200
- Persistent events and memory (SQLite)

### `Kernova deploy [target]`

Prepare for production deployment.

```bash
Kernova deploy docker   # Generates Dockerfile + production entry
Kernova deploy node     # Generates production entry only
```

### `Kernova agent create <name>`

Generate a new agent file.

```bash
Kernova agent create code-reviewer
# → Created src/agents/code-reviewer.ts
```

### `Kernova agent list`

List agents in the project.

### `Kernova status`

Show project and runtime status.

### `Kernova --version`

Show version.
