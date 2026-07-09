# Nexus — Architecture Document

> Technical blueprint for the Nexus Intelligent Systems Runtime.
> This document explains HOW Nexus works at a systems level.

---

## System Overview

Nexus is a layered runtime architecture that processes **Intents** through **Agents** using **Memory**, **Events**, and **Context** — governed by **Identity** and **Policies**.

```
┌───────────────────────────────────────────────────────────────┐
│                    Developer Application                        │
│  (Uses @nexus/sdk or @nexus/core directly)                     │
├───────────────────────────────────────────────────────────────┤
│                         @nexus/sdk                              │
│  (High-level abstractions, helpers, patterns)                  │
├───────────────────────────────────────────────────────────────┤
│                      @nexus/core — Kernel                       │
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐ │
│  │   Intent    │  │    Agent    │  │      Workflow          │ │
│  │   Engine    │  │   Registry  │  │      Engine            │ │
│  │             │  │             │  │                        │ │
│  │ • Validate  │  │ • Register  │  │ • Define workflows     │ │
│  │ • Plan      │  │ • Select    │  │ • Execute steps        │ │
│  │ • Execute   │  │ • Execute   │  │ • Handle compensation  │ │
│  │ • Complete  │  │ • Monitor   │  │ • Approval gates       │ │
│  └─────────────┘  └─────────────┘  └───────────────────────┘ │
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐ │
│  │   Memory    │  │    Event    │  │      Context           │ │
│  │   Engine    │  │    Bus      │  │      Engine            │ │
│  │             │  │             │  │                        │ │
│  │ • 5 layers  │  │ • Publish   │  │ • Compute per intent   │ │
│  │ • Store     │  │ • Subscribe │  │ • Assemble memory      │ │
│  │ • Query     │  │ • Replay    │  │ • Apply permissions    │ │
│  │ • Decay     │  │ • Timeline  │  │ • Estimate tokens      │ │
│  └─────────────┘  └─────────────┘  └───────────────────────┘ │
│                                                                │
├───────────────────────────────────────────────────────────────┤
│              Identity │ Trust │ Governance │ Policies           │
├───────────────────────────────────────────────────────────────┤
│              Storage │ Models │ Tools │ Plugins                 │
└───────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. The Intent

The Intent is the fundamental unit of work in Nexus. It replaces prompts and chat messages with a structured, trackable, governable object.

```typescript
Intent {
  id: NexusId
  goal: string              // What the user wants
  intentType: IntentType    // query, action, workflow, creation...
  priority: Priority
  confidence: Confidence    // How well we understand it
  constraints: Constraint[] // Budget, time, quality limits
  risk: RiskAssessment      // What could go wrong
  evidence?: Evidence       // How we resolved it
  result?: IntentResult     // The outcome
}
```

**Lifecycle:** `pending → planning → executing → completed/failed`

### 2. The Agent

Agents are the execution units. They receive intents and produce results. An agent is NOT just an LLM wrapper — it's a capability-bearing entity with identity, permissions, and tools.

```typescript
AgentDefinition {
  name: string
  capabilities: Capability[]  // What it can do
  tools: ToolReference[]      // What it has access to
  models: ModelReference[]    // Which AI models it uses
  instructions: string        // System prompt
  permissions: Permission[]   // What it's allowed to do
}
```

### 3. The Event System

Nexus is **Event Native**. Every state change emits an event. Events are the historical record of everything that happened.

```typescript
NexusEvent {
  eventType: string           // "intent.created", "agent.executing"
  category: EventCategory
  timestamp: Timestamp
  subjectId: NexusId          // What this is about
  actorId: NexusId            // Who caused it
  correlationId: NexusId      // Trace related events
  data: Record<string, unknown>
}
```

### 4. The Memory System

Five layers, each with different scope and lifetime:

| Layer | Scope | Lifetime | Example |
|-------|-------|----------|---------|
| Working | Current task | Minutes | "User asked about revenue" |
| Session | Current conversation | Hours | "We discussed the Q2 report" |
| Long-term | User/project | Months-years | "User prefers concise answers" |
| Organizational | Company-wide | Years | "Company policy on data sharing" |
| Global | Public knowledge | Permanent | "TypeScript is a programming language" |

### 5. Computed Context

Context is NEVER stored as one giant blob. It's assembled fresh for each intent:

```
User + Intent + Permissions + Knowledge + Memory + Policies → Context
```

This keeps prompts small, relevant, and permission-aware.

---

## Data Flow

### Happy Path: Intent Execution

```
1. Developer submits Intent
      ↓
