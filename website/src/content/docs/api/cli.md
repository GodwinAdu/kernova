---
title: "@nexus/cli"
description: Command-line tools reference.
---

# @nexus/cli

Developer tools for Nexus projects.

## Commands

### `nexus init [name]`

Create a new project with standard structure.

```bash
nexus init my-app
```

Generates: `nexus.config.json`, `package.json`, `tsconfig.json`, `src/main.ts`, `src/agents/assistant.ts`

### `nexus dev`

Start the development runtime with hot-reload and Studio.

```bash
nexus dev
```

- Loads agents from `src/agents/`
- Watches for file changes (auto-reload)
- Starts Studio at http://localhost:4200
- Persistent events and memory (SQLite)

### `nexus deploy [target]`

Prepare for production deployment.

```bash
nexus deploy docker   # Generates Dockerfile + production entry
nexus deploy node     # Generates production entry only
```

### `nexus agent create <name>`

Generate a new agent file.

```bash
nexus agent create code-reviewer
# → Created src/agents/code-reviewer.ts
```

### `nexus agent list`

List agents in the project.

### `nexus status`

Show project and runtime status.

### `nexus --version`

Show version.
