# Spec: Nexus Studio (Web Dashboard)

## Summary

A web UI embedded in the dev runtime that provides visual inspection of:
- Intents (submit, view results, timeline)
- Agents (list, inspect, metrics)
- Events (real-time stream, query, timeline)
- Memory (browse layers, search, inspect)
- System status (providers, usage, health)

## Architecture

```
nexus dev
   ↓
DevServer (kernel + watcher)
   ↓
StudioServer (HTTP API + static files)
   ├── GET /api/status          → Runtime status
   ├── GET /api/agents          → List agents
   ├── GET /api/events          → Query events
   ├── GET /api/events/stream   → SSE real-time stream
   ├── GET /api/memory          → Query memories
   ├── POST /api/intents        → Submit an intent
   ├── GET /api/intents/:id     → Get intent result
   └── GET /                    → Web UI (single-page app)
```

## Key Decisions

1. **Embedded HTTP server** — Part of `nexus dev`, no separate process
2. **No framework** — Native Node.js `http` module (zero deps for basic API)
3. **Server-Sent Events** — Real-time event streaming to browser
4. **Self-contained HTML** — Single HTML file with inline JS/CSS (no build step)
5. **Port 4200** — Default, configurable

## Success Criteria

- [ ] Opens in browser at localhost:4200
- [ ] Shows real-time events as they happen
- [ ] Can submit intents from the UI
- [ ] Can browse and search memory
- [ ] Can view agent list and metrics
- [ ] Works without npm install in the studio package
