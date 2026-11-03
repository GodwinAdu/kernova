---
title: MCP Integration
description: Connect agents to external systems via Model Context Protocol servers.
---

# MCP Integration

MCP (Model Context Protocol) lets agents connect to external systems — GitHub, databases, file systems, Slack, and more. Kernova makes MCP feel invisible.

## Quick Start

Reference MCP servers by name in your agent:

```typescript
// agents/developer.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Developer',
  instructions: 'You help with code development.',
  mcp: ['github', 'filesystem'],  // ← just list what you need
});
```

The server starts the MCP servers your agents (and their skills) list when it boots, in the background, and connects them to the kernel. Each server's tools are registered as `<server>_<tool>` (for example `github_create_issue`), and an agent can call every tool of the servers it lists. A server that fails to start is logged and skipped; the rest of the app keeps running.

## Well-Known Servers

These servers are built into the framework — just reference by name:

| Name | What It Does | Command |
|------|-------------|---------|
| `github` | GitHub repos, PRs, issues | `uvx mcp-server-github` |
| `filesystem` | Read/write local files | `uvx mcp-server-filesystem` |
| `slack` | Slack messages, channels | `uvx mcp-server-slack` |
| `postgres` | PostgreSQL queries | `uvx mcp-server-postgres` |
| `sqlite` | SQLite database | `uvx mcp-server-sqlite` |
| `puppeteer` | Browser automation | `uvx mcp-server-puppeteer` |
| `fetch` | HTTP requests | `uvx mcp-server-fetch` |
| `memory` | Persistent memory store | `uvx mcp-server-memory` |
| `brave` | Brave web search | `uvx mcp-server-brave-search` |
| `google` | Google search | `uvx mcp-server-google-search` |

## Custom MCP Server Config

For servers not in the well-known list, create a config file:

```typescript
// mcp/my-database.ts
import { defineMCP } from '@kernova/framework';

export default defineMCP({
  name: 'my-database',
  command: 'uvx',
  args: ['mcp-server-postgres'],
  env: {
    DATABASE_URL: process.env.DATABASE_URL!,
  },
  autoApprove: ['query', 'list_tables'],
  autoStart: true,
});
```

Place MCP configs in the `mcp/` directory. They're auto-discovered at startup.

## Using MCP with Skills

Skills can declare MCP requirements:

```typescript
// skills/devops/index.ts
import { defineSkill } from '@kernova/framework';

export default defineSkill({
  name: 'devops',
  description: 'DevOps and infrastructure management',
  instructions: '...',
  mcpServers: ['github', 'filesystem', 'docker'],  // ← auto-resolved
});
```

When an agent loads this skill, the required MCP servers are started too. Names that aren't well-known (like `docker` here) need a config in `mcp/` or `.kernova/mcp.json`.

## JSON Configuration

You can also configure MCP in `.kernova/mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "uvx",
      "args": ["mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "autoApprove": ["list_repos", "get_file_contents"]
    },
    "postgres": {
      "command": "uvx",
      "args": ["mcp-server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

## How It Works Under the Hood

```
Agent starts
  ↓
Framework reads agent.mcp: ['github', 'filesystem']
  ↓
MCPManager resolves each name → MCPServerConfig
  ↓
Starts MCP server processes (uvx mcp-server-github, etc.)
  ↓
Connects over stdio and lists each server's tools
  ↓
Tools are registered with the kernel as github_<tool>, filesystem_<tool>, …
  ↓
Agent can now use GitHub tools, filesystem tools, etc.
```

A server that exits isn't restarted automatically: restart the app to reconnect it.

## Environment Variables

MCP servers often need credentials. Set them in `.env.local`:

```bash
GITHUB_TOKEN=ghp_xxxxx
DATABASE_URL=postgresql://...
SLACK_TOKEN=xoxb-xxxxx
```

The MCP configs reference these via `process.env` (in `mcp/*.ts`) or `${VAR_NAME}` (in `.kernova/mcp.json`). MCP server processes also inherit the app's environment.

Set `"disabled": true` in `.kernova/mcp.json` (or `autoStart: false` in `defineMCP`) to keep a server from starting.

## Auto-Approve

There's no confirmation step for MCP tool calls: an agent calls any tool of the servers it lists, like its other tools. `autoApprove` is accepted for compatibility with other MCP clients' config files and currently has no effect. To block a tool for every agent, add it to `toolPolicy.deny` in [`kernova.config.ts`](/framework/config-reference#toolpolicy); otherwise list only the servers an agent needs.

## Multiple Agents, Shared MCP

MCP server processes are shared across agents. If two agents both use `github`, only one MCP server process runs.

```typescript
// agents/reviewer.agent.ts
export default defineAgent({ mcp: ['github'] });

// agents/deployer.agent.ts
export default defineAgent({ mcp: ['github', 'docker'] });

// Only one github MCP process runs, shared by both agents
```
