---
title: "NP-005: Tool Protocol"
description: Tool registration, discovery, and execution.
---

# NP-005: Tool Protocol

**Version:** 0.1.0 | **Status:** Draft

Tools are functions agents can call during reasoning.

## Tool Definition

```json
{
  "id": "plugin:tool_name",
  "name": "calculate",
  "description": "Evaluate a math expression",
  "parameters": { "type": "object", "properties": {...} }
}
```

## Operations

- `GET /tools` — List available tools
- `POST /tools/{id}/execute` — Execute a tool

## Tool Calling Flow

1. LLM called with tool definitions
2. LLM responds with `tool_call`
3. Runtime executes tool
4. Result fed back to LLM
5. Loop until text response (max 10 iterations)
