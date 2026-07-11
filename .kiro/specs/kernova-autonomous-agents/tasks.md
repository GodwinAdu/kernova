# Implementation Plan: Kernova Autonomous Agents

## Overview

This plan implements autonomous agent infrastructure for Kernova across 14 task groups. The work proceeds in dependency order: rename first (no feature depends on old names), then daemon mode (foundation for runtime), then each subsystem enhancement, then CLI/SDK exposure, and finally build verification.

## Tasks

- [x] 1. Rename Internal Identifiers (Nexus → Kernova)
  - [x] 1.1 Rename `NexusKernel` class to `KernovaKernel` in `packages/core/src/kernel.ts`, add `@deprecated` export alias `NexusKernel`
  - [x] 1.2 Rename `Nexus` class to `Kernova` in `packages/sdk/src/nexus.ts`, rename file to `kernova.ts`, add `@deprecated` export alias `Nexus`
  - [x] 1.3 Update `packages/sdk/src/index.ts` to export `Kernova` as primary and `Nexus` as deprecated alias
  - [x] 1.4 Rename all `Nexus`-prefixed types in `packages/types/src/base.ts` (`NexusId` → `KernovaId`, `NexusObject` → `KernovaObject`) with deprecated aliases
  - [x] 1.5 Rename `NexusEvent` to `KernovaEvent` in `packages/types/src/event.ts` with deprecated alias
  - [x] 1.6 Update `packages/types/src/index.ts` to export all new names and deprecated aliases
  - [x] 1.7 Update `packages/core/src/index.ts` to export `KernovaKernel` as primary and `NexusKernel` as deprecated
  - [x] 1.8 Update all internal imports across `packages/core/src/` to use new class names
  - [x] 1.9 Update examples directory to use new names (`KernovaKernel`, `Kernova`)
  - [x] 1.10 Verify backward compatibility: ensure existing `kernova-one` app still compiles with no changes

- [x] 2. Daemon Mode
  - [x] 2.1 Create `packages/core/src/daemon/index.ts` with `DaemonRunner` class implementing signal handling (SIGINT, SIGTERM), graceful shutdown with configurable timeout, and heartbeat emission
  - [x] 2.2 Add `DaemonConfig` interface with `configPath`, `watch`, `port`, `dataDir`, `shutdownTimeoutMs`, `heartbeatIntervalMs` fields
  - [x] 2.3 Implement graceful shutdown: wait up to `shutdownTimeoutMs` (default: 30s) for active intents, then force stop
  - [x] 2.4 Implement heartbeat: emit `daemon.heartbeat` event every `heartbeatIntervalMs` (default: 60s) while running
  - [x] 2.5 Export `DaemonRunner` and `DaemonConfig` from `packages/core/src/index.ts`
  - [x] 2.6 Add `app.serve(options)` method to Kernova SDK class that creates and starts a DaemonRunner

- [x] 3. Scheduler Enhancement (One-Shot Jobs)
  - [x] 3.1 Extend `ScheduledJobInput` type in `packages/types/src/autonomy.ts` with optional `delayMs` and `oneShot` fields
  - [x] 3.2 Update `Scheduler` in `packages/core/src/scheduler/` to handle one-shot jobs: compute single execution time from `delayMs`, auto-disable after firing
  - [x] 3.3 Add `app.schedule(name, cronOrDelay, handler)` method to Kernova SDK — accepts string (cron) or number (delayMs)
  - [x] 3.4 Write property-based test: for all valid cron expressions, `nextExecution(cron, now) > now` (Property 1)
  - [x] 3.5 Write property-based test: scheduler persistence round-trip — register jobs, stop, restart, verify jobs preserved (Property 3)

- [x] 4. Task Queue Enhancement (Concurrency + CLI)
  - [x] 4.1 Add `concurrency` option to `TaskQueueConfig` in `packages/core/src/task-queue/`, implement worker pool with configurable limit (default: 5)
  - [x] 4.2 Ensure priority ordering: dequeue in priority order (critical > high > medium > low), FIFO within same level
  - [x] 4.3 Add `app.enqueue(handler, payload, options)` method to Kernova SDK
  - [x] 4.4 Write property-based test: task queue priority ordering — tasks dequeue in correct priority+FIFO order (Property 2)
  - [x] 4.5 Write property-based test: task queue persistence round-trip — enqueue tasks, stop, restart, verify tasks preserved (Property 4)
  - [x] 4.6 Write property-based test: concurrency limit — at no point do more than N tasks run simultaneously (Property 9)

