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

The runtime automatically starts and manages the MCP server connections.

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

When an agent loads this skill, the required MCP servers are automatically started.

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
Authenticates + establishes connection
  ↓
Tools from MCP servers are registered with the agent
  ↓
Agent can now use GitHub tools, filesystem tools, etc.
  ↓
On crash → auto-reconnect
```

## Environment Variables

MCP servers often need credentials. Set them in `.env.local`:

```bash
GITHUB_TOKEN=ghp_xxxxx
DATABASE_URL=postgresql://...
SLACK_TOKEN=xoxb-xxxxx
```

The MCP configs reference these via `process.env` or `${VAR_NAME}` syntax.

## Auto-Approve

By default, every MCP tool call requires the agent to "decide" to use it. For trusted tools, auto-approve skips the confirmation:

```typescript
defineMCP({
  name: 'filesystem',
  command: 'uvx',
  args: ['mcp-server-filesystem'],
  autoApprove: ['read_file', 'list_directory'],  // ← these run without confirmation
});
```

## Multiple Agents, Shared MCP

MCP server processes are shared across agents. If two agents both use `github`, only one MCP server process runs.

```typescript
// agents/reviewer.agent.ts
export default defineAgent({ mcp: ['github'] });

// agents/deployer.agent.ts
export default defineAgent({ mcp: ['github', 'docker'] });

// Only one github MCP process runs, shared by both agents
```
