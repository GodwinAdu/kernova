# ADR-008: SQLite for Event Persistence

## Status
Accepted

## Date
July 8, 2026

## Context

Nexus is Event Native — every state change emits an event. For this to be useful beyond real-time subscribers, events must survive process restarts. We need a persistence layer that is:
- Zero-config (works on first run)
- Fast (>10k events/second)
- Reliable (no data loss)
- Queryable (filter by type, subject, time, correlation)
- Portable (single file, works everywhere Node.js runs)

## Decision

Use SQLite via `better-sqlite3` for event persistence.

### Architecture

```
EventBus.publish(event)
   ├── In-memory subscribers (real-time, fast)
   └── EventStore.append(event) (batched writes to SQLite)
```

### Key Properties

- **WAL mode** — Concurrent reads during writes
- **Batched inserts** — Buffer events, flush every 100 or every 1 second
- **Transaction-based flush** — All-or-nothing writes
- **Indexed** — subject_id, event_type, correlation_id, timestamp
- **JSON columns** — Flexible event data without schema migrations
- **Auto-migration** — Schema created on first run

### Configuration

```typescript
new NexusKernel({
  environment: 'development',
  dataDir: './nexus-data',  // Where nexus.db lives
  ephemeral: false,         // Set true to disable persistence
});
```

## Consequences

### Easier
- Events survive restarts (debugging, auditing)
- Timeline queries across process lifecycles
- Future: replay events for state reconstruction
- Future: export events for analytics

### Harder
- Adds a native dependency (better-sqlite3)
- Database file grows over time (need future retention policy)
- Slightly more complex EventBus (dual-mode)

## Performance

Measured in development:
- Single event write: <1ms (buffered)
- Batch flush (100 events): ~5ms
- Timeline query (100 results): ~2ms
- Database created in: ~10ms
