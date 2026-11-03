# Implementation Plan: Core Autonomy

## Overview

This plan implements five autonomy modules (Scheduler, BackgroundLoop, TaskQueue, ProactiveTriggerEngine, ConnectorRegistry) into the Kernova runtime. Each module follows the established Kernova pattern: constructor receives EventBus + config, exposes `start()`/`stop()` lifecycle, persists state via SQLite. The implementation proceeds bottom-up: shared types and utilities first, then individual modules with their stores and tests, and finally kernel integration wiring.

## Tasks

- [x] 1. Set up project foundation and shared types
  - [x] 1.1 Add dependencies and create autonomy type definitions
    - Add `fast-check` as devDependency to `packages/core/package.json`
    - Add `cron-parser` as dependency to `packages/core/package.json`
    - Create `packages/types/src/autonomy.ts` with all type definitions from the design (ScheduledJob, ScheduledJobInput, ScheduleTarget, BackgroundLoopDef, LoopState, BackgroundLoopInput, TaskItem, TaskStatus, TaskItemInput, QueueStats, DeadLetterItem, DeadLetterAttempt, DeadLetterFilter, TriggerRule, TriggerRuleInput, TriggerActionDef, ChannelType, ConnectionState, ConnectorDef, ConnectorInput, ChannelConfig, SlackConfig, DiscordConfig, WhatsAppConfig, TelegramConfig, EmailConfig, ConnectorStatus, InboundMessage, OutboundMessage, StructuredContent, Attachment, Button, Embed, OutboundMessageRequest, OutboundMessageResult, DeliveryReceipt, RawInboundMessage)
    - Add `export * from './autonomy.js';` to `packages/types/src/index.ts`
    - _Requirements: 1.1, 3.1, 5.1, 8.1, 10.1, 13.2_

  - [x] 1.2 Create shared error types and test utilities
    - Add `ValidationError`, `QueueFullError`, and `ConnectorError` classes to `packages/core/src/errors.ts` (extend existing file or create if absent)
    - Create `packages/core/src/__tests__/test-helpers.ts` with `createTestEventBus()`, `createTestDataDir()`, `collectEvents()`, `arbCronExpression`, `arbEventPattern`, and `arbPriority` fast-check arbitraries
    - _Requirements: 1.2, 3.3, 5.5, 8.3, 10.2_

