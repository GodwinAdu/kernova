---
inclusion: auto
---

# Nexus Project Steering

## What is Nexus?

Nexus is the Intelligent Systems Runtime — a platform for building, operating, and governing intelligent software. It abstracts AI infrastructure the same way Node.js abstracts OS-level I/O.

## Architecture Principles

1. **Intent over prompts** — Goals are first-class objects, not strings
2. **Event-native** — Every object has a timeline, every action emits events
3. **Five-layer memory** — Working, session, long-term, organizational, global
4. **Computed context** — Assembled at runtime, never stored as a blob
5. **Evidence required** — Every decision must be traceable
6. **Model agnostic** — The runtime doesn't care which LLM is used
7. **Trust by default** — Identity, permissions, and audit from day one

## The Seven Pillars

Every feature belongs to exactly one pillar:
1. Identity — Who are you?
2. Trust — Should we believe you?
3. Knowledge — What do we know?
4. Reasoning — How should we think?
5. Execution — How do we act?
6. Coordination — How do systems work together?
7. Governance — Who is accountable?

## Code Standards

- Every file has a module-level JSDoc comment explaining its purpose
- Every public function/class has documentation
- Types are defined in `@nexus/types` — the single source of truth
- Use meaningful variable names — code should read like prose
- No magic numbers or strings — use named constants
- Error messages should be helpful and actionable
- Every module belongs to a clear domain (intent, agent, memory, event, identity, workflow, context)

## Monorepo Structure

```
packages/
  types/    → Universal Object Model (type definitions only)
  core/     → Runtime Kernel (the engine)
  cli/      → Developer tools (the interface)
  sdk/      → High-level developer API (future)
  studio/   → Web UI for inspection (future)
```

## Documentation Standards

- All documentation lives in `docs/`
- Architecture decisions go in `docs/decisions/`
- Every major feature has a spec in `docs/specs/`
- Progress is tracked in `docs/PROGRESS.md`
- The project vision lives in `docs/VISION.md`
