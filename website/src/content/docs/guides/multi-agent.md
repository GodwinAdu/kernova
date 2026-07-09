---
title: Multi-Agent Systems
description: Build systems where specialized agents collaborate, delegate, and orchestrate.
---

# Multi-Agent Systems

A single agent can only do so much. Real-world applications need **specialized agents that collaborate** — a researcher that finds information, a writer that creates content, a reviewer that checks quality.

## Why Multiple Agents?

| Single agent | Multiple agents |
|-------------|----------------|
| One massive prompt tries to do everything | Each agent has focused instructions |
| Gets confused with complex tasks | Each agent excels at its specialty |
| Can't be improved incrementally | Improve one agent without affecting others |
| No separation of concerns | Clear responsibility per agent |

## The Three Patterns

### 1. Delegation — "Hey researcher, find this for me"

One agent explicitly asks another to handle a sub-task:

```typescript
app.agent('researcher', {
  instructions: 'You find accurate information. Always cite your sources.',
});

app.agent('writer', {
  instructions: 'You write engaging content based on research provided.',
});

app.agent('editor', {
  instructions: 'You coordinate research and writing to produce articles.',
  async execute(intent, context, tools) {
    // Step 1: Get research from the researcher
    const research = await tools.delegate('researcher', `Research: ${intent.goal}`);
    
    if (!research.success) {
      return { success: false, summary: `Research failed: ${research.response}`, ... };
    }

    // Step 2: Get the writer to produce an article
    const article = await tools.delegate('writer', `Write about: ${research.response}`);
    
    return {
      success: true,
      summary: article.response,
      evidence: {
        sources: [
          { type: 'memory', ref: research.intentId, label: 'Research phase', consultedAt: new Date().toISOString() },
          { type: 'memory', ref: article.intentId, label: 'Writing phase', consultedAt: new Date().toISOString() },
        ],
        confidence: 0.9,
        reasoning: 'Coordinated research → writing pipeline',
      },
      durationMs: research.durationMs + article.durationMs,
    };
  },
});
```

**What `delegate` returns:**

```typescript
const result = await tools.delegate('researcher', 'Find papers about RAG');
// {
//   success: true,
//   response: "I found 3 recent papers about RAG...",
//   agentName: 'researcher',
//   durationMs: 2340,
//   intentId: 'intent_abc123',
// }
```

### 2. Ask — "Someone handle this"

Let the kernel pick the best agent:

```typescript
const answer = await tools.ask('What is the weather in London?');
// Kernel scores all agents, picks the one with best matching capabilities
```

Useful when you don't know (or care) which specific agent handles it.

### 3. Broadcast — "Anyone who can handle this, go"

Try all agents, return the first successful response:

```typescript
const result = await tools.broadcast('Translate this to French: Hello world');
// Tries each agent in order until one succeeds
```

## Real-World Example: Code Review Pipeline

```typescript
// Specialist: finds security issues
app.agent('security-reviewer', {
  instructions: 'Focus exclusively on security vulnerabilities. OWASP top 10.',
  capabilities: [{ id: 'security', name: 'Security', description: 'Security review', confidence: 0.95 }],
});

// Specialist: finds performance issues
app.agent('performance-reviewer', {
  instructions: 'Focus on performance. Big-O, memory leaks, unnecessary allocations.',
  capabilities: [{ id: 'performance', name: 'Performance', description: 'Performance review', confidence: 0.9 }],
});

// Coordinator: combines reviews
app.agent('lead-reviewer', {
  instructions: 'You coordinate code reviews from multiple specialists.',
  capabilities: [{ id: 'review', name: 'Code Review', description: 'Full code review', confidence: 1 }],
  async execute(intent, context, tools) {
    // Run both reviews in parallel (via sequential delegation)
    const security = await tools.delegate('security-reviewer', intent.goal);
    const performance = await tools.delegate('performance-reviewer', intent.goal);
    
    // Synthesize into final review
    const synthesis = await tools.complete(`
      Combine these reviews into a single report:
      
      Security findings: ${security.response}
      Performance findings: ${performance.response}
      
      Format as a numbered list of issues, sorted by severity.
    `);
    
    return { success: true, summary: synthesis, ... };
  },
});
```

## Depth Limiting

To prevent infinite recursion (Agent A delegates to Agent B which delegates to Agent A...), delegation depth is limited to **5 levels** by default.

When the limit is reached:
```typescript
const result = await tools.delegate('self-referencing-agent', 'do it again');
// result.success = false
// result.response = "Delegation depth limit (5) reached. Cannot delegate further."
```

## Events & Debugging

Every delegation emits events:

```
agent.delegation.started  → { parentIntentId, subIntentId, targetAgent, depth }
agent.delegation.completed → { parentIntentId, subIntentId, targetAgent, success, durationMs }
agent.delegation.failed   → { parentIntentId, subIntentId, targetAgent, error }
```

In Studio, you can trace the full delegation chain visually.

## Memory Sharing

When Agent A delegates to Agent B:
- Agent B has access to the **same memory layers** as Agent A
- Agent B can store memories that Agent A can later recall
- The computed context includes memories from the same owner

This means specialists can build on each other's findings:

```typescript
// Researcher stores a finding
await tools.remember('Found key paper: "RAG Architecture" (2025)', 'session');

// Later, writer can recall it
const findings = await tools.recall('RAG papers');
```

## Best Practices

1. **Give each agent a clear specialty** — "Security reviewer" not "code reviewer that also does security"
2. **Use delegation for sequential tasks** — Research → Write → Review
3. **Use broadcast for redundancy** — Try multiple approaches, take the first that works
4. **Monitor delegation depth** — If you're hitting 4-5 levels, rethink your architecture
5. **Register specialists first** — So they're available when coordinators delegate to them
6. **Check `result.success`** — Delegation can fail; always handle the error case
