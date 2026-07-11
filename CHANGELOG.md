# Changelog

All notable changes to Kernova will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2025-07-10

### Added

- **Daemon Mode**
  - `kernova serve` CLI command for persistent agent execution
  - `app.serve(options)` SDK method to start a DaemonRunner
  - Graceful shutdown with configurable timeout (default: 30s)
  - Heartbeat emission (`daemon.heartbeat` event) at configurable intervals

- **Scheduler Enhancement**
  - One-shot delayed jobs via `delayMs` field on `ScheduledJobInput`
  - `app.schedule(name, cronOrDelay, handler)` SDK method (accepts cron string or delay in ms)

- **Task Queue Enhancement**
  - Configurable concurrency limit (default: 5) with worker pool
  - Priority-ordered dequeue (critical > high > medium > low), FIFO within same level
  - `app.enqueue(handler, payload, options)` SDK method

- **Channel System**
  - `ChannelAdapter` interface with `connect()`, `disconnect()`, `send()`, `onMessage()` methods
  - `WebhookChannelAdapter` — HTTP POST receiver with configurable port and path
  - `WebSocketChannelAdapter` — WS server with ping/pong keepalive (30s interval)
  - `app.channel(name, adapter)` and `app.onMessage(handler)` SDK methods

- **Conversation Threads**
  - Sliding window with summarization (oldest messages summarized when exceeding window size)
  - `app.thread(threadId)` SDK method returning a `ThreadHandle` with `addMessage()` and `getContext()`

- **Agent Planning**
  - Plan-and-execute pattern with `plan.step.started` and `plan.step.completed` events
  - Replanning on step failure (invokes model to replan remaining steps with error context)
  - `maxSteps` limit (default: 10) to prevent unbounded plan execution
  - `app.plan(goal, options)` SDK method

- **Agent Config Files**
  - YAML/JSON declarative agent definitions (`.agent.yaml`, `.agent.yml`, `.agent.json`)
  - `extends` field for config inheritance (merge base + child configs)
  - Hot-reload when `--watch` flag is set on `kernova serve`
  - `kernova init` now generates a starter `.agent.yaml` file

- **Built-in Tools**
  - `http-fetch` — HTTP requests with configurable method, headers, body
  - `file-read` — read file contents within sandbox directory
  - `file-write` — write content to files within sandbox directory
  - `shell-exec` — execute shell commands with timeout (default: 30s) within sandbox
  - `date-time` — current date, time, timezone, and formatted strings
  - `web-search` — web search with configurable provider (stub/adapter pattern)
  - Sandbox enforcement for file and shell tools (path traversal rejected)
  - Per-tool enable/disable configuration via `KernelConfig`

- **Self-Reflection**
  - Configurable confidence threshold (default: 0.7) — regenerates response if score is below
  - Max regeneration limit (default: 2) to prevent infinite loops
  - `reflection.regenerated` event with original and new confidence scores
  - Per-agent and global configuration for enabling/disabling reflection

- **Proactive Triggers**
  - Event-driven rule engine with SQLite persistence
  - Cooldown enforcement — rules cannot fire more than once per `cooldownMs` period
  - `app.trigger(name, eventPattern, action)` SDK method

- **CLI Commands**
  - `kernova serve` — persistent daemon with `--config`, `--watch`, `--port`, `--data-dir` options
  - `kernova schedule list|enable|disable` — scheduler management
  - `kernova queue status|replay` — task queue management
  - `kernova triggers list` — trigger rule listing

- **Testing**
  - 14 property-based tests covering scheduler, task queue, conversations, triggers, config, tools, reflection, and backward compatibility
  - Integration tests for CLI commands and full autonomy flow

### Changed

- Renamed `NexusKernel` → `KernovaKernel` (deprecated alias preserved)
- Renamed `Nexus` → `Kernova` SDK class (deprecated alias preserved)
- Renamed all `Nexus*` types to `Kernova*` (`NexusId` → `KernovaId`, `NexusObject` → `KernovaObject`, `NexusEvent` → `KernovaEvent`)
- CLI commands now use `kernova` prefix instead of `nexus`

### Deprecated

- `NexusKernel` — use `KernovaKernel`
- `Nexus` — use `Kernova`
- `NexusEvent` — use `KernovaEvent`
- `NexusId` — use `KernovaId`
- `NexusObject` — use `KernovaObject`

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
