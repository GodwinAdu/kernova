# ADR-004: Five-Layer Memory Architecture

## Status
Accepted

## Date
July 8, 2026

## Context

Most AI systems implement memory as a single database (usually a vector store). This conflates different types of knowledge with different lifetimes, access patterns, and privacy requirements.

A user's current task context is fundamentally different from organizational knowledge, which is different from general world knowledge.

## Decision

Kernova implements memory as five distinct layers:

| Layer | Scope | Lifetime | Access Pattern |
|-------|-------|----------|----------------|
| Working | Current intent/task | Minutes | Frequently read/written |
| Session | Current interaction | Hours | Read on every intent |
| Long-term | User/project | Months-years | Semantic search |
| Organizational | Shared across org | Years | Policy-governed access |
| Global | Public knowledge | Permanent | Read-only reference |

The AI Kernel chooses the appropriate layer for each storage and retrieval operation.

## Reasoning

1. **Privacy** — Organizational memory has different access rules than personal memory
2. **Performance** — Working memory is fast (in-process), global is slow (search)
3. **Relevance** — Recent working memory is more relevant than old long-term memory
4. **Decay** — Different layers decay at different rates
5. **Scalability** — Each layer can use different storage backends
6. **Clarity** — Developers understand where knowledge lives

## Implementation Strategy

Phase 1: All layers in-memory (current)
Phase 2: Working + Session in Redis, Long-term in SQLite + vectors
Phase 3: Organizational in PostgreSQL, Global via search APIs

## Consequences

### Easier
- Implementing memory privacy and permissions
- Optimizing each layer independently
- Understanding where knowledge comes from
- Implementing memory decay and consolidation

### Harder
- More complex than a single vector store
- Cross-layer queries require coordination
- Memory placement decisions need heuristics
