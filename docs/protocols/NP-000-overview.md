# Kernova Protocol — Overview

**Version:** 0.1.0  
**Status:** Draft  
**Date:** July 2026

## What Is the Kernova Protocol?

The Kernova Protocol (NP) is an open specification for building, operating, and governing intelligent systems. It defines how intents, agents, memory, events, tools, and workflows communicate and interoperate.

Think of it as HTTP for intelligent systems — a standard that anyone can implement.

## Design Goals

1. **Interoperability** — Any runtime implementing NP can communicate with others
2. **Simplicity** — Easy to implement (basic compliance in <1000 lines)
3. **Extensibility** — Core protocol is minimal, extensions are opt-in
4. **Transport agnostic** — Works over HTTP, WebSocket, gRPC, or in-process
5. **Versioned** — Breaking changes require a new major version

## Protocol Documents

| ID | Title | Status |
|---|---|---|
| NP-000 | Overview (this document) | Draft |
| NP-001 | Intent Protocol | Draft |
| NP-002 | Agent Protocol | Draft |
| NP-003 | Memory Protocol | Draft |
| NP-004 | Event Protocol | Draft |
| NP-005 | Tool Protocol | Draft |
| NP-006 | Identity Protocol | Draft |

## Conformance Levels

- **Level 1: Intent** — Can submit and receive intents
- **Level 2: Agent** — Can register and execute agents
- **Level 3: Full** — Implements all protocols (memory, events, tools, identity)

## Wire Format

All protocol messages use JSON. Identifiers are UUIDs. Timestamps are ISO 8601.
