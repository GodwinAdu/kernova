# Requirements Document

## Introduction

This feature adds the missing autonomous agent infrastructure to Kernova — an open-source Intelligent Systems Runtime published as @kernova/sdk, @kernova/core, @kernova/cli, @kernova/types. The goal is to enable developers to build always-on, self-running AI agents using Kernova as their underlying platform. This includes renaming internal identifiers from "Nexus" to "Kernova", enhancing the daemon mode for persistent execution, extending the scheduler and task queue, adding a channel system for pluggable messaging, introducing agent config files, built-in tools, self-reflection, proactive triggers, and conversation threads — all exposed through the SDK and CLI.

Key distinction: Kernova is a DEVELOPER PLATFORM (analogous to Node.js). It provides the infrastructure primitives that allow developers to build their own autonomous agent products.

## Glossary

- **Kernel**: The central runtime orchestrator class (currently `NexusKernel`, to become `KernovaKernel`) that manages all subsystems including events, memory, agents, models, and autonomy modules.
- **Daemon**: A long-running background process that keeps the Kernel alive, manages graceful shutdown, and coordinates all autonomy modules (scheduler, loops, task queue, triggers).
- **Scheduler**: The cron-based job scheduling subsystem that fires recurring or one-shot tasks at specified intervals, persisted in SQLite.
- **Task_Queue**: An async execution queue with priority levels, retry logic with exponential backoff, and a dead-letter queue for failed tasks, backed by SQLite.
- **Channel**: A pluggable message transport (Webhook, WebSocket, or custom adapter) that receives inbound messages and sends outbound messages.
- **Background_Loop**: A continuously-running monitor function that executes at a configured interval, used for health checks and periodic work.
- **Trigger**: A rule-based engine that listens to events on the EventBus and fires intents when conditions are met, with cooldown support.
- **Agent_Config**: A YAML or JSON file that declaratively defines an agent's name, instructions, tools, schedules, and triggers, loaded at startup with hot-reload support.
- **Built_In_Tool**: A pre-packaged tool shipped with @kernova/core that agents can use without external dependencies (web-search, http-fetch, file-read, file-write, shell-exec, date-time).
- **Self_Reflection**: A module that evaluates agent responses against quality criteria and optionally regenerates the response if it falls below a confidence threshold.
- **Conversation_Thread**: A multi-turn conversation session with sliding window context management and automatic summarization of older messages.
- **Planner**: A module implementing the plan-and-execute pattern that decomposes complex goals into ordered steps and executes them sequentially.
- **SDK**: The high-level developer API (@kernova/sdk) that provides fluent methods like `app.schedule()`, `app.channel()`, `app.serve()`.
- **CLI**: The command-line interface (@kernova/cli) with commands like `kernova serve`, `kernova init`, `kernova schedule list`, `kernova queue status`.

## Requirements

### Requirement 1: Rename Internal Identifiers

**User Story:** As a developer using Kernova, I want all public API identifiers to use the "Kernova" brand consistently, so that the codebase identity matches the published npm package names.

#### Acceptance Criteria

1. THE Core_Package SHALL export a class named `KernovaKernel` as the primary runtime class
2. THE Core_Package SHALL export `KernovaKernel` under the alias `NexusKernel` for backward compatibility
3. THE SDK_Package SHALL export a class named `Kernova` (replacing `Nexus`) as the high-level API entry point
4. THE SDK_Package SHALL export `Kernova` under the alias `Nexus` for backward compatibility
5. WHEN a developer imports from @kernova/core, THE Core_Package SHALL provide `KernovaKernel` as the default kernel class
6. THE Types_Package SHALL rename all type prefixes from `Nexus` to `Kernova` (e.g., `NexusEvent` becomes `KernovaEvent`, `NexusId` becomes `KernovaId`)
7. THE Types_Package SHALL export deprecated aliases for all renamed types to maintain backward compatibility

### Requirement 2: Daemon Mode for Persistent Execution

**User Story:** As a developer, I want a daemon mode that keeps my agent running continuously in the background, so that I can deploy autonomous agents that operate without manual intervention.

#### Acceptance Criteria

