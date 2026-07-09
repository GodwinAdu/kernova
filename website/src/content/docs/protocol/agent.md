---
title: "NP-002: Agent Protocol"
description: Defines agent registration, selection, and communication.
---

# NP-002: Agent Protocol

**Version:** 0.1.0 | **Status:** Draft

Agents are capability-bearing entities that fulfill intents.

## Agent Definition

```json
{
  "name": "assistant",
  "description": "A helpful assistant",
  "capabilities": [{ "id": "general", "confidence": 0.9 }],
  "instructions": "System prompt...",
  "permissions": [{ "resource": "memory", "actions": ["read", "write"] }]
}
```

## Operations

- `POST /agents` — Register
- `GET /agents` — List
- `POST /agents/{name}/delegate` — Delegate task

## States

`idle → executing → idle | waiting | error | offline`