2. Kernel validates Intent
      ↓
3. Context Engine computes context
   (queries memory, resolves permissions, applies policies)
      ↓
4. Agent Registry selects best agent
   (capability matching, load balancing)
      ↓
5. Agent executes with context + tools
      ↓
6. Result + Evidence returned
      ↓
7. Events emitted at each step
      ↓
8. Memory updated (learnings stored)
```

### Event Flow

```
Every action → Event Bus → Subscribers
                    ↓
              Event History (timeline)
                    ↓
              Observability (metrics, logs, traces)
```

---

## Universal Object Model

Every object in Nexus extends `NexusObject`:

```typescript
NexusObject {
  id: NexusId           // Globally unique
  type: string          // Object type discriminator
  version: Version      // Semantic version
  owner: NexusId        // Who owns this
  status: LifecycleStatus
  createdAt: Timestamp
  updatedAt: Timestamp
  metadata: Record<string, unknown>
}
```

**The Nexus Laws** (every object must satisfy):
1. Everything has an identity
2. Everything has permissions
3. Everything emits events
4. Everything has history
5. Everything is observable
6. Everything is replaceable
7. Everything is versioned
8. Everything is documented
9. Everything is testable
10. Everything is secure

---

## Package Architecture

### @nexus/types
- Zero dependencies
- Type definitions only (no runtime code)
- The "schema" of the entire system
- Breaking changes require major version bump

### @nexus/core
- Depends on: @nexus/types
- The runtime kernel
- In-process by default, distributed later
- Modular: each subsystem (memory, events, agents) is replaceable

### @nexus/cli
- Depends on: @nexus/core, @nexus/types
- Developer tooling
- Project scaffolding, development server, agent management

### @nexus/sdk (future)
- Depends on: @nexus/core, @nexus/types
- High-level developer API
- Opinionated patterns and helpers
- Framework integrations (Express, Fastify, etc.)

---

## Technology Choices

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Language | TypeScript | Ecosystem, velocity, AI SDK availability |
| Runtime | Node.js 20+ | Stable, LTS, native ESM |
| Module system | ESM | Future-proof, tree-shakeable |
| Build | tsc + Turborepo | Simple, fast, reliable |
| Storage (dev) | In-memory → SQLite | Zero config for development |
| Storage (prod) | PostgreSQL + Redis + Vector DB | Proven at scale |
| Event bus (dev) | In-process | Simple, no external deps |
| Event bus (prod) | NATS / Redis Streams | Distributed, persistent |
| AI Models | Provider-agnostic | Interface-based, swappable |

---

## Security Model (Future)

- All inter-component communication is authenticated
- Agents have least-privilege permissions
- Secrets are never stored in plain text
- All data access is audit-logged
- Encryption at rest and in transit
- Input validation at every boundary

---

## Scalability Strategy

**Phase 1 (now):** Single-process, in-memory. Suitable for development and small deployments.

**Phase 2:** SQLite for persistence. Single machine, concurrent access.

**Phase 3:** PostgreSQL + Redis. Horizontal scaling. Multiple kernel instances.

**Phase 4:** Distributed event bus. Multi-region. Edge deployment.

The architecture is designed so that each phase is an implementation swap, not an architectural rewrite.

---

*Written: July 8, 2026*  
*Last reviewed: July 8, 2026*  
*Status: Active*
