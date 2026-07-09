---
title: "NP-004: Event Protocol"
description: Event-native architecture specification.
---

# NP-004: Event Protocol

**Version:** 0.1.0 | **Status:** Draft

Every state change emits a structured event.

## Event Object

```json
{
  "id": "evt_uuid",
  "eventType": "intent.completed",
  "category": "intent",
  "severity": "info",
  "timestamp": "ISO8601",
  "subjectId": "uuid",
  "actorId": "uuid",
  "correlationId": "uuid",
  "data": {}
}
```

## Operations

- `GET /events?type=intent.*` — Query
- `GET /events/timeline/{id}` — Object timeline
- `GET /events/stream` — SSE real-time
- `GET /events/correlated/{id}` — Trace flow
