# ADR-007: Universal Model Protocol (Future-Proof Model Support)

## Status
Accepted

## Date
July 8, 2026

## Context

The AI model landscape is evolving at an unprecedented rate:
- New providers launch monthly (2024-2026 saw 50+ new providers)
- New modalities emerge (text, image, audio, video, 3D, code execution)
- New deployment patterns emerge (cloud, edge, on-device, federated)
- Open-source models mean anyone can host models anywhere
- Future compute paradigms (quantum, neuromorphic) are unpredictable

Maintaining a list of provider integrations is a losing strategy. Every new provider requires code changes, releases, and maintenance. This doesn't scale over 20-50 years.

## Decision

Nexus implements a **Universal Model Protocol** — a layered abstraction that automatically supports any model that exists now or will exist in the future.

### Architecture

```
Application / Agent
       ↓
Model Protocol (universal interface)
       ↓
Adapter Registry (pattern matching)
       ↓
┌────────────────────────────────────────┐
│ Adapters (one per API pattern):        │
│  • OpenAI-compatible (~80% of market)  │
│  • Anthropic Messages API              │
│  • Google Gemini/Vertex API            │
│  • Ollama/Local API                    │
│  • Custom (user-provided)              │
└────────────────────────────────────────┘
       ↓
Any model, anywhere
```

### Key Principles

1. **Configuration over code** — New providers are added via config, not source code
2. **Pattern-based adapters** — One adapter covers many providers
3. **Runtime registration** — Providers can be added while the system is running
4. **Capability declaration** — Providers declare what they can do (text, embeddings, vision, etc.)
5. **Zero-dependency** — Uses fetch(), no provider-specific SDKs

### How a new provider gets supported

Scenario A: New provider uses OpenAI-compatible API
→ Developer adds to nexus.config.json. Zero code needed. Works immediately.

Scenario B: New provider has a unique API format
→ Developer writes a small adapter (~50 lines). Drops it in. Works.

Scenario C: Future compute paradigm we can't predict
→ As long as it can accept messages and return responses, it fits the protocol.

## Consequences

### Easier
- Supporting new providers (usually config-only)
- Running hybrid setups (cloud + local + edge)
- Upgrading models without changing application code
- Community contributions (anyone can write an adapter)

### Harder
- Provider-specific advanced features need opt-in extensions
- Some precision lost in universal abstraction
- Testing across many providers requires strategy