- [x] 2. Implement Scheduler module
  - [x] 2.1 Create Scheduler store and cron utilities
    - Create `packages/core/src/scheduler/cron-utils.ts` with `isValidCron(expr: string): boolean` and `getNextCronDate(expr: string, after?: Date): Date` using `cron-parser`
    - Create `packages/core/src/scheduler/scheduler-store.ts` with SQLite persistence layer: auto-migration on first call, methods for `save()`, `loadAll()`, `remove()`, `updateExecution()`
    - Use the schema from the design: `scheduled_jobs` table with indexes on `name` and `next_execution_at`
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 2.2 Implement Scheduler class
    - Create `packages/core/src/scheduler/scheduler.ts` with the full `Scheduler` class
    - Implement `register()` with validation (valid cron, non-empty name ≤128 chars, unique name), `remove()`, `list()`, `get()`
    - Implement `start()` to load persisted jobs and schedule timers, `stop()` to clear all timers
    - Use `setTimeout` chaining for next-tick scheduling (not `setInterval`)
    - Implement execution logic: submit intent to kernel, track `lastExecutionAt`, detect overlap (skip if still running), enforce 300s timeout via `AbortController`
    - Emit events: `scheduler.job.completed`, `scheduler.job.failed`, `scheduler.job.missed`, `scheduler.job.skipped`
    - Create barrel export `packages/core/src/scheduler/index.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 2.3 Write property tests for Scheduler (Properties 1–6)
    - Create `packages/core/src/scheduler/__tests__/scheduler.property.test.ts`
    - **Property 1: Cron expression validation** — generate random strings, verify accept/reject matches 5-field format rules
    - **Property 2: Scheduler registration round-trip** — generate valid inputs, verify list() contains job with all fields preserved
    - **Property 3: Scheduler removal invariant** — register then remove, verify list() excludes and get() returns undefined
    - **Property 4: Scheduler name uniqueness** — register two jobs with same name, verify second is rejected
    - **Property 5: Scheduler persistence survives restart** — register N jobs, stop/restart, verify all N present with recalculated nextExecutionAt
    - **Property 6: Missed execution detection** — set lastExecutionAt to past, restart, verify missed events emitted
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.5**

  - [ ]* 2.4 Write unit tests for Scheduler
    - Create `packages/core/src/scheduler/__tests__/scheduler.test.ts`
    - Test execution timing with fake timers, overlap skip behavior, timeout enforcement, event emission sequences, lifecycle start/stop
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 3. Implement BackgroundLoop module
  - [x] 3.1 Create BackgroundLoop store
    - Create `packages/core/src/background-loop/loop-store.ts` with SQLite persistence: auto-migration, `save()`, `loadAll()`, `remove()`, `updateState()`
    - Use the `background_loops` table schema from the design
    - _Requirements: 3.1, 3.8_

  - [x] 3.2 Implement BackgroundLoop class
    - Create `packages/core/src/background-loop/background-loop.ts` with `BackgroundLoopModule` class
    - Implement `register()` with validation (interval 1000–86,400,000 ms, duplicate ID check), `pause()`, `resume()`, `remove()`, `list()`
    - Implement `start()` to load persisted loops and resume active ones, `stop()` to clear all timers
    - Use `setTimeout` chaining per loop; store previous monitor return value in `Map<KernovaId, unknown>` for context threading
    - On monitor error: log, emit `loop.error`, continue next cycle
    - On non-null/non-undefined monitor result: submit intent, emit `loop.action.triggered`
    - On intent failure: emit `loop.action.failed`, continue polling
    - Emit lifecycle events: `loop.paused`, `loop.resumed`, `loop.removed`
    - Create barrel export `packages/core/src/background-loop/index.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 3.3 Write property tests for BackgroundLoop (Properties 7–13)
    - Create `packages/core/src/background-loop/__tests__/background-loop.property.test.ts`
    - **Property 7: Background loop interval bounds validation** — generate integers, verify accept iff 1000 ≤ N ≤ 86,400,000
    - **Property 8: Background loop pause/resume round-trip** — register active loop, pause, verify paused state, resume, verify active state
    - **Property 9: Background loop removal** — register loop (any state), remove, verify list() excludes it
    - **Property 10: Background loop error resilience** — register loop with throwing monitor, verify remains active after error
    - **Property 11: Background loop persistence with state preservation** — register mixed active/paused, restart, verify states preserved
    - **Property 12: Monitor result determines action** — invoke with various returns, verify intent submitted only for non-null/non-undefined
    - **Property 13: Monitor context threading** — verify each invocation receives previous return value, first gets null
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3**

  - [ ]* 3.4 Write unit tests for BackgroundLoop
    - Create `packages/core/src/background-loop/__tests__/background-loop.test.ts`
    - Test polling cycle with fake timers, intent submission flow, event emission, lifecycle transitions
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement TaskQueue module
  - [x] 5.1 Create TaskQueue store and dead-letter logic
    - Create `packages/core/src/task-queue/queue-store.ts` with SQLite persistence: auto-migration for `task_items` and `dead_letter_items` tables with all indexes from the design
    - Methods: `enqueue()`, `dequeue()` (ordered by priority ASC, created_at ASC where status='pending'), `updateStatus()`, `getStats()`, `getDeadLetters()`, `markReplayed()`
    - Create `packages/core/src/task-queue/dead-letter.ts` with dead-letter queue logic: `addToDeadLetter()`, `replayFromDeadLetter()`, `queryDeadLetters()`
    - _Requirements: 5.1, 5.3, 6.4, 7.1, 7.2, 7.4_

  - [x] 5.2 Implement TaskQueue class
    - Create `packages/core/src/task-queue/task-queue.ts` with full `TaskQueue` class
    - Implement `enqueue()` with validation (priority values, queue depth enforcement), `stats()`, `deadLetters()`, `replay()`
    - Implement processing loop with semaphore-based concurrency control (configurable 1–50, default 5)
    - Implement retry with exponential backoff: `min(baseDelay × 2^(attempt-1), maxDelay)`
    - Implement task timeout via `AbortController` + `setTimeout`
    - Implement `stop()` with graceful shutdown: wait up to `shutdownTimeout` ms for in-flight, then force-cancel
    - Emit events: `queue.task.enqueued`, `queue.task.completed`, `queue.task.dead-lettered`
    - Create barrel export `packages/core/src/task-queue/index.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 5.3 Write property tests for TaskQueue (Properties 14–22)
    - Create `packages/core/src/task-queue/__tests__/task-queue.property.test.ts`
    - **Property 14: Task enqueue with priority defaults** — generate valid inputs without priority, verify status "pending" and priority "medium"
    - **Property 15: Priority dequeue ordering** — enqueue mixed priorities/timestamps, verify dequeue order is strict priority then FIFO
    - **Property 16: Queue depth enforcement** — fill queue to max, verify next enqueue rejected
    - **Property 17: Exponential backoff calculation** — for attempts 1..N, verify delay = min(baseDelay × 2^(A-1), maxDelay)
    - **Property 18: Retry exhaustion leads to dead-lettering** — set maxRetries=N, fail N times, verify dead-lettered and no further retry
    - **Property 19: Concurrency limit enforcement** — set concurrency C, enqueue >C tasks, verify never more than C running simultaneously
    - **Property 20: Dead-letter data completeness** — dead-letter a task, verify record contains payload, error, error type, attempt timestamps
    - **Property 21: Dead-letter replay resets state** — replay a dead-lettered item, verify new pending task with attempt=0, original priority, DLQ marked "replayed"
    - **Property 22: Queue statistics accuracy** — perform various operations, verify stats() matches actual state
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.5**

  - [ ]* 5.4 Write unit tests for TaskQueue
    - Create `packages/core/src/task-queue/__tests__/task-queue.test.ts`
    - Test concurrency with mock handlers, shutdown timeout behavior, task timeout cancellation, event emission
    - _Requirements: 6.1, 6.5, 6.6, 6.7, 7.3_

- [x] 6. Implement ProactiveTriggerEngine module
  - [x] 6.1 Create TriggerEngine store
    - Create `packages/core/src/triggers/trigger-store.ts` with SQLite persistence: auto-migration for `trigger_rules` table with indexes from the design
    - Methods: `save()`, `loadAll()`, `remove()`, `updateEnabled()`, `updateLastFired()`
    - _Requirements: 8.1, 8.5_

  - [x] 6.2 Implement ProactiveTriggerEngine class
    - Create `packages/core/src/triggers/trigger-engine.ts` with full `ProactiveTriggerEngine` class
    - Implement `register()` with validation (event pattern syntax: dot-separated segments, each alphanumeric or `*`, ≤256 chars; duplicate combo check), `remove()`, `enable()`, `disable()`, `list()`
    - Implement `start()` to load persisted rules and subscribe to EventBus for enabled rules
    - Implement event evaluation: check cooldown → evaluate condition → fire action (submit intent)
    - Maintain `Map<KernovaId, string>` for subscription IDs, `Map<KernovaId, number>` for cooldown timestamps
    - Emit events: `trigger.fired`, `trigger.action.failed`, `trigger.condition.error`, `trigger.removed`
    - Handle condition errors: skip action, emit `trigger.condition.error`
    - Create barrel export `packages/core/src/triggers/index.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [ ]* 6.3 Write property tests for ProactiveTriggerEngine (Properties 23–26)
    - Create `packages/core/src/triggers/__tests__/trigger-engine.property.test.ts`
    - **Property 23: Trigger event pattern validation** — generate strings, verify accept iff dot-separated alphanumeric/`*` segments ≤256 chars
    - **Property 24: Trigger enabled/disabled state controls evaluation** — disable rule, emit matching event, verify no fire; enable, verify fires
    - **Property 25: Conditional trigger fires only when condition is true** — generate events and conditions, verify fires iff condition returns true (or no condition)
    - **Property 26: Cooldown enforcement** — fire rule, send matching event within cooldown, verify ignored
    - **Validates: Requirements 8.2, 8.3, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9**

  - [ ]* 6.4 Write unit tests for ProactiveTriggerEngine
    - Create `packages/core/src/triggers/__tests__/trigger-engine.test.ts`
    - Test EventBus subscription lifecycle, cooldown with mock timers, condition error handling, duplicate rule rejection
    - _Requirements: 8.4, 8.7, 9.5, 9.6, 9.7_