- [x] 5. Channel System (Adapters + SDK)
  - [x] 5.1 Add `ChannelAdapter` interface to `packages/types/src/autonomy.ts` with `connect()`, `disconnect()`, `send()`, `onMessage()` methods
  - [x] 5.2 Implement `WebhookChannelAdapter` in `packages/core/src/channels/` — HTTP POST receiver with configurable port and path
  - [x] 5.3 Implement `WebSocketChannelAdapter` in `packages/core/src/channels/` — WS server with ping/pong keepalive (30s interval)
  - [x] 5.4 Add `app.channel(name, adapter)` and `app.onMessage(handler)` methods to Kernova SDK
  - [x] 5.5 Write unit tests for WebhookChannelAdapter (send POST, verify message event emitted)
  - [x] 5.6 Write unit tests for WebSocketChannelAdapter (connect, send, verify receipt, ping keepalive)

- [x] 6. Conversation Threads Enhancement
  - [x] 6.1 Ensure `ConversationManager` in `packages/core/src/conversation/` supports named thread IDs (create, retrieve, archive)
  - [x] 6.2 Implement sliding window: when messages exceed `windowSize`, summarize oldest using model (fallback: truncate)
  - [x] 6.3 Add `app.thread(threadId)` method to Kernova SDK returning a `ThreadHandle` with `addMessage()` and `getContext()` methods
  - [x] 6.4 Write property-based test: sliding window invariant — active messages never exceed window size (Property 5)
  - [x] 6.5 Write property-based test: conversation persistence round-trip — threads and messages survive restart (Property 6)

- [x] 7. Agent Planning Enhancement
  - [x] 7.1 Ensure `AgentPlanner` in `packages/core/src/planning/` emits `plan.step.started` and `plan.step.completed` events
  - [x] 7.2 Add replanning on step failure: catch step errors, invoke model to replan remaining steps with error context
  - [x] 7.3 Add `maxSteps` limit (default: 10) to prevent unbounded plan execution
  - [x] 7.4 Add `app.plan(goal, options)` method to Kernova SDK
  - [x] 7.5 Write unit tests for planning: verify step events, max step limit, replanning behavior

- [x] 8. Agent Config Files (YAML/JSON)
  - [x] 8.1 Add `yaml` dependency to `packages/core/package.json` (or use existing parser if available)
  - [x] 8.2 Create `AgentConfigFile` schema type in `packages/types/src/autonomy.ts`
  - [x] 8.3 Implement agent config file parser in `packages/core/src/config-manager/` — parse `.agent.yaml`, `.agent.yml`, `.agent.json` files
  - [x] 8.4 Implement `extends` field support for config inheritance (merge base + child configs)
  - [x] 8.5 Wire config loading into `DaemonRunner`: load configs from `--config` path, register agents with Kernel
  - [x] 8.6 Implement hot-reload: when `--watch` flag is set, watch config files and re-register agents on change
  - [x] 8.7 Write property-based test: config parse/serialize round-trip (Property 11)
  - [x] 8.8 Write unit tests: invalid config handling (bad YAML, missing fields), extends merging

- [x] 9. Built-in Tools
  - [x] 9.1 Create `packages/core/src/built-in-tools/index.ts` with `BuiltInToolRegistry` class
  - [x] 9.2 Implement `http-fetch` tool: HTTP requests with configurable method, headers, body
  - [x] 9.3 Implement `file-read` tool: read file contents within sandbox directory
  - [x] 9.4 Implement `file-write` tool: write content to files within sandbox directory
  - [x] 9.5 Implement `shell-exec` tool: execute shell commands with timeout (default: 30s) within sandbox
  - [x] 9.6 Implement `date-time` tool: return current date, time, timezone, and formatted strings
  - [x] 9.7 Implement `web-search` tool: web search with configurable provider (stub/adapter pattern)
  - [x] 9.8 Register built-in tools with Kernel's PluginRegistry during startup
  - [x] 9.9 Add enable/disable configuration for individual tools via KernelConfig
  - [x] 9.10 Write property-based test: file-read/write round-trip within sandbox (Property 12)
  - [x] 9.11 Write edge-case tests: sandbox violations (path traversal rejected), shell timeout enforcement

