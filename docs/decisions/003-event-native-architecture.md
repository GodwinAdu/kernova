# ADR-003: Event-Native Architecture

## Status
Accepted

## Date
July 8, 2026

## Context

There are two approaches to handling state changes:
1. **Event-driven** — Events are used for communication between services
2. **Event-native** — Events ARE the system. Every object has a timeline.

Most systems store only current state. If you want to know what happened, you check logs. But logs are unstructured, incomplete, and hard to query.

## Decision

Nexus is Event Native, not merely event-driven.

Every object has a timeline. Instead of only storing the latest state, we preserve the sequence of meaningful events. Every state change emits a typed event with:
- Event type (domain.action)
- Subject (what object this is about)
- Actor (who/what caused it)
- Correlation ID (trace related events)
- Timestamp
- Payload

## Reasoning

1. **Debugging** — Replay what happened step by step
2. **Auditing** — Complete record of all actions
3. **Analytics** — Measure performance, patterns, anomalies
4. **Undo** — Compensation becomes possible
5. **Integration** — External systems can subscribe to events
6. **Observability** — The system is inherently observable

## Implementation

Phase 1: In-memory event bus (current)
Phase 2: SQLite persistence
Phase 3: Distributed event bus (NATS/Redis Streams)

Events are immutable once emitted. The event bus supports:
- Pattern-based subscriptions (`intent.*`, `*.created`)
- Timeline retrieval (all events for an object)
- Replay (re-process historical events)

## Consequences

### Easier
- Debugging complex multi-agent interactions
- Building audit logs and compliance reports
- Adding new integrations without changing core code
- Understanding system behavior

### Harder
- More storage required (events accumulate)
- Eventual consistency in distributed mode
- Event schema evolution must be managed carefully
