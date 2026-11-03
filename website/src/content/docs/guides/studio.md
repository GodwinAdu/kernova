---
title: Kernova Studio
description: Visual developer dashboard for managing agents, inspecting events, searching memory, and monitoring the runtime.
---

Kernova Studio is a visual developer dashboard that connects to your running Kernova Gateway for real-time monitoring and management. Think of it as your control center — every agent, event, memory entry, and metric is visible and interactive.

## Quick Start

### Option 1: CLI (Recommended)

```bash
# Terminal 1: run your agents with the Gateway on port 3000
export KERNOVA_API_KEY=pick-a-long-random-token
kernova serve --config ./agents --port 3000

# Terminal 2: launch Studio with the same token
export KERNOVA_API_KEY=pick-a-long-random-token
kernova studio
```

Studio opens at `http://localhost:4200`. Your browser talks only to Studio; Studio forwards its API calls to the Gateway and adds the token, so the token never reaches the page. Pass `--token` instead of setting `KERNOVA_API_KEY`, and `--gateway <url>` for a Gateway elsewhere.

If your app starts the Gateway itself (`await kernel.gateway.start({ port: 3000, auth: { tokens: [token] } })`), run `kernova studio --token <token>`.

### Option 2: Development Mode

If you've cloned the Kernova monorepo and want to customize Studio:

```bash
cd packages/studio
NEXT_PUBLIC_KERNOVA_URL=http://localhost:3000 npm run dev
```

### Option 3: Custom Gateway URL

Point Studio at any Kernova Gateway — local, staging, or production:

```bash
kernova studio --gateway https://staging.myapp.com --token "$STAGING_GATEWAY_TOKEN"
kernova studio --port 8080 --gateway http://192.168.1.50:3000 --token "$GATEWAY_TOKEN"
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

Studio is a **local client** that polls the Gateway API for reads, and sends targeted commands for writes (creating workflows, managing identities, submitting intents). All data stays on your machine unless you point it at a remote Gateway.

## Pages

### Dashboard

The landing page shows:
- **Connection status** — green when Gateway is reachable
- **Stat cards** — active agents, pending tasks, token usage, latency, uptime
- **Intent submission** — send goals directly to the runtime from the UI and see results

### Agents

Lists all registered agents with their model, capabilities, and status. You can submit intents targeted at specific agents and see the result inline.

### Events

Real-time event stream that auto-refreshes every 2 seconds. Filter by category (intent, agent, tool, memory, workflow, system) and severity. Click any event to expand its full data payload.

### Memory

Semantic search across all memory layers: working, session, longterm, organizational, global. Results are ranked by relevance score with layer badges.

### Monitoring

Health banner, request metrics, token breakdown (input/output/context/tool), and latency stats. Auto-refreshes every 5 seconds.

### Logs

Terminal-style log viewer that formats events as structured log entries with level, source, message, and trace ID. Filter by level (debug, info, warn, error).

### Plugins

Shows installed plugins, their versions, and the tools they provide.

### Workflows

Lists registered workflow definitions. Click **"+ New Workflow"** to create a workflow with a name and description — it's registered in the kernel immediately.

### Context

Enter an intent ID to visualize how the context window is allocated across memory layers — shows token counts per layer with a visual bar chart.

### Deploy

Displays running Kernova instances with their environment, version, and status. **Restart** and **Retry** buttons send signals to the runtime.

### Permissions

Full identity and API key management:
- **Add Identity** — create users, agents, or service accounts with roles
- **Generate API Key** — create a key for any identity (the full key is shown once on creation)
- **Revoke Key** — permanently disable an API key with confirmation

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KERNOVA_API_KEY` | — | Gateway token for `kernova studio` (same as `--token`) |
| `NEXT_PUBLIC_KERNOVA_URL` | `http://localhost:3000` | Gateway URL for `npm run dev` in `packages/studio` |
| `NEXT_PUBLIC_KERNOVA_TOKEN` | — | Gateway token for `npm run dev` (visible in the browser; local use only) |

### CLI Options

```bash
kernova studio [options]

Options:
  -p, --port <number>     Studio UI port (default: 4200)
  -g, --gateway <url>     Gateway API URL (default: http://localhost:3000)
  -t, --token <token>     Gateway token (default: $KERNOVA_API_KEY)
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
| POST | `/v1/workflows` | Create a new workflow definition |
| GET | `/v1/plugins` | Installed plugins and tools |
| POST | `/v1/plugins/install` | Install a plugin |
| GET | `/v1/permissions/identities` | Registered identities |
| POST | `/v1/permissions/identities` | Create a new identity |
| GET | `/v1/permissions/keys` | Configured API keys |
| POST | `/v1/permissions/keys` | Generate a new API key |
| DELETE | `/v1/permissions/keys/:id` | Revoke an API key |
| GET | `/v1/logs?level=&limit=` | Events formatted as log entries |
| GET | `/v1/deployments` | Running instances |
| POST | `/v1/deployments/:id/restart` | Send restart signal |
| GET | `/v1/context/:intentId` | Context layer stats |
| POST | `/v1/intents` | Submit a new intent |
| POST | `/v1/chat/completions` | OpenAI-compatible chat endpoint |

## Offline Behavior

When the Gateway is offline, Studio shows:
- A warning banner on the Dashboard
- Empty states on all pages with helpful messages
- The connection indicator in the sidebar turns red

Studio continues checking every 5 seconds. When the Gateway comes back, data loads automatically — no refresh needed.

## Production Use

How Studio stays safe:

1. **Token stays on the server** — `kernova studio` keeps the Gateway token in its own process and adds it to the requests it forwards. The page never sees it
2. **Local only** — Studio listens on `127.0.0.1`, so other machines can't reach it (or the Gateway through it)
3. **No cross-site use** — Studio only forwards requests sent by its own page (a custom header other sites can't send) to `localhost` host names (no DNS rebinding)
4. **Remote Gateways** — Point `--gateway` at a Gateway behind HTTPS and pass its token with `--token`

### Running the Studio app in development mode

`npm run dev` in `packages/studio` talks to the Gateway directly from the browser, so the Gateway must allow Studio's origin:

```typescript
const kernel = new KernovaKernel({
  environment: 'development',
  gateway: { port: 3000, auth: { allowAnonymous: true }, cors: ['http://localhost:4200'] },
});
await kernel.start();
await kernel.gateway.start();
```

Or keep the token and set `NEXT_PUBLIC_KERNOVA_TOKEN` (it's visible in the browser, so only for local development) together with `cors: ['http://localhost:4200']`.

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
