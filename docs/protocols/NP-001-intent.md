# NP-001: Intent Protocol

**Version:** 0.1.0  
**Status:** Draft

## Abstract

Defines the Intent object — the fundamental unit of work in the Kernova Protocol. An intent represents a structured goal that can be submitted, tracked, and fulfilled.

## Intent Object

```json
{
  "id": "intent_uuid",
  "version": "1.0.0",
  "type": "intent",
  "goal": "Summarize the quarterly report",
  "intentType": "query | action | workflow | creation | analysis | monitoring | automation",
  "priority": "critical | high | medium | low",
  "status": "pending | planning | executing | waiting | reviewing | completed | failed | cancelled",
  "confidence": 0.0-1.0,
  "source": {
    "actorId": "user_uuid",
    "channel": "user | agent | workflow | schedule | event"
  },
  "constraints": [
    { "type": "budget | time | permission | quality | security", "description": "...", "hard": true }
  ],
  "risk": {
    "level": "none | low | medium | high | critical",
    "factors": ["..."],
    "reversible": true
  },
  "dependencies": ["intent_uuid"],
  "parentId": "intent_uuid | null",
  "temporal": {
    "deadline": "ISO8601 | null",
    "scheduledAt": "ISO8601 | null",
    "expiresAt": "ISO8601 | null"
  },
  "result": {
    "success": true,
    "summary": "...",
    "data": {},
    "evidence": {
      "sources": [{ "type": "...", "ref": "...", "label": "..." }],
      "confidence": 0.0-1.0,
      "reasoning": "..."
    },
    "durationMs": 1234
  },
  "owner": "identity_uuid",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "metadata": {}
}
```

## Operations

### Submit Intent

```
POST /intents
Content-Type: application/json

{ "goal": "...", "intentType": "query", "priority": "medium" }

→ 201 Created
{ "id": "intent_uuid", "status": "pending", ... }
```

### Get Intent

```
GET /intents/{id}

→ 200 OK
{ "id": "...", "status": "completed", "result": { ... } }
```

### Cancel Intent

```
DELETE /intents/{id}

→ 200 OK
{ "id": "...", "status": "cancelled" }
```

## Intent Lifecycle

```
pending → planning → executing → completed
                  ↘ waiting → executing
                  ↘ reviewing → completed
                  → failed
                  → cancelled
```

## Events Emitted

- `intent.created`
- `intent.planning`
- `intent.executing`
- `intent.waiting`
- `intent.completed`
- `intent.failed`
- `intent.cancelled`
