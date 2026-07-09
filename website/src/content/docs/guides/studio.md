---
title: Nexus Studio
description: The web dashboard for inspecting and debugging your intelligent systems.
---

# Nexus Studio

Studio is a **real-time web dashboard** that shows you exactly what your agents are doing — events flowing, memories being stored, intents being processed. It starts automatically with `nexus dev`.

## Accessing Studio

```bash
nexus dev
# → Studio: http://localhost:4200
```

Open it in your browser. You'll see:

- **Event stream** — Real-time feed of everything happening in the runtime
- **Memory browser** — Search and inspect all memory layers
- **Agent list** — See registered agents and their capabilities
- **Intent submission** — Test intents directly from the browser
- **System status** — Provider info, token usage, memory stats

## Why You'll Love It

### Debugging without console.log

Instead of sprinkling `console.log` everywhere, just watch Studio. Every intent lifecycle step, every tool call, every memory store appears in real-time.

### Understanding agent behavior

"Why did it call that tool?" — Look at the event stream. You'll see:
```
intent.created → intent.planning → intent.executing → agent.tool_call → intent.completed
```

### Testing without writing code

Submit intents directly from the UI:
1. Type a goal in the "Submit Intent" box
2. Click Submit
3. See the result (with timing and evidence)

## API Endpoints

Studio exposes a full REST API. Use it from your own tools, scripts, or dashboards:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (always public) |
| GET | `/api/status` | Runtime status |
| GET | `/api/agents` | List registered agents |
| GET | `/api/events?type=intent.*&limit=50` | Query events |
| GET | `/api/events/stream` | Server-Sent Events (real-time) |
| GET | `/api/memory?q=search+term` | Search memories |
| POST | `/api/intents` | Submit an intent |
| GET | `/api/workflows` | View workflows + pending approvals |
| GET | `/api/identity/users` | List identities |
| GET | `/api/identity/keys` | List API keys (safe metadata) |
| POST | `/api/identity/keys` | Create an API key |

### Example: Submit intent via API

```bash
curl -X POST http://localhost:4200/api/intents \
  -H "Content-Type: application/json" \
  -d '{"goal": "What is 2+2?", "type": "query"}'
```

### Example: Stream events

```bash
curl -N http://localhost:4200/api/events/stream
# data: {"eventType":"intent.created","data":{...}}
# data: {"eventType":"intent.completed","data":{...}}
```

## Production Mode

In production, enable authentication and HTTPS:

```typescript
new StudioServer(kernel, {
  port: parseInt(process.env.PORT || '4200'),
  host: '0.0.0.0',        // Accept external connections
  requireAuth: true,       // All /api/ routes need Bearer token
  tlsCert: './cert.pem',   // HTTPS
  tlsKey: './key.pem',
});
```

Access with: `Authorization: Bearer nxs_your_api_key`

The `/health` endpoint is always public — use it for load balancer probes.

## Custom Dashboards

Because Studio exposes a standard REST API + SSE, you can build your own UI on top:

```typescript
// Connect to real-time events
const source = new EventSource('http://localhost:4200/api/events/stream');
source.onmessage = (e) => {
  const event = JSON.parse(e.data);
  updateDashboard(event);
};
```