- [x] 10. Self-Reflection Enhancement
  - [x] 10.1 Ensure `SelfReflection` in `packages/core/src/reflection/` assigns confidence scores in [0.0, 1.0] range
  - [x] 10.2 Implement configurable threshold (default: 0.7) — regenerate response if score below threshold
  - [x] 10.3 Add max regeneration limit (default: 2) to prevent infinite loops
  - [x] 10.4 Emit `reflection.regenerated` event with original and new confidence scores
  - [x] 10.5 Add per-agent and global configuration for enabling/disabling reflection
  - [x] 10.6 Write property-based test: confidence score always in [0.0, 1.0] range (Property 10)
  - [x] 10.7 Write unit tests: regeneration triggered below threshold, stops at max limit

- [x] 11. Proactive Triggers Enhancement
  - [x] 11.1 Ensure `ProactiveTriggerEngine` in `packages/core/src/triggers/` persists rules in SQLite
  - [x] 11.2 Verify cooldown enforcement: rules cannot fire more than once per `cooldownMs` period
  - [x] 11.3 Add `app.trigger(name, eventPattern, action)` method to Kernova SDK
  - [x] 11.4 Write property-based test: cooldown enforcement — rapid events only produce one firing per cooldown window (Property 7)
  - [x] 11.5 Write property-based test: trigger persistence round-trip — rules survive restart (Property 13)
  - [x] 11.6 Write property-based test: event pattern matching correctness (Property 8)

- [x] 12. CLI Commands
  - [x] 12.1 Create `packages/cli/src/commands/serve.ts` — `kernova serve` with `--config`, `--watch`, `--port`, `--data-dir` options
  - [x] 12.2 Create `packages/cli/src/commands/schedule.ts` — `kernova schedule list`, `kernova schedule enable <id>`, `kernova schedule disable <id>`
  - [x] 12.3 Create `packages/cli/src/commands/queue.ts` — `kernova queue status`, `kernova queue replay <id>`
  - [x] 12.4 Create `packages/cli/src/commands/triggers.ts` — `kernova triggers list`
  - [x] 12.5 Update `packages/cli/src/bin.ts` to register new commands (serve, schedule, queue, triggers)
  - [x] 12.6 Update `kernova init` to generate starter `.agent.yaml` file alongside existing scaffold
  - [x] 12.7 Write integration tests for each CLI command (verify output format, error handling)

- [x] 13. SDK Fluent API Consolidation
  - [x] 13.1 Verify all new SDK methods (`schedule`, `channel`, `onMessage`, `serve`, `enqueue`, `trigger`, `plan`, `thread`) return correct types and chain properly
  - [x] 13.2 Export `Kernova` as primary entry point and `Nexus` as deprecated alias from `packages/sdk/src/index.ts`
  - [x] 13.3 Write property-based test: backward compatibility aliases — deprecated names resolve to same classes (Property 14)
  - [x] 13.4 Update SDK README with new method documentation and examples
  - [x] 13.5 Write integration test: full autonomy flow (create app → schedule job → enqueue task → trigger fires → verify events)

- [x] 14. Build and Verification
  - [x] 14.1 Run `tsc` across all packages to verify no type errors after rename and additions
  - [x] 14.2 Run full test suite (`vitest --run`) to verify no regressions
  - [x] 14.3 Verify `kernova-one` app compiles and runs with updated `@kernova/core` and `@kernova/sdk`
  - [x] 14.4 Update `CHANGELOG.md` with v0.2.0 changes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "6.1", "6.2", "6.3", "6.4", "6.5", "7.1", "7.2", "7.3", "7.4", "7.5", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11", "10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "id": 3, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "13.1", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 4, "tasks": ["14.1", "14.2", "14.3", "14.4"] }
  ]
}
```

## Notes

- Groups 3–11 can be implemented in parallel after Group 2 is complete, as they are independent subsystems.
- Property-based tests use the `fast-check` library already in `devDependencies`.
- The `kernova-one` app (at `../kernova-one`) serves as the integration verification target — it already uses `@kernova/core` and `@kernova/sdk` via file references.
- YAML parsing for agent config files requires adding a `yaml` package dependency to `@kernova/core`.
- The `ChannelAdapter` interface is new to `@kernova/types`; the existing `ConnectorRegistry` in core already manages connectors and will be enhanced to work with the new interface.
