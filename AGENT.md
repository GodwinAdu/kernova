# Nexus — Agent Instructions

> This file defines how AI coding agents (Kiro, Copilot, Cursor, etc.) should work on this project.
> It ensures consistency across sessions, developers, and years of development.

---

## Project Identity

- **Name:** Nexus
- **Type:** Intelligent Systems Runtime
- **Tagline:** "The runtime for intelligent software"
- **Version:** 0.1.0 (Foundation Phase)
- **Language:** TypeScript (core), Rust (performance-critical modules, future)
- **Runtime:** Node.js 20+
- **Package Manager:** npm with workspaces
- **Build System:** Turborepo + TypeScript compiler
- **Longevity Target:** 20-50 years

---

## What Is Nexus?

Nexus is a runtime that provides the execution environment for intelligent software — the same way Node.js provides it for JavaScript applications.

```
Node.js   = Runtime for JavaScript
Docker    = Runtime for Containers
Kubernetes = Runtime for Services
Nexus     = Runtime for Intelligent Systems
```

**Core insight:** AI models change every year. The infrastructure around them (identity, memory, events, governance, workflows, trust) is a permanent need. Nexus owns that infrastructure layer.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│           Developer Application              │
├─────────────────────────────────────────────┤
│           @nexus/sdk                         │
├─────────────────────────────────────────────┤
│           @nexus/core (Runtime Kernel)       │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Intent  │ │  Agent   │ │  Workflow   │  │
│  │  Engine  │ │ Registry │ │  Engine     │  │
│  └──────────┘ └──────────┘ └────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Memory  │ │  Event   │ │  Context    │  │
│  │  Engine  │ │  Bus     │ │  Engine     │  │
│  └──────────┘ └──────────┘ └────────────┘  │
├─────────────────────────────────────────────┤
│  Identity │ Trust │ Governance │ Policies   │
└─────────────────────────────────────────────┘
```

---

## The Seven Pillars

Every feature MUST belong to exactly one pillar. If it doesn't fit, reject it.

| # | Pillar | Question | Package Location |
|---|--------|----------|------------------|
| 1 | Identity | Who are you? | `core/src/identity/` |
| 2 | Trust | Should we believe you? | `core/src/trust/` |
| 3 | Knowledge | What do we know? | `core/src/memory/` |
| 4 | Reasoning | How should we think? | `core/src/reasoning/` |
| 5 | Execution | How do we act? | `core/src/agents/` |
| 6 | Coordination | How do systems work together? | `core/src/workflows/` |
| 7 | Governance | Who is accountable? | `core/src/governance/` |

---

## Monorepo Structure

```
nexus/
├── docs/                          ← Project Atlas (documentation)
│   ├── VISION.md                  ← Why Nexus exists (never changes)
│   ├── PROGRESS.md                ← Current status and what's next
│   ├── ARCHITECTURE.md            ← Technical architecture overview
│   ├── CONTRIBUTING.md            ← How to contribute
│   ├── decisions/                 ← Architecture Decision Records (ADRs)
│   │   ├── 001-typescript-first.md
│   │   ├── 002-intent-as-first-class.md
│   │   └── ...
│   ├── specs/                     ← Feature specifications
│   │   ├── intent-system.md
│   │   ├── memory-engine.md
│   │   └── ...
│   └── protocols/                 ← Nexus Protocol specs (future public standard)
│       ├── NP-001-intent.md
│       └── ...
│
├── packages/
│   ├── types/                     ← Universal Object Model
│   │   └── src/
│   │       ├── base.ts            ← NexusObject, Temporal, Evidence
│   │       ├── intent.ts          ← Intent system types
│   │       ├── agent.ts           ← Agent types
│   │       ├── event.ts           ← Event system types
│   │       ├── memory.ts          ← Memory layer types
│   │       ├── workflow.ts        ← Workflow types
│   │       ├── identity.ts        ← Identity & governance types
│   │       └── index.ts           ← Public API barrel
│   │
│   ├── core/                      ← Runtime Kernel
│   │   └── src/
│   │       ├── kernel.ts          ← NexusKernel (the heart)
│   │       ├── define-agent.ts    ← Developer API for creating agents
│   │       ├── utils.ts           ← Shared utilities
│   │       ├── agents/            ← Pillar 5: Execution
│   │       ├── context/           ← Context computation
│   │       ├── events/            ← Event bus and dispatch
│   │       ├── memory/            ← Pillar 3: Knowledge
│   │       ├── identity/          ← Pillar 1: Identity (future)
│   │       ├── trust/             ← Pillar 2: Trust (future)
│   │       ├── workflows/         ← Pillar 6: Coordination (future)
│   │       ├── governance/        ← Pillar 7: Governance (future)
│   │       └── index.ts           ← Public API barrel
│   │
│   ├── cli/                       ← Developer Tools
│   │   └── src/
│   │       ├── bin.ts             ← CLI entry point
│   │       ├── ui.ts              ← Terminal UI utilities
│   │       ├── commands/          ← CLI commands (init, dev, agent, status)
│   │       └── index.ts
│   │
│   ├── sdk/                       ← High-level SDK (future)
│   └── studio/                    ← Web inspection UI (future)
│
├── AGENT.md                       ← THIS FILE
├── README.md                      ← Public-facing overview
├── package.json                   ← Monorepo root
├── tsconfig.base.json             ← Shared TypeScript config
└── turbo.json                     ← Build orchestration
```

---

## Coding Standards

### File Structure

Every source file MUST follow this structure:

```typescript
/**
 * Module Name
 * 
 * Brief description of what this module does.
 * Which pillar it belongs to (if applicable).
 * 
 * Key design decisions explained here.
 */

