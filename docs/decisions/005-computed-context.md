# ADR-005: Computed Context (Never Stored)

## Status
Accepted

## Date
July 8, 2026

## Context

Many AI systems maintain a single growing context that accumulates over time. This leads to:
- Bloated prompts that waste tokens
- Irrelevant information polluting decisions
- Permission violations (context contains data the agent shouldn't see)
- Stale information

## Decision

Context is always computed fresh for each intent. It is never stored as a persistent blob.

The formula:
```
User + Intent + Permissions + Knowledge + Memory + Policies → Context
```

The Context Engine assembles the right information from all memory layers, applies permission filters, respects token budgets, and produces a minimal, relevant context.

## Reasoning

1. **Relevance** — Only include what matters for THIS intent
2. **Security** — Permissions are applied at context-assembly time
3. **Efficiency** — Smaller prompts = faster responses + lower cost
4. **Freshness** — Always uses latest memory state
5. **Auditability** — Context computation is logged (what was included, why)

## Consequences

### Easier
- Keeping prompts within token limits
- Respecting permissions without complex filtering
- Debugging (see exactly what the agent was given)
- Cost optimization

### Harder
- More computation per intent (offset by smaller prompts)
- Need good relevance scoring for memory retrieval
- Cold-start for first intent (no prior context)
