---
title: Kernova Studio
description: Visual developer dashboard for managing agents, inspecting events, searching memory, and monitoring the runtime.
---

Kernova Studio is a visual developer dashboard that connects to your running Kernova Gateway for real-time monitoring and management. Think of it as your control center — every agent, event, memory entry, and metric is visible and interactive.

## Quick Start

### Option 1: CLI (Recommended)

```bash
# Start your Kernova app (Gateway runs on port 3000 by default)
kernova serve

# In another terminal, launch Studio
kernova studio
```

Studio opens at `http://localhost:4200` and connects to your Gateway automatically.

### Option 2: Development Mode

If you've cloned the Kernova monorepo and want to customize Studio:

```bash
cd packages/studio
NEXT_PUBLIC_KERNOVA_URL=http://localhost:3000 npm run dev
```

### Option 3: Custom Gateway URL

Point Studio at any Kernova Gateway — local, staging, or production:

```bash
kernova studio --gateway https://staging.myapp.com:3000
kernova studio --port 8080 --gateway http://192.168.1.50:3000
```

## When to Use Studio

| Scenario | What Studio Shows You |
|----------|----------------------|
| Debugging agent behavior | Events page shows the full intent lifecycle in real-time |
| Inspecting memory | Memory Explorer lets you semantically search all stored context |
| Monitoring performance | Dashboard and Monitoring show token usage, latency, error rates |
| Managing identities | Permissions page lists all registered users, agents, and services |
| Viewing logs | Logs page streams runtime events formatted as structured log entries |
| Understanding context | Context Debugger visualizes token allocation across memory layers |

## Architecture

```
┌─────────────────┐          ┌──────────────────────┐
│  Kernova Studio │  ──────► │  Kernova Gateway API │
│  (Next.js App)  │  HTTP    │  (Port 3000)         │
│  Port 4200      │          │                      │
└─────────────────┘          │  /health             │
                             │  /v1/agents          │
                             │  /v1/events          │
                             │  /v1/memory/search   │
                             │  /v1/metrics         │
                             │  /v1/logs            │
                             │  /v1/plugins         │
                             │  /v1/workflows       │
                             │  /v1/permissions/*   │
                             │  /v1/deployments     │
                             │  /v1/context/:id     │
                             │  /v1/intents (POST)  │
                             └──────────────────────┘
```

Studio is a **read-heavy client** that polls the Gateway API. It does not modify state except when you explicitly submit intents or install plugins.

## Pages

### Dashboard

The landing page shows:
- **Connection status** — green when Gateway is reachable
- **Stat cards** — active agents, pending tasks, token usage, latency, uptime
- **Intent submission** — send goals directly to the runtime from the UI

### Agents

Lists all registered agents with their model, capabilities, and status. You can submit intents targeted at specific agents.

### Events

Real-time event stream that auto-refreshes every 2 seconds. Filter by category (intent, agent, tool, memory, workflow, system) and severity. Click any event to see its full data payload.

### Memory

Semantic search across all memory layers: working, session, longterm, organizational, global. Results are ranked by relevance score.

### Monitoring

Health banner, request metrics, token breakdown, and latency stats. Auto-refreshes every 5 seconds.

### Logs

Terminal-style log viewer that formats events as structured log entries with level, source, message, and trace ID.

### Plugins

Shows installed plugins, their versions, and the tools they provide.

### Workflows

Lists registered workflow definitions and their execution status.

### Context

Enter an intent ID to visualize how the context window is allocated across memory layers — shows token counts per layer with a visual bar chart.

### Deploy

Displays running Kernova instances with their environment, version, and status.

### Permissions

Lists all registered identities (users, agents, services) with their roles, plus any configured API keys.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_KERNOVA_URL` | `http://localhost:3000` | Gateway API URL |

### CLI Options

```bash
kernova studio [options]

Options:
  -p, --port <number>     Studio UI port (default: 4200)
  -g, --gateway <url>     Gateway API URL (default: http://localhost:3000)
  -h, --help              Show help
```

## Gateway API Endpoints (used by Studio)

Studio uses these Gateway API endpoints. They are automatically available when your Kernova kernel starts with `kernel.start()`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check and connection status |
| GET | `/v1/agents` | List registered agent definitions |
| GET | `/v1/events?category=&severity=&limit=` | Recent events from EventBus |
| POST | `/v1/memory/search` | Semantic memory search |
| GET | `/v1/metrics` | Token usage, request count, uptime |
| GET | `/v1/workflows` | Workflow definitions |
| GET | `/v1/plugins` | Installed plugins and tools |
| GET | `/v1/permissions/identities` | Registered identities |
| GET | `/v1/permissions/keys` | Configured API keys |
| GET | `/v1/logs?level=&limit=` | Events formatted as log entries |
| GET | `/v1/deployments` | Running instances |
| GET | `/v1/context/:intentId` | Context layer stats |
| POST | `/v1/intents` | Submit a new intent |

## Offline Behavior

When the Gateway is offline, Studio shows:
- A warning banner on the Dashboard
- Empty states on all pages with helpful messages
- The connection indicator in the sidebar turns red

Studio continues checking every 5 seconds. When the Gateway comes back, data loads automatically — no refresh needed.

## Production Use

For production deployments:

1. **Auth tokens** — Configure `auth.tokens` on your Gateway to require Bearer authentication
2. **CORS** — The Gateway enables CORS by default; disable in production if Studio runs on the same origin
3. **Port binding** — Change the Gateway host from `0.0.0.0` to a specific IP if you don't want it exposed

```typescript
const kernel = new KernovaKernel({
  environment: 'production',
  gateway: {
    port: 3000,
    host: '127.0.0.1', // Only local connections
    auth: {
      allowAnonymous: false,
      tokens: [process.env.GATEWAY_TOKEN!],
    },
  },
});
```

## Customizing Studio

Studio is a standard Next.js 16 app built with Tailwind CSS v4. To customize:

```bash
cd packages/studio
npm install
npm run dev
```

- **Add pages** — Create new routes in `src/app/`
- **Custom API endpoints** — Extend `src/lib/api.ts`
- **Theming** — Edit `src/app/globals.css` (uses CSS custom properties)
- **Components** — Reusable components in `src/components/`

The Studio can be built as a static export (`next build && next export`) and served from any static hosting or bundled with your deployment.