// Imports (external, then internal, then types)
import { something } from 'node:module';
import { internal } from '../utils.js';
import type { SomeType } from '@nexus/types';

// Constants
const MAX_RETRIES = 3;

// Types (if module-specific, not shared)
interface InternalConfig { ... }

// Implementation
export class MyClass { ... }

// Helper functions (private to module)
function helperFn() { ... }
```

### Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | kebab-case | `event-bus.ts` |
| Classes | PascalCase | `NexusKernel` |
| Interfaces | PascalCase | `AgentDefinition` |
| Type aliases | PascalCase | `IntentStatus` |
| Functions | camelCase | `generateId()` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Directories | kebab-case | `memory-engine/` |
| Packages | @nexus/name | `@nexus/core` |

### Import Rules

1. Use `.js` extensions in all relative imports (ESM requirement)
2. Import types with `import type { ... }` when possible
3. Import from package names (`@nexus/types`) not relative paths across packages
4. Order: node builtins → external packages → internal packages → relative

### Error Handling

- All errors must be actionable (tell the developer what to do)
- Use custom error classes for domain errors
- Never swallow errors silently
- Log errors with context (what was being done, what state we were in)

### Testing Standards (when tests are added)

- Unit tests live next to source: `kernel.ts` → `kernel.test.ts`
- Integration tests in `__tests__/` directory
- Every public API method has at least one test
- Test names describe behavior: `"should reject intent when no agent is available"`

---

## Documentation Standards

### Every Major Feature Gets:

1. **A spec** in `docs/specs/` (written BEFORE implementation)
2. **An ADR** in `docs/decisions/` (recording WHY we chose this approach)
3. **JSDoc comments** on all public APIs
4. **A section** in the relevant package README

### Architecture Decision Records (ADRs)

Format:
```markdown
# ADR-NNN: Title

## Status
Accepted | Proposed | Deprecated | Superseded

## Context
What is the issue? What forces are at play?

## Decision
What is the change we're making?

## Consequences
What becomes easier? What becomes harder?
```

### Progress Tracking

`docs/PROGRESS.md` is the single source of truth for:
- What's been built
- What's in progress
- What's next
- Known issues and technical debt

---

## Build & Development

```bash
# Install dependencies
npm install

# Build all packages (order matters)
npx tsc --project packages/types/tsconfig.json
npx tsc --project packages/core/tsconfig.json
npx tsc --project packages/cli/tsconfig.json

# Test the CLI
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js init test-app

# Future: use turbo for orchestrated builds
npm run build
```

---

## Design Decisions Already Made

1. **TypeScript first** — Velocity + ecosystem. Rust for hot paths later.
2. **Intent as first-class** — Not prompts, not conversations. Structured goals.
3. **Event-native** — Every object has a timeline. Events are source of truth.
4. **Five-layer memory** — Not one database. Layered by scope and lifetime.
5. **Computed context** — Assembled fresh per intent. Never one giant blob.
6. **Domain-driven** — Each domain owns its rules, APIs, events, data.
7. **Monorepo** — Types, core, CLI, SDK all in one repo for coherence.
8. **Open source runtime** — Commercial cloud and studio.

---

## What NOT To Do

- Do NOT add features without a spec document
- Do NOT create new object types without adding them to `@nexus/types`
- Do NOT bypass the event system (everything emits events)
- Do NOT store context as a single document (always compute it)
- Do NOT couple to a specific AI model (always go through abstraction)
- Do NOT break backward compatibility without an ADR
- Do NOT add dependencies without justification
- Do NOT skip documentation — this project outlives any individual contributor

---

## Current Phase: Foundation (v0.1.x)

**Goal:** Working runtime that can receive an intent, route it to an agent, execute it, and return a result with evidence.

**Status:** See `docs/PROGRESS.md`

---

## Long-Term Roadmap

| Phase | Version | Focus |
|-------|---------|-------|
| Foundation | 0.1.x | Core runtime, types, CLI, basic agents |
| Memory | 0.2.x | Persistent memory, vector search, layers |
| Models | 0.3.x | LLM integration, model routing, fallbacks |
| Workflows | 0.4.x | Multi-step execution, human approval |
| Identity | 0.5.x | Auth, permissions, organizations |
| Studio | 0.6.x | Web UI for inspection and debugging |
| Cloud | 0.7.x | Managed deployment, scaling |
| Protocol | 0.8.x | Public specification, interoperability |
| Marketplace | 0.9.x | Plugin ecosystem, shared capabilities |
| Production | 1.0.0 | Stable APIs, backward compatibility promise |

---

## Contact & Governance

- **Founder/Architect:** [Your Name]
- **Decision Authority:** Founder (until team grows)
- **RFC Process:** Required for any architectural change

---

*This document is the law of the codebase. Every AI agent, every developer, every contributor follows it. When in doubt, refer here.*
