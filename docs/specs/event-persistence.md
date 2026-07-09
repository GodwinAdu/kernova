# Spec: Event Persistence (SQLite)

> Written BEFORE implementation, as required by CONTRIBUTING.md.

## Summary

Persist all Nexus events to a local SQLite database so that:
- Event timelines survive process restarts
- Developers can query historical events
- The system supports debugging, auditing, and replay

## Problem

Currently, events only exist in memory. When the process stops, all history is lost. For a system built on "Event Native" architecture, this makes events useless in practice.

## Design

### Storage Architecture

```
EventBus
   ↓ (publish)
┌───────────────────────────┐
│  In-memory subscribers    │ ← Real-time listeners (fast)
└───────────────────────────┘
   ↓ (async persist)
┌───────────────────────────┐
│  SQLite (nexus.db)        │ ← Durable storage (survives restart)
└───────────────────────────┘
```

### Key Decisions

1. **SQLite** — Zero-config, single-file, battle-tested, works everywhere
2. **Async persistence** — Events are published immediately, written to disk async
3. **WAL mode** — Write-Ahead Logging for concurrent reads during writes
4. **Indexed by subject, type, time** — Fast timeline queries
5. **JSON data column** — Event payloads stored as JSON for flexibility
6. **Auto-migration** — Schema created automatically on first run

### Schema

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  data TEXT NOT NULL,  -- JSON
  metadata TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_subject ON events(subject_id, timestamp);
CREATE INDEX idx_events_type ON events(event_type, timestamp);
CREATE INDEX idx_events_correlation ON events(correlation_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

### API

```typescript
// Query events
const timeline = await kernel.events.getTimeline(intentId);
const recent = await kernel.events.query({ type: 'intent.*', limit: 50 });
const byActor = await kernel.events.query({ actorId: agentId, after: '2026-07-01' });
```

### File Location

- Development: `./nexus-data/nexus.db` (project-local)
- Configurable via `nexus.config.json`

## Success Criteria

- [ ] Events persist across process restarts
- [ ] Timeline queries work after restart
- [ ] Performance: >10,000 events/second write throughput
- [ ] Zero-config: database created automatically
- [ ] Backward compatible: in-memory mode still works