1. THE CLI SHALL provide a `kernova serve` command that starts the Kernel in daemon mode
2. WHEN `kernova serve` is invoked, THE Daemon SHALL start the Kernel, all registered autonomy modules, and begin processing scheduled jobs and triggers
3. WHILE the Daemon is running, THE Daemon SHALL handle SIGINT and SIGTERM signals for graceful shutdown
4. WHEN a graceful shutdown signal is received, THE Daemon SHALL wait up to 30 seconds for active intents to complete before forcing termination
5. WHILE the Daemon is running, THE Daemon SHALL emit a heartbeat event every 60 seconds to the EventBus
6. IF the Kernel fails to start, THEN THE Daemon SHALL log the error with a descriptive message and exit with a non-zero exit code
7. THE Daemon SHALL accept a `--config` flag pointing to an agent config file or directory of config files to load at startup
8. THE SDK SHALL provide an `app.serve()` method that starts the Kernel in daemon mode programmatically

### Requirement 3: Scheduler Enhancement

**User Story:** As a developer, I want to schedule recurring and one-time tasks for my agents using cron expressions or delay-based timing, so that agents can perform periodic work autonomously.

#### Acceptance Criteria

1. THE Scheduler SHALL accept 5-field cron expressions (minute, hour, day-of-month, month, day-of-week) for recurring job definitions
2. THE Scheduler SHALL support one-shot delayed jobs specified by a duration in milliseconds from the time of creation
3. WHEN a scheduled job fires, THE Scheduler SHALL emit a `scheduler.job.fired` event on the EventBus with the job ID and name
4. THE Scheduler SHALL persist all job definitions and their execution history in SQLite
5. WHEN the Daemon restarts, THE Scheduler SHALL resume all previously registered enabled jobs without re-registration
6. THE SDK SHALL provide an `app.schedule(name, cronOrDelay, handler)` method that registers a scheduled job
7. THE CLI SHALL provide a `kernova schedule list` command that displays all registered jobs with their next execution time
8. THE CLI SHALL provide a `kernova schedule enable <id>` and `kernova schedule disable <id>` commands
9. IF a scheduled job handler throws an error, THEN THE Scheduler SHALL emit a `scheduler.job.failed` event and log the error without stopping other jobs

### Requirement 4: Task Queue with Priorities and Retries

**User Story:** As a developer, I want an async task queue with priority levels and automatic retries, so that I can offload heavy operations and handle transient failures gracefully.

#### Acceptance Criteria

1. THE Task_Queue SHALL support four priority levels: critical, high, medium, low
2. THE Task_Queue SHALL process tasks in priority order, with FIFO ordering within the same priority level
3. WHEN a task handler throws an error, THE Task_Queue SHALL retry the task with exponential backoff up to the configured maximum retry count (default: 3)
4. WHEN a task exceeds its maximum retry count, THE Task_Queue SHALL move the task to the dead-letter queue
5. THE Task_Queue SHALL persist all tasks and their status in SQLite
6. THE SDK SHALL provide an `app.enqueue(handler, payload, options)` method that adds a task to the queue
7. THE CLI SHALL provide a `kernova queue status` command that displays queue statistics (pending, active, completed, failed, dead-lettered counts)
8. THE CLI SHALL provide a `kernova queue replay <id>` command that moves a dead-lettered task back to the pending queue
9. WHILE the Task_Queue is processing, THE Task_Queue SHALL respect a configurable concurrency limit (default: 5 concurrent tasks)

### Requirement 5: Channel System for Pluggable Messaging

**User Story:** As a developer, I want a pluggable channel system with adapters for Webhook and WebSocket transports, so that my agents can receive and send messages through multiple communication protocols.

#### Acceptance Criteria

1. THE Channel_System SHALL define a `ChannelAdapter` interface with `connect()`, `disconnect()`, `send(message)`, and `onMessage(handler)` methods
2. THE Core_Package SHALL ship with a built-in WebhookAdapter that receives messages via HTTP POST and sends responses
3. THE Core_Package SHALL ship with a built-in WebSocketAdapter that maintains persistent bidirectional connections
4. WHEN an inbound message arrives on any channel, THE Channel_System SHALL emit a `channel.message.received` event on the EventBus
5. THE SDK SHALL provide an `app.channel(name, adapter)` method that registers a channel adapter
6. THE SDK SHALL provide an `app.onMessage(handler)` method that registers a handler for all inbound messages across all channels
7. IF a channel adapter fails to connect, THEN THE Channel_System SHALL emit a `channel.connection.failed` event and retry connection with exponential backoff up to 5 attempts
8. WHILE a WebSocket channel is connected, THE Channel_System SHALL send ping frames every 30 seconds to detect stale connections

