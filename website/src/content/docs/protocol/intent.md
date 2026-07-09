---
title: "NP-001: Intent Protocol"
description: Defines the Intent object — the fundamental unit of work.
---

# NP-001: Intent Protocol

**Version:** 0.1.0 | **Status:** Draft

The Intent is the fundamental unit of work in Kernova. It replaces prompts with a structured, trackable, governable object.

## Intent Object

```json
{
  "id": "intent_uuid",
  "goal": "Summarize the quarterly report",
  "intentType": "query | action | workflow | creation | analysis | monitoring | automation",
  "priority": "critical | high | medium | low",
  "status": "pending | planning | executing | waiting | reviewing | completed | failed | cancelled",
  "confidence": 0.0-1.0,
  "source": { "actorId": "...", "channel": "user | agent | workflow | schedule | event" },
  "constraints": [{ "type": "budget", "description": "...", "hard": true }],
  "risk": { "level": "low", "factors": [], "reversible": true },
  "result": { "success": true, "summary": "...", "evidence": {...}, "durationMs": 1234 }
}
```

## Operations

- `POST /intents` — Submit
- `GET /intents/{id}` — Get result
- `DELETE /intents/{id}` — Cancel

## Lifecycle

`pending → planning → executing → completed/failed`

## Events

`intent.created`, `intent.planning`, `intent.executing`, `intent.completed`, `intent.failed`, `intent.cancelled`
