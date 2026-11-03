# ADR-001: TypeScript as Primary Language

## Status
Accepted

## Date
July 8, 2026

## Context

Kernova needs a primary implementation language. The decision has significant long-term implications since this is a 20-50 year project.

Options considered:
- **TypeScript** — Strong typing, vast ecosystem, AI SDK availability
- **Rust** — Performance, memory safety, systems-level control
- **Go** — Simplicity, concurrency, fast compilation
- **Python** — AI/ML ecosystem leader, but weak for infrastructure

## Decision

TypeScript is the primary language for all packages (types, core, cli, sdk).

Rust will be introduced later for performance-critical modules (event bus, memory indexing, embedding computation).

## Reasoning

1. **Solo developer velocity** — TypeScript allows fastest iteration for a single developer
2. **AI ecosystem** — Every major AI provider ships a TypeScript/JavaScript SDK first
3. **Developer adoption** — Most developers building AI applications know TypeScript
4. **Node.js precedent** — Proves you can build a runtime in a high-level language and optimize hot paths later
5. **Type safety** — Catches architectural errors at compile time
6. **Refactoring safety** — Critical for a long-term project with evolving architecture

## Consequences

### Easier
- Rapid prototyping and iteration
- Hiring (TypeScript is widely known)
- Ecosystem integration (npm packages)
- AI provider SDK usage

### Harder
- Raw performance (mitigated by Rust modules later)
- Memory control (Node.js GC is good enough for most cases)
- System-level operations (mitigated by Node.js native modules)

## Review Date
Revisit when performance bottlenecks are identified (likely Phase 3-4).
