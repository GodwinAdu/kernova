# NP-005: Tool Protocol

**Version:** 0.1.0  
**Status:** Draft

## Abstract

Defines how tools (functions that agents can call) are registered, discovered, and executed.

## Tool Definition

```json
{
  "id": "plugin_id:tool_name",
  "name": "calculate",
  "description": "Evaluate a mathematical expression",
  "parameters": {
    "type": "object",
    "properties": {
      "expression": { "type": "string", "description": "Math expression to evaluate" }
    },
    "required": ["expression"]
  }
}
```

## Operations

### List Tools

```
GET /tools

→ 200 OK
{ "tools": [...] }
```

### Execute Tool

```
POST /tools/{id}/execute
{ "expression": "42 * 3.14" }

→ 200 OK
{ "result": { "expression": "42 * 3.14", "result": 131.88 } }
```

## Tool Calling Flow (with LLM)

```
1. Agent receives intent
2. LLM called with tool definitions
3. LLM responds with tool_call: { name: "calculate", arguments: { expression: "42 * pi" } }
4. Runtime executes tool
5. Result fed back to LLM as tool message
6. LLM produces final answer (or calls another tool)
7. Loop until LLM responds with text (max 10 iterations)
```

## Plugin Registration

Tools are grouped into plugins:

```json
{
  "id": "math",
  "name": "Math Tools",
  "version": "1.0.0",
  "type": "tool",
  "tools": [
    { "id": "calculate", "name": "calculate", "description": "...", "parameters": {...}, "execute": "..." }
  ]
}
```

## Middleware

Plugins can register middleware that intercepts the intent pipeline:

```json
{
  "stage": "before | after",
  "priority": 1,
  "handler": "function(context) → context"
}
```

Middleware can halt execution by setting `context.halt = true`.