### Requirement 6: Conversation Threads with Context Management

**User Story:** As a developer, I want multi-turn conversation management with automatic context windowing, so that agents can maintain coherent long-running dialogues without exceeding token limits.

#### Acceptance Criteria

1. THE Conversation_Manager SHALL maintain per-thread message history with a configurable sliding window size (default: 50 messages)
2. WHEN the message count exceeds the sliding window size, THE Conversation_Manager SHALL summarize the oldest messages using the configured model and replace them with the summary
3. THE Conversation_Manager SHALL support creating, retrieving, and archiving conversation threads identified by a unique thread ID
4. THE SDK SHALL provide an `app.thread(threadId)` method that returns a thread handle for adding messages and retrieving context
5. WHEN a thread is retrieved, THE Conversation_Manager SHALL return the full context (summary + recent messages) formatted for model consumption
6. THE Conversation_Manager SHALL persist all threads and messages in SQLite

### Requirement 7: Agent Planning (Plan-and-Execute Pattern)

**User Story:** As a developer, I want agents to automatically decompose complex goals into executable steps, so that multi-step tasks are handled reliably with clear progress tracking.

#### Acceptance Criteria

1. WHEN a goal is submitted to the Planner, THE Planner SHALL generate an ordered list of steps using the configured model
2. THE Planner SHALL execute steps sequentially, passing the output of each step as context to the next
3. IF a step fails, THEN THE Planner SHALL attempt to replan the remaining steps based on the error context
4. WHILE a plan is executing, THE Planner SHALL emit `plan.step.started` and `plan.step.completed` events for each step
5. THE SDK SHALL provide an `app.plan(goal, options)` method that invokes the planner and returns the final result
6. THE Planner SHALL support a maximum step limit (default: 10) to prevent unbounded execution

### Requirement 8: Agent Config Files (Declarative Agent Definition)

**User Story:** As a developer, I want to define agents declaratively in YAML or JSON config files, so that I can configure agent behavior without writing code and hot-reload changes during development.

#### Acceptance Criteria

1. THE Config_Loader SHALL parse agent definition files in YAML format with the `.agent.yaml` or `.agent.yml` extension
2. THE Config_Loader SHALL parse agent definition files in JSON format with the `.agent.json` extension
3. WHEN a config file defines an agent with `name`, `instructions`, `tools`, `schedules`, and `triggers` fields, THE Config_Loader SHALL register the agent with the Kernel using those parameters
4. WHEN the `--watch` flag is passed to `kernova serve`, THE Config_Loader SHALL watch config files for changes and hot-reload agent definitions without restarting the Daemon
5. IF a config file contains invalid syntax or missing required fields, THEN THE Config_Loader SHALL log a validation error with the file path and line number and skip that file
6. THE CLI `kernova init` command SHALL generate a starter `.agent.yaml` file in the project directory
7. THE Config_Loader SHALL support an `extends` field that allows one config file to inherit from another

### Requirement 9: Built-in Tools

**User Story:** As a developer, I want a set of pre-packaged tools that agents can use out of the box, so that common operations like web fetching and file I/O work without installing additional plugins.

#### Acceptance Criteria

1. THE Core_Package SHALL provide a `http-fetch` built-in tool that makes HTTP requests and returns the response body and status
2. THE Core_Package SHALL provide a `file-read` built-in tool that reads file contents from the local filesystem within a configured sandbox directory
3. THE Core_Package SHALL provide a `file-write` built-in tool that writes content to files within the configured sandbox directory
4. THE Core_Package SHALL provide a `shell-exec` built-in tool that executes shell commands within the sandbox with a configurable timeout (default: 30 seconds)
5. THE Core_Package SHALL provide a `date-time` built-in tool that returns the current date, time, and timezone information
6. THE Core_Package SHALL provide a `web-search` built-in tool that performs web searches using a configurable search provider
7. WHEN `shell-exec` is invoked, THE Tool SHALL enforce the sandbox policy and reject commands that access paths outside the allowed directory
8. THE SDK SHALL allow enabling or disabling individual built-in tools via configuration

