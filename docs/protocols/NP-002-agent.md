# NP-002: Agent Protocol

**Version:** 0.1.0  
**Status:** Draft

## Abstract

Defines how agents are registered, discovered, selected, and communicated with. An agent is a capability-bearing entity that fulfills intents.

## Agent Definition

```json
{
  "id": "agent_uuid",
  "type": "agent_definition",
  "name": "assistant",
  "description": "A helpful assistant",
  "capabilities": [
    { "id": "general", "name": "General", "description": "...", "confidence": 0.9 }
  ],
  "tools": [
    { "toolId": "search", "name": "Search", "purpose": "Find information", "required": false }
  ],
  "models": [
    { "provider": "openai", "model": "gpt-4o", "purpose": "reasoning" }
  ],
  "instructions": "System prompt...",
  "permissions": [
    { "resource": "memory", "actions": ["read", "write"] }
  ],
  "config": {
    "temperature": 0.7,
    "maxTokens": 4096,
    "timeoutMs": 30000,
    "retries": { "maxAttempts": 3, "backoffMs": 1000 }
  }
}
```

## Operations

### Register Agent

```
POST /agents
{ "name": "...", "description": "...", "capabilities": [...], "instructions": "..." }

→ 201 Created
{ "id": "agent_uuid", ... }
```

### List Agents

```
GET /agents

→ 200 OK
{ "agents": [...] }
```

### Agent Communication (Delegation)

```
POST /agents/{name}/delegate
{ "goal": "...", "parentIntentId": "...", "context": {} }

→ 200 OK
{ "success": true, "response": "...", "intentId": "...", "durationMs": 123 }
```

## Agent States

```
idle → thinking → executing → idle
                ↘ waiting → executing
                → error → idle
                → offline
```

## Events Emitted

- `agent.registered`
- `agent.executing`
- `agent.completed`
- `agent.delegation.started`
- `agent.delegation.completed`
- `agent.tool_call`
