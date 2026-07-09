# Changelog

All notable changes to Nexus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-08

### Added

- **Core Runtime** (`@nexus/core`)
  - NexusKernel with intent lifecycle management
  - Event-native architecture with SQLite persistence
  - Five-layer memory system with FTS5 search and vector embeddings
  - 20+ model providers (OpenAI, Anthropic, Gemini, DeepSeek, Groq, etc.)
  - Universal Model Protocol (config-driven provider support)
  - Plugin system with tools and middleware
  - Workflow engine with multi-step execution and human approval
  - Multi-agent coordination (delegation, ask, broadcast)
  - Identity & auth (API keys, sessions, roles, permissions)
  - Rate limiting & cost control (budgets, throttling)
  - Streaming responses (AsyncGenerator)
  - Hot reload for development
  - Studio web dashboard (localhost:4200)
  - AgentCoordinator for multi-agent patterns

- **SDK** (`@nexus/sdk`)
  - `Nexus.create()` — one-line setup
  - `app.agent()` — minimal agent definition
  - `app.tool()` — minimal tool registration
  - `app.ask()` — submit intents
  - `app.remember()` / `app.recall()` — memory operations

- **CLI** (`@nexus/cli`)
  - `nexus init` — project scaffolding
  - `nexus dev` — development runtime with hot reload + Studio
  - `nexus agent create/list` — agent management
  - `nexus status` — runtime status

- **Types** (`@nexus/types`)
  - Universal Object Model
  - Intent, Agent, Event, Memory, Workflow, Identity, Model types
  - Streaming types

- **Documentation**
  - Architecture document
  - Vision document
  - 9 Architecture Decision Records
  - 7 Protocol specifications (NP-000 through NP-006)
  - Getting started guide
  - API reference
  - Configuration guide
  - Progress tracker
  - Contributing guide

- **Testing**
  - 63 tests across 7 test files
  - Covers kernel, events, memory, plugins, identity, budgets, coordination