### Requirement 10: Self-Reflection Module

**User Story:** As a developer, I want agents to evaluate their own responses and regenerate them when quality is insufficient, so that output quality is maintained without manual oversight.

#### Acceptance Criteria

1. WHEN self-reflection is enabled, THE Reflection_Module SHALL evaluate each agent response against configured quality criteria using the model
2. THE Reflection_Module SHALL assign a confidence score between 0.0 and 1.0 to each evaluated response
3. IF the confidence score falls below the configured threshold (default: 0.7), THEN THE Reflection_Module SHALL regenerate the response with additional context about what was insufficient
4. THE Reflection_Module SHALL limit regeneration attempts to a configurable maximum (default: 2) to prevent infinite loops
5. WHEN a response is regenerated, THE Reflection_Module SHALL emit a `reflection.regenerated` event with the original and new confidence scores
6. THE SDK SHALL allow enabling self-reflection per-agent via the agent definition or globally via Kernel config

### Requirement 11: Proactive Triggers (Rule Engine)

**User Story:** As a developer, I want to define event-driven rules that automatically fire agent actions when conditions are met, so that agents can respond proactively to system events without polling.

#### Acceptance Criteria

1. THE Trigger_Engine SHALL evaluate rules against events published on the EventBus using event pattern matching (glob-style wildcards)
2. WHEN an event matches a trigger rule's pattern and condition, THE Trigger_Engine SHALL submit an intent with the configured goal and priority
3. THE Trigger_Engine SHALL enforce a per-rule cooldown period (default: 1000ms) to prevent trigger storms
4. THE Trigger_Engine SHALL persist trigger rule definitions in SQLite
5. THE SDK SHALL provide an `app.trigger(name, eventPattern, handler)` method that registers a trigger rule
6. THE CLI SHALL provide a `kernova triggers list` command that displays all registered trigger rules with their enabled status
7. IF a trigger's intent submission fails, THEN THE Trigger_Engine SHALL emit a `trigger.action.failed` event and log the error without disabling the trigger

### Requirement 12: CLI Enhancements

**User Story:** As a developer, I want CLI commands for managing the runtime, schedules, queues, and triggers, so that I can operate and inspect my autonomous agents from the terminal.

#### Acceptance Criteria

1. THE CLI SHALL provide a `kernova serve` command that starts the daemon with options for `--config`, `--watch`, `--port`, and `--data-dir`
2. THE CLI SHALL provide a `kernova init` command that scaffolds a new Kernova project with a `package.json`, starter agent config file, and example code
3. THE CLI SHALL provide a `kernova schedule list` command that displays all scheduled jobs in a table format
4. THE CLI SHALL provide a `kernova queue status` command that displays task queue statistics
5. THE CLI SHALL provide a `kernova queue replay <id>` command that replays a dead-lettered task
6. THE CLI SHALL provide a `kernova triggers list` command that displays all trigger rules
7. THE CLI SHALL provide a `kernova status` command that displays the Kernel's running state, registered agents, active modules, and resource usage

### Requirement 13: SDK Fluent API Extensions

**User Story:** As a developer, I want fluent SDK methods for all autonomy features, so that I can configure schedules, channels, queues, and triggers with minimal boilerplate code.

#### Acceptance Criteria

1. THE SDK SHALL provide an `app.schedule(name, cronOrDelay, handler)` method that returns the SDK instance for chaining
2. THE SDK SHALL provide an `app.channel(name, adapter)` method that registers a channel adapter and returns the SDK instance
3. THE SDK SHALL provide an `app.onMessage(handler)` method that registers a global message handler
4. THE SDK SHALL provide an `app.serve(options)` method that starts the Kernel in daemon mode and returns a Promise that resolves when the daemon stops
5. THE SDK SHALL provide an `app.enqueue(handler, payload, options)` method that adds a task to the queue
6. THE SDK SHALL provide an `app.trigger(name, eventPattern, handler)` method that registers a proactive trigger
7. THE SDK SHALL provide an `app.plan(goal, options)` method that invokes the agent planner
8. THE SDK SHALL provide an `app.thread(threadId)` method that returns a conversation thread handle
9. THE SDK SHALL export the `Kernova` class as the primary entry point, with `Nexus` as a deprecated alias