- [x] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement ConnectorRegistry and Channel Adapters
  - [x] 8.1 Create ChannelAdapter interface and adapter stubs
    - Create `packages/core/src/channels/channel-adapter.ts` defining the `ChannelAdapter` interface with `connect()`, `disconnect()`, `send()`, `onMessage()`, `onStateChange()`, `channelType`, `state`
    - Create adapter stubs in `packages/core/src/channels/adapters/`: `slack-adapter.ts`, `discord-adapter.ts`, `whatsapp-adapter.ts`, `telegram-adapter.ts`, `email-adapter.ts` — each implementing the `ChannelAdapter` interface with basic structure (connection logic can remain as stubs for now)
    - _Requirements: 10.3, 10.4_

  - [x] 8.2 Implement ConnectorRegistry class
    - Create `packages/core/src/channels/connector-registry.ts` with full `ConnectorRegistry` class
    - Implement `register()` with config schema validation per channel type, `connect()`, `disconnect()`, `send()`, `status()`
    - Implement inbound message handling: normalization (sender ≤256, content ≤32000, valid timestamp), intent submission, validation rejection
    - Implement outbound routing: find connector by ID, check connected state, route to adapter, handle delivery timeout (30s), handle structured content degradation
    - Implement reconnection with exponential backoff (1000ms start, 60000ms cap)
    - Emit events: `channel.connected`, `channel.connection.failed`, `channel.disconnected`, `channel.message.received`, `channel.message.sent`, `channel.message.failed`, `channel.message.invalid`, `channel.message.partial`
    - Create barrel export `packages/core/src/channels/index.ts`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ]* 8.3 Write property tests for ConnectorRegistry (Properties 27–31)
    - Create `packages/core/src/channels/__tests__/connector-registry.property.test.ts`
    - **Property 27: Inbound message normalization** — generate valid RawInboundMessages, verify normalized InboundMessage preserves fields and intent submitted
    - **Property 28: Inbound message validation rejects invalid input** — generate messages missing fields or with oversized content, verify discard + event emitted
    - **Property 29: Outbound routing to correct connector** — register connected connector, send message, verify routed to correct adapter
    - **Property 30: Outbound to invalid connector rejected without event** — send to unregistered/disconnected ID, verify error thrown and no failed event
    - **Property 31: Structured content graceful degradation** — send structured content to adapter that doesn't support it, verify text delivered + partial event
    - **Validates: Requirements 11.1, 11.3, 11.4, 12.1, 12.5, 12.6**

  - [ ]* 8.4 Write unit tests for ConnectorRegistry
    - Create `packages/core/src/channels/__tests__/connector-registry.test.ts`
    - Test connection lifecycle, reconnection backoff, delivery timeout, adapter integration, config validation
    - _Requirements: 10.2, 10.4, 10.5, 10.6, 10.7, 11.5, 12.2, 12.3, 12.7_

