# NP-004: Event Protocol

**Version:** 0.1.0  
**Status:** Draft

## Abstract

Defines the event system — how state changes are recorded, streamed, and queried. Kernova is Event Native: every object has a timeline.

## Event Object

```json
{
  "id": "evt_uuid",
  "eventType": "intent.created",
  "category": "intent | agent | workflow | memory | identity | system | tool | model | governance",
  "severity": "debug | info | warn | error | critical",
  "timestamp": "ISO8601",
  "subjectId": "uuid (what this event is about)",
  "subjectType": "intent | agent | memory | ...",
  "actorId": "uuid (who caused this event)",
  "correlationId": "uuid (trace related events)",
  "causationId": "uuid (which event caused this one) | null",
  "data": {},
  "metadata": {
    "schemaVersion": "1.0.0",
    "source": "kernel | agent-registry | ...",
    "environment": "development | staging | production",
    "traceId": "...",
    "spanId": "..."
  }
}
```

## Operations

### Query Events

```
GET /events?type=intent.*&limit=50&order=desc

→ 200 OK
{ "events": [...], "total": 50 }
```

### Get Timeline

```
GET /events/timeline/{subjectId}

→ 200 OK
{ "events": [...] }
```

### Stream Events (SSE)

```
GET /events/stream
Accept: text/event-stream

→ 200 OK
data: {"id":"evt_...","eventType":"intent.created",...}

data: {"id":"evt_...","eventType":"intent.completed",...}
```

### Get Correlated Events

```
GET /events/correlated/{correlationId}

→ 200 OK
{ "events": [...] }
```

## Event Categories

| Category | Events |
|---|---|
| `intent` | created, planning, executing, completed, failed, cancelled |
| `agent` | registered, executing, completed, delegation.*, tool_call |
| `memory` | stored, queried, deleted |
| `identity` | registered, permission.denied, role.assigned |
| `workflow` | defined, started, completed, failed, step.*, approval.* |
| `model` | completed, fallback |
| `governance` | budget.exceeded |
| `system` | kernel.started, kernel.stopping |
