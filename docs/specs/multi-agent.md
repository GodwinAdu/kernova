# Spec: Multi-Agent Coordination

## Summary

Enable agents to communicate, delegate, and collaborate. An agent should be able to ask another agent to do something and use the result.

## Design

### Patterns

1. **Delegation** — Agent A asks Agent B to handle a sub-task
2. **Orchestration** — A coordinator agent routes work to specialist agents
3. **Collaboration** — Multiple agents contribute to a shared goal
4. **Supervision** — A supervisor agent reviews work of other agents

### API (in agent executor)

```typescript
// Delegate to another agent
const review = await tools.delegate('code-reviewer', 'Review this function...');

// Ask any agent (kernel picks the best one)
const answer = await tools.ask('What is the current exchange rate for USD/EUR?');

// Broadcast to all agents (returns first response)
const result = await tools.broadcast('Summarize this document');
```

### Architecture

```
Agent A (executor)
   ↓ tools.delegate('agent-b', goal)
Kernel creates sub-intent (parent = A's intent)
   ↓
Agent B executes sub-intent
   ↓
Result returned to Agent A
```

### Key Decisions

1. **Sub-intents** — Delegation creates child intents with parent tracking
2. **Max depth** — Prevent infinite delegation (default: 5 levels)
3. **Event trail** — All delegations logged for debugging
4. **Shared memory** — Delegated agents can access parent's working memory

## Success Criteria

- [ ] Agent can delegate to a named agent
- [ ] Agent can ask (kernel selects agent)
- [ ] Sub-intents tracked with parent/child relationship
- [ ] Delegation depth limited
- [ ] Events emitted for delegation