- [x] 9. Integrate autonomy modules into KernovaKernel
  - [x] 9.1 Extend KernovaKernel with autonomy module instantiation and lifecycle
    - Modify `packages/core/src/kernel.ts`:
      - Import Scheduler, BackgroundLoopModule, TaskQueue, ProactiveTriggerEngine, ConnectorRegistry
      - Add private readonly fields for each module
      - Instantiate each module in constructor, passing EventBus and `{ dataDir }` config
      - Add read-only getter properties: `scheduler`, `loops`, `taskQueue`, `triggers`, `channels`
      - Update `start()`: after EventBus start, start modules in order (Scheduler → BackgroundLoop → TaskQueue → Triggers → Channels), then emit `kernel.started`. If any module fails, stop previously started modules in reverse and throw.
      - Update `stop()`: before EventBus stop, stop modules in reverse order (Channels → Triggers → TaskQueue → BackgroundLoop → Scheduler). If a module fails to stop, continue stopping others and emit `kernel.module.stopFailed`.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 9.2 Write integration tests for kernel autonomy lifecycle
    - Create `packages/core/src/__tests__/kernel-autonomy.test.ts`
    - Test full startup order, shutdown reverse order, module failure during start triggers rollback, module failure during stop continues + emits event
    - Test getter property access for all five modules
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (31 total, using fast-check)
- Unit tests validate specific examples, edge cases, and timing-dependent logic
- All modules use the established Kernova pattern: EventBus injection, SQLite persistence, start/stop lifecycle
- TypeScript is used throughout (matching the design document)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "5.1", "6.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "5.2", "6.2", "8.1"] },
    { "id": 4, "tasks": ["2.3", "2.4", "3.3", "3.4", "5.3", "5.4", "6.3", "6.4", "8.2"] },
    { "id": 5, "tasks": ["8.3", "8.4"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2"] }
  ]
}
```
