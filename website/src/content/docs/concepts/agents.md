---
title: Agents
description: Understand Kernova agents — intelligent entities that fulfill intents.
---

# Agents

An agent in Kernova is **not just a wrapper around an LLM**. It's a structured entity with a name, capabilities, tools, memory access, and the ability to collaborate with other agents.

## What Makes a Kernova Agent Different?

| Raw LLM call | Kernova Agent |
|-------------|-------------|
| Stateless | Has memory (persists across calls) |
| Can't do anything | Has tools (can call functions) |
| Works alone | Can delegate to other agents |
| No permissions | Has scoped access control |
| No tracking | Every action emitted as an event |
| One prompt = one response | Loops with tools until task is done |

## Creating Agents

### Minimal agent (LLM handles everything)

```typescript
app.agent('assistant', {
  instructions: 'You are a helpful, concise coding assistant.',
});
```

That's it. The LLM does the reasoning. If you've registered tools, the agent will use them automatically. If there's memory, it's included in context automatically.

### Agent with custom logic

When you need control over the execution flow:

```typescript
app.agent('data-analyst', {
  instructions: 'You analyze data and produce insights.',
  
  async execute(intent, context, tools) {
    // Step 1: Get relevant data
    const data = await tools.useTool('database:query', { 
      sql: 'SELECT * FROM metrics WHERE date > NOW() - INTERVAL 7 DAYS' 
    });

    // Step 2: Ask the LLM to analyze it
    const analysis = await tools.complete(`
      Analyze this data and identify trends:
      ${JSON.stringify(data)}
      
      User's question: ${intent.goal}
    `);

    // Step 3: Remember the analysis
    await tools.remember(`Analysis result: ${analysis.slice(0, 200)}`, 'session');

    return {
      success: true,
      summary: analysis,
      evidence: {
        sources: [{ type: 'document', ref: 'metrics-db', label: 'Metrics Database', consultedAt: new Date().toISOString() }],
        confidence: 0.85,
        reasoning: 'Queried last 7 days of metrics and analyzed trends',
      },
      durationMs: Date.now() - startTime,
    };
  },
});
```

## Agent Tools (what agents can do)

Every agent executor receives a `tools` object with these capabilities:

### Communication with LLMs

```typescript
// Simple text completion
const text = await tools.complete('Explain quantum computing');

// Streaming (token by token)
for await (const token of tools.stream('Write a story')) {
  process.stdout.write(token);
}

// With tool calling (LLM decides which tools to use)
const answer = await tools.completeWithTools('What is the weather in London?');
```

### Memory

```typescript
// Store
await tools.remember('Important finding: revenue is up 23%', 'session');

// Recall
const memories = await tools.recall('revenue data');
// Returns array of matching memory content strings
```

### Plugin tools

```typescript
// Execute a registered tool directly
const result = await tools.useTool('math:calculate', { expression: '42 * pi' });

// See what tools are available
const available = tools.listTools();
```

### Multi-agent collaboration

```typescript
// Delegate to a specific agent
const research = await tools.delegate('researcher', 'Find papers about RAG');

// Ask any agent (kernel picks the best one)
const answer = await tools.ask('What is the exchange rate for USD/EUR?');

// Try all agents, return first success
const result = await tools.broadcast('Summarize this document');
```

### Events

```typescript
// Emit a custom event (tracked in the timeline)
tools.emit('analysis.started', { dataset: 'sales_q2' });

// Log (appears in console during development)
tools.log('Processing step 3 of 5...');
```

## Agent Selection

When you submit an intent, the kernel scores all agents and picks the best one. Scoring considers:

1. **Capability confidence** — Higher confidence = better score
2. **Description relevance** — Keywords in the goal matching the agent's description
3. **Intent type match** — Capability names matching the intent type

```typescript
// This agent scores high for "query" intents about "code"
defineAgent({
  name: 'code-expert',
  capabilities: [
    { id: 'query', name: 'Code Questions', description: 'Answers coding questions', confidence: 0.95 },
  ],
});
```

## Agent States

```
idle        → Agent is ready for work
executing   → Agent is processing an intent
waiting     → Agent is waiting (e.g., for approval)
error       → Agent encountered a problem
offline     → Agent is not available
```

## File-Based Agents (CLI Projects)

When using `Kernova dev`, agents live in `src/agents/`:

```typescript
// src/agents/reviewer.ts
import { defineAgent } from '@kernova/core';

export default defineAgent({
  name: 'reviewer',
  description: 'Reviews pull requests for code quality',
  capabilities: [
    { id: 'code-review', name: 'Code Review', description: 'Reviews code', confidence: 0.9 },
  ],
  tools: [],
  instructions: `You are a code reviewer. Focus on:
- Security vulnerabilities
- Performance issues  
- Logic errors
Be constructive. Suggest fixes, don't just point out problems.`,
});
```

Save this file → the agent hot-reloads automatically. No restart needed.

## Best Practices

1. **Write clear instructions** — The better your instructions, the better the agent performs
2. **Declare capabilities accurately** — Helps the kernel route intents correctly
3. **Use tools for actions** — Don't ask the LLM to "pretend" to do something. Give it a real tool.
4. **Keep agents focused** — One agent = one responsibility. Delegate for complex tasks.
5. **Return evidence** — Always explain how the agent reached its conclusion
