# ◆ Nexus

**The Intelligent Systems Runtime**

Nexus is a runtime for building, operating, and governing intelligent software. Just as Node.js gave JavaScript a runtime to run anywhere, Nexus gives AI-powered applications a runtime to run correctly — with identity, memory, events, governance, and trust built in.

---

## What is Nexus?

```
Node.js   = Runtime for JavaScript
Docker    = Runtime for Containers
Kubernetes = Runtime for Services
Nexus     = Runtime for Intelligent Systems
```

Nexus provides everything required to build AI-powered applications without rebuilding infrastructure:

- **Intent System** — First-class goal objects that replace chat-style prompts
- **Agent Lifecycle** — Define, deploy, and orchestrate intelligent agents
- **Event-Native** — Every object has a timeline, every action emits events
- **Five-Layer Memory** — Working, session, long-term, organizational, global
- **Computed Context** — Right information, right time, right permissions
- **Evidence Trail** — Every decision is traceable and auditable
- **Governance** — Policies, permissions, and accountability built in

---

## Quick Start

```bash
# Create a new project
nexus init my-app
cd my-app

# Install dependencies
npm install

# Start the development runtime
nexus dev
```

---

## Your First Agent

```typescript
import { defineAgent } from '@nexus/core';

export default defineAgent({
  name: 'assistant',
  description: 'A helpful assistant agent',
  capabilities: [
    { id: 'general', name: 'General', description: 'General assistance', confidence: 0.9 }
  ],
  tools: [],
  instructions: `You are a helpful assistant in the Nexus runtime.`,

  async execute(intent, context, tools) {
    tools.log(`Processing: ${intent.goal}`);

    return {
      success: true,
      summary: `Completed: ${intent.goal}`,
      evidence: {
        sources: [],
        confidence: 0.9,
        reasoning: 'Direct execution',
      },
      durationMs: 0,
    };
  },
});
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│           Your Application                   │
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

Every feature in Nexus belongs to one of these pillars:

| # | Pillar | Question |
|---|--------|----------|
| 1 | Identity | Who are you? |
| 2 | Trust | Should we believe you? |
| 3 | Knowledge | What do we know? |
| 4 | Reasoning | How should we think? |
| 5 | Execution | How do we act? |
| 6 | Coordination | How do systems work together? |
| 7 | Governance | Who is accountable? |

---

## Packages

| Package | Description |
|---------|-------------|
| `@nexus/types` | Universal Object Model and type definitions |
| `@nexus/core` | Runtime kernel — intent execution, agents, memory, events |
| `@nexus/cli` | Developer tools — init, dev, agent management |

---

## Design Principles

- **Intent over prompts** — Goals are structured objects, not strings
- **Event-native** — Everything has a timeline, everything is traceable
- **Trust by default** — Identity, permissions, and audit from day one
- **Computed context** — Never store a giant context blob
- **Evidence required** — Every answer must cite its sources
- **Model agnostic** — The runtime doesn't care which LLM you use

---

## License

MIT

---

*Built to last. Designed for the next 20 years of intelligent software.*
