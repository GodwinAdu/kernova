# Spec: Tool Calling (Agent ↔ Plugin Integration)

## Summary

Wire the model's function-calling capability to the plugin system so that agents can invoke tools (search, fetch, calculate, call APIs) during LLM reasoning loops.

## Problem

Currently agents can only call `tools.complete(prompt)` which returns raw text. They can't:
- Ask the LLM to decide which tool to use
- Execute plugin tools based on the LLM's decision
- Feed tool results back into the LLM for further reasoning

This is what makes agents actually powerful — they reason about which tool to use, use it, and incorporate the results.

## Design

### Flow

```
Intent submitted
   ↓
Agent gets intent + context + available tools
   ↓
LLM called with tool definitions (function calling)
   ↓
LLM responds with either:
   a) Text response → done
   b) Tool call request → execute tool → feed result back → loop
   ↓
Final response returned with evidence
```

### Key Decisions

1. **Loop-based execution** — LLM may call multiple tools before responding
2. **Max iterations** — Prevent infinite tool-calling loops (default: 10)
3. **Tool discovery** — Agents declare which tools they can access
4. **Format agnostic** — Works with OpenAI, Anthropic, Gemini tool formats
5. **Result as evidence** — Tool call results are recorded as evidence sources

## Success Criteria

- [ ] Agent can call plugin tools during reasoning
- [ ] LLM decides which tool to use based on the goal
- [ ] Tool results fed back for multi-turn reasoning
- [ ] Works with OpenAI function calling format
- [ ] Evidence trail includes tool invocations
