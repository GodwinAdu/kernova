---
title: Protocol Overview
description: The Kernova Protocol — an open standard for intelligent systems.
---

# Kernova Protocol

The Kernova Protocol (NP) is an open specification for building, operating, and governing intelligent systems. It defines how intents, agents, memory, events, tools, and identity communicate and interoperate.

## Documents

| ID | Title |
|---|---|
| [NP-001](/protocol/intent) | Intent Protocol |
| [NP-002](/protocol/agent) | Agent Protocol |
| [NP-003](/protocol/memory) | Memory Protocol |
| [NP-004](/protocol/event) | Event Protocol |
| [NP-005](/protocol/tool) | Tool Protocol |
| [NP-006](/protocol/identity) | Identity Protocol |

## Conformance Levels

- **Level 1: Intent** — Can submit and receive intents
- **Level 2: Agent** — Can register and execute agents  
- **Level 3: Full** — Implements all protocols

## Wire Format

All messages use JSON. IDs are UUIDs. Timestamps are ISO 8601.

Any runtime implementing these protocols is Kernova-compatible.
