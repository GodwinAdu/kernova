# Requirements Document

## Introduction

The Core Autonomy feature set adds five foundational capabilities to the Kernova Intelligent Systems Runtime that enable agents to operate proactively and autonomously without continuous human prompting. These capabilities include scheduled task execution, continuous background monitoring, prioritized async task queuing, event-driven proactive triggers, and multi-channel communication connectors. Each feature integrates into the existing KernovaKernel architecture via the EventBus, follows the established module pattern, and persists state through SQLite via better-sqlite3.

## Glossary

- **Scheduler**: The module responsible for registering, persisting, and executing cron-based scheduled tasks within the Kernova runtime
- **Background_Loop**: The module that continuously monitors conditions and executes proactive agent actions at configurable intervals
- **Task_Queue**: The module that manages asynchronous task execution with priority ordering, retry logic, and dead-letter handling
- **Proactive_Trigger_Engine**: The module that evaluates event-driven rules and initiates agent actions when specified conditions are met
- **Channel_Connector**: An adapter that enables the runtime to receive inbound messages from and send outbound messages to external communication platforms
- **Connector_Registry**: The module that manages registration, lifecycle, and routing for all Channel_Connector instances
- **Scheduled_Job**: A persistent record representing a recurring task bound to a cron expression and an agent or intent
- **Task_Item**: A unit of work enqueued in the Task_Queue with priority, payload, retry metadata, and status
- **Dead_Letter_Queue**: A storage destination for Task_Items that have exhausted all retry attempts
- **Trigger_Rule**: A declarative rule that specifies an event pattern, optional conditions, and an action to execute when matched
- **KernovaKernel**: The central runtime class that orchestrates all Kernova subsystems
- **EventBus**: The pub/sub event system supporting wildcard pattern subscriptions that serves as the nervous system of the runtime
- **Channel**: An external communication platform (Slack, Discord, WhatsApp, Telegram, or Email)

## Requirements

### Requirement 1: Scheduler Registration and Persistence

**User Story:** As a developer, I want to register cron-based scheduled jobs for agents, so that tasks execute automatically on a recurring basis without manual intervention.

#### Acceptance Criteria

1. WHEN a Scheduled_Job is registered with a valid cron expression, a non-empty job name (maximum 128 characters), and a target intent or agent identifier, THE Scheduler SHALL persist the job definition to SQLite and confirm registration by returning a unique job identifier
2. WHEN a Scheduled_Job is registered with an invalid cron expression, THE Scheduler SHALL reject the registration and return a validation error indicating which field failed validation and the reason for rejection
3. THE Scheduler SHALL support standard five-field cron expressions (minute, hour, day-of-month, month, day-of-week) including the special characters `*`, `,`, `-`, and `/`, and SHALL reject expressions that do not conform to this five-field format
4. WHEN the KernovaKernel starts, THE Scheduler SHALL load all persisted Scheduled_Jobs from SQLite and schedule each job's next execution based on the current time
5. WHEN a Scheduled_Job is removed, THE Scheduler SHALL delete the job from SQLite, cancel any pending scheduled trigger for that job, and cease future executions of that job
6. THE Scheduler SHALL expose a list method that returns all registered Scheduled_Jobs including each job's identifier, name, cron expression, target intent or agent identifier, and next calculated execution time, and SHALL return an empty collection when no jobs are registered
7. IF a Scheduled_Job is registered with a name that already exists, THEN THE Scheduler SHALL reject the registration and return a validation error indicating the duplicate name

### Requirement 2: Scheduler Execution

**User Story:** As a developer, I want scheduled jobs to fire reliably at their designated times, so that agents perform recurring tasks on time.

#### Acceptance Criteria

1. WHEN the current time matches a Scheduled_Job cron expression, THE Scheduler SHALL submit the associated intent to the KernovaKernel for execution within 5 seconds of the scheduled tick
2. WHEN a Scheduled_Job execution completes, THE Scheduler SHALL emit a "scheduler.job.completed" event on the EventBus with the job identifier, execution start timestamp, and execution result
3. IF a Scheduled_Job execution fails, THEN THE Scheduler SHALL emit a "scheduler.job.failed" event on the EventBus with the job identifier, execution start timestamp, and error details including the error message
4. WHILE the KernovaKernel is stopped, THE Scheduler SHALL not execute any Scheduled_Jobs
5. WHEN the KernovaKernel starts after downtime, THE Scheduler SHALL compare each Scheduled_Job's last execution timestamp against its cron expression to detect missed executions, and emit a "scheduler.job.missed" event for each missed occurrence without automatically re-executing them
6. IF a Scheduled_Job trigger fires while the previous execution of the same job is still running, THEN THE Scheduler SHALL skip the trigger and emit a "scheduler.job.skipped" event on the EventBus with the job identifier
7. THE Scheduler SHALL enforce a maximum execution timeout of 300 seconds per Scheduled_Job, after which the execution is terminated and treated as a failure

### Requirement 3: Background Loop Registration and Lifecycle

**User Story:** As a developer, I want to register background loops that continuously monitor conditions, so that agents act proactively on changing state.

#### Acceptance Criteria

1. WHEN a Background_Loop is registered with a polling interval and a monitor function, THE Background_Loop module SHALL persist the loop configuration to SQLite, confirm registration by returning the loop identifier, and begin execution at the specified interval
2. THE Background_Loop module SHALL support configurable polling intervals with a minimum of 1000 milliseconds and a maximum of 86,400,000 milliseconds (24 hours)
3. IF a Background_Loop is registered with a polling interval below 1000 milliseconds or above 86,400,000 milliseconds, THEN THE Background_Loop module SHALL reject the registration and return a descriptive validation error
4. WHEN a Background_Loop is paused, THE Background_Loop module SHALL stop polling and emit a "loop.paused" event on the EventBus with the loop identifier
5. WHEN a paused Background_Loop is resumed, THE Background_Loop module SHALL restart polling from the next interval boundary and emit a "loop.resumed" event on the EventBus with the loop identifier
6. WHEN a Background_Loop is removed, THE Background_Loop module SHALL stop polling, remove the configuration from SQLite, and emit a "loop.removed" event on the EventBus with the loop identifier
7. WHILE the KernovaKernel is running, THE Background_Loop module SHALL recover from errors thrown by the monitor function by logging the error, emitting a "loop.error" event on the EventBus with the loop identifier and error details, and continuing the next polling cycle
8. WHEN the KernovaKernel starts, THE Background_Loop module SHALL load all persisted Background_Loops from SQLite and resume scheduling for loops that were in an active state, while preserving the paused state for loops that were paused
9. IF a Background_Loop is registered with an identifier that already exists, THEN THE Background_Loop module SHALL reject the registration and return a descriptive error indicating the duplicate identifier

### Requirement 4: Background Loop Execution

**User Story:** As a developer, I want background loops to invoke agent actions when conditions are detected, so that agents respond to environmental changes automatically.

#### Acceptance Criteria

1. WHEN a Background_Loop monitor function returns a non-null, non-undefined value, THE Background_Loop module SHALL treat the value as an actionable result and submit the corresponding intent to the KernovaKernel for execution
2. WHEN a Background_Loop monitor function returns null or undefined, THE Background_Loop module SHALL take no action and wait for the next polling cycle
3. THE Background_Loop module SHALL pass the previous monitor return value as execution context to each monitor invocation, supplying null as the context on the first invocation after registration or resumption, so that monitors can detect state changes between cycles
4. WHEN a Background_Loop submits an intent, THE Background_Loop module SHALL emit a "loop.action.triggered" event on the EventBus with the loop identifier and intent details
5. IF the KernovaKernel rejects or fails to execute an intent submitted by a Background_Loop, THEN THE Background_Loop module SHALL emit a "loop.action.failed" event on the EventBus with the loop identifier and error details, and continue polling on the next cycle

### Requirement 5: Task Queue Enqueue and Priority

**User Story:** As a developer, I want to enqueue tasks with priorities, so that critical work executes before lower-priority tasks.

#### Acceptance Criteria

1. WHEN a Task_Item is enqueued with a valid priority, THE Task_Queue SHALL persist the item to SQLite with a status of "pending" and return the task identifier
2. THE Task_Queue SHALL support four priority levels: critical, high, medium, and low, with "medium" as the default when no priority is specified
3. WHEN multiple Task_Items are pending, THE Task_Queue SHALL dequeue items in priority order (critical > high > medium > low), with earlier-enqueued items processed first within the same priority level
4. WHEN a Task_Item is enqueued, THE Task_Queue SHALL emit a "queue.task.enqueued" event on the EventBus with the task identifier and priority
5. IF a Task_Item is enqueued with a priority value not in the supported set, THEN THE Task_Queue SHALL reject the enqueue request and return a validation error indicating the invalid priority
6. THE Task_Queue SHALL enforce a configurable maximum queue depth that defaults to 1000 pending items
7. IF a Task_Item is enqueued and the number of pending items has reached the configured maximum queue depth, THEN THE Task_Queue SHALL reject the item and return an error indicating the queue is full

### Requirement 6: Task Queue Execution and Retry

**User Story:** As a developer, I want the task queue to process items with configurable concurrency and automatic retries, so that transient failures are handled without manual intervention.

#### Acceptance Criteria

1. THE Task_Queue SHALL process Task_Items with a configurable concurrency limit between 1 and 50 that defaults to 5 concurrent executions, updating each dequeued item's status to "running" before invoking its handler
2. WHEN a Task_Item execution fails and retry attempts remain, THE Task_Queue SHALL re-enqueue the item with an incremented attempt count and an exponential backoff delay calculated as min(base_delay × 2^(attempt - 1), max_delay), where base_delay defaults to 1000 milliseconds and max_delay defaults to 30000 milliseconds
3. THE Task_Queue SHALL support a configurable maximum retry count that defaults to 3 attempts
4. WHEN a Task_Item has exhausted all retry attempts, THE Task_Queue SHALL move the item to the Dead_Letter_Queue and emit a "queue.task.dead-lettered" event on the EventBus with the task identifier and the final error details
5. WHEN a Task_Item execution succeeds, THE Task_Queue SHALL update the item status to "completed" and emit a "queue.task.completed" event on the EventBus with the task identifier
6. IF a Task_Item execution exceeds a configurable timeout that defaults to 30000 milliseconds, THEN THE Task_Queue SHALL cancel the execution, update the item status to "failed", and apply the retry policy
7. WHILE the KernovaKernel is stopping, THE Task_Queue SHALL wait up to 10000 milliseconds for in-flight Task_Items to complete, then cancel any remaining executions, mark them as "failed", and apply the retry policy for each

### Requirement 7: Task Queue Dead-Letter and Observability

**User Story:** As a developer, I want visibility into failed tasks and the ability to replay them, so that I can diagnose and recover from persistent failures.

#### Acceptance Criteria

1. THE Task_Queue SHALL persist Dead_Letter_Queue items in SQLite with the original payload, the final error message, the error type string, and a timestamp for each execution attempt
2. WHEN a developer requests replay of a dead-lettered Task_Item, THE Task_Queue SHALL re-enqueue the item with reset attempt count and original priority, set its status to "pending", and mark the Dead_Letter_Queue record as "replayed"
3. IF a developer requests replay of a Task_Item identifier that does not exist in the Dead_Letter_Queue, THEN THE Task_Queue SHALL return an error indicating the item was not found
4. THE Task_Queue SHALL expose a method to query dead-lettered items filtered by dead-lettered-at timestamp range and error type, returning at most 100 items ordered by dead-lettered-at descending
5. THE Task_Queue SHALL expose queue statistics including pending count, active count, completed count, failed count, and dead-letter count, each reflecting the current persisted state at the time of the call

### Requirement 8: Proactive Trigger Rule Registration

**User Story:** As a developer, I want to define event-driven trigger rules, so that agents react automatically when specific conditions occur in the runtime.

#### Acceptance Criteria

1. WHEN a Trigger_Rule is registered with an event pattern, optional condition, and action, THE Proactive_Trigger_Engine SHALL persist the rule to SQLite, activate event listening, and return the assigned rule identifier to the caller
2. THE Proactive_Trigger_Engine SHALL support EventBus wildcard patterns consisting of dot-separated segments where each segment is either a literal alphanumeric string or the "*" wildcard character, with a maximum pattern length of 256 characters (e.g., "intent.*", "*.completed")
3. WHEN a Trigger_Rule is registered with an event pattern that does not conform to the valid pattern syntax, THE Proactive_Trigger_Engine SHALL reject the registration and return a validation error indicating the reason the pattern is invalid
4. WHEN a Trigger_Rule is removed, THE Proactive_Trigger_Engine SHALL unsubscribe from the EventBus, delete the rule from SQLite, and emit a "trigger.removed" event with the rule identifier
5. WHEN the KernovaKernel starts, THE Proactive_Trigger_Engine SHALL load all persisted Trigger_Rules from SQLite and re-subscribe to the EventBus only for rules that are in the enabled state
6. WHILE a Trigger_Rule is in the disabled state, THE Proactive_Trigger_Engine SHALL not evaluate or match incoming events against that rule, and WHEN the rule is re-enabled, THE Proactive_Trigger_Engine SHALL resume event matching for that rule
7. IF a Trigger_Rule is registered with an event pattern and condition combination that is identical to an already-registered rule, THEN THE Proactive_Trigger_Engine SHALL reject the registration and return an error indicating a duplicate rule exists

### Requirement 9: Proactive Trigger Evaluation and Execution

**User Story:** As a developer, I want trigger rules to evaluate conditions and fire actions, so that complex event-driven automations execute without manual orchestration.

#### Acceptance Criteria

1. WHEN an event matching a Trigger_Rule pattern is received and the rule has a condition defined, THE Proactive_Trigger_Engine SHALL evaluate the rule condition against the event data
2. WHEN an event matching a Trigger_Rule pattern is received and the rule has no condition defined, THE Proactive_Trigger_Engine SHALL treat the rule as unconditionally matched and proceed to execute the associated action
3. WHEN a Trigger_Rule condition evaluates to true, THE Proactive_Trigger_Engine SHALL execute the associated action by submitting an intent to the KernovaKernel
4. WHEN a Trigger_Rule condition evaluates to false, THE Proactive_Trigger_Engine SHALL take no action for that event
5. WHEN a Trigger_Rule action is executed, THE Proactive_Trigger_Engine SHALL emit a "trigger.fired" event on the EventBus with the rule identifier, triggering event, and submitted intent identifier
6. IF a Trigger_Rule action execution fails, THEN THE Proactive_Trigger_Engine SHALL emit a "trigger.action.failed" event on the EventBus with the rule identifier, the triggering event identifier, and an error message indicating the failure reason
7. IF a Trigger_Rule condition evaluation throws an error, THEN THE Proactive_Trigger_Engine SHALL skip action execution for that event and emit a "trigger.condition.error" event on the EventBus with the rule identifier and error details
8. THE Proactive_Trigger_Engine SHALL support a configurable cooldown period per Trigger_Rule, with a minimum value of 100 milliseconds and a default of 1000 milliseconds, during which subsequent matching events for that rule SHALL be ignored without evaluation
9. WHILE a Trigger_Rule is disabled, THE Proactive_Trigger_Engine SHALL skip evaluation and take no action for events matching that rule's pattern

### Requirement 10: Channel Connector Registration and Lifecycle

**User Story:** As a developer, I want to register channel connectors for external platforms, so that agents can communicate through Slack, Discord, WhatsApp, Telegram, and Email.

#### Acceptance Criteria

1. WHEN a Channel_Connector is registered with a channel type and configuration, THE Connector_Registry SHALL validate the configuration schema for the specified channel type and store the connector definition
2. IF a Channel_Connector is registered with an invalid or incomplete configuration, THEN THE Connector_Registry SHALL reject the registration and return a descriptive validation error indicating the missing or invalid fields
3. THE Connector_Registry SHALL support registering connectors for Slack, Discord, WhatsApp, Telegram, and Email channel types
4. WHEN a Channel_Connector is started, THE Connector_Registry SHALL establish the connection to the external platform and emit a "channel.connected" event on the EventBus with the channel identifier and channel type
5. WHEN a Channel_Connector connection fails, THE Connector_Registry SHALL emit a "channel.connection.failed" event and attempt reconnection with exponential backoff starting at 1000 milliseconds and capped at 60000 milliseconds
6. WHEN a Channel_Connector is stopped, THE Connector_Registry SHALL close the connection gracefully and emit a "channel.disconnected" event with the channel identifier
7. THE Connector_Registry SHALL expose a status method that returns the connection state (disconnected, connecting, connected, reconnecting, failed) of all registered connectors

### Requirement 11: Channel Connector Inbound Message Handling

**User Story:** As a developer, I want inbound messages from external channels to be routed into the runtime as intents, so that agents can process external communications.

#### Acceptance Criteria

1. WHEN a Channel_Connector receives an inbound message, THE Connector_Registry SHALL normalize the message into a standard InboundMessage structure containing sender (string, maximum 256 characters), channel (the channel type identifier), content (string, maximum 32,000 characters), and timestamp (ISO 8601 UTC)
2. WHEN an InboundMessage is normalized, THE Connector_Registry SHALL emit a "channel.message.received" event on the EventBus with the normalized InboundMessage data
3. WHEN an InboundMessage is normalized, THE Connector_Registry SHALL submit an intent to the KernovaKernel with the message content as the goal and the sender, channel type, and timestamp as context metadata
4. IF a Channel_Connector receives a message missing any required field (sender, channel, content, or timestamp) or containing a content field that is empty or exceeds 32,000 characters, THEN THE Connector_Registry SHALL emit a "channel.message.invalid" event on the EventBus including the channel type and the reason for rejection, and discard the message without crashing
5. IF intent submission to the KernovaKernel fails for a normalized InboundMessage, THEN THE Connector_Registry SHALL emit a "channel.message.failed" event on the EventBus with the InboundMessage reference and error details, and SHALL NOT re-attempt submission

### Requirement 12: Channel Connector Outbound Message Sending

**User Story:** As a developer, I want agents to send messages through channel connectors, so that agents can respond to users on their preferred communication platforms.

#### Acceptance Criteria

1. WHEN an outbound message send is requested with a channel identifier and content, THE Connector_Registry SHALL route the message to the appropriate Channel_Connector for delivery and return a message identifier for tracking
2. WHEN a Channel_Connector successfully delivers an outbound message, THE Connector_Registry SHALL emit a "channel.message.sent" event on the EventBus with the message identifier, channel identifier, and delivery timestamp
3. IF a Channel_Connector fails to deliver an outbound message, THEN THE Connector_Registry SHALL emit a "channel.message.failed" event with the error details, the original message reference, and the message identifier
4. THE Connector_Registry SHALL support sending text content, and optionally structured content (attachments, buttons, embeds) where the target Channel supports them
5. IF an outbound message contains structured content that the target Channel does not support, THEN THE Connector_Registry SHALL deliver the text content portion and emit a "channel.message.partial" event indicating which structured elements were dropped
6. IF an outbound message targets an unregistered or disconnected Channel_Connector, THEN THE Connector_Registry SHALL reject the send request with a descriptive error without emitting a "channel.message.failed" event
7. IF a Channel_Connector does not confirm delivery within 30 seconds, THEN THE Connector_Registry SHALL cancel the delivery attempt, treat it as a failure, and emit a "channel.message.failed" event with a timeout indication

### Requirement 13: Kernel Integration

**User Story:** As a developer, I want all autonomy modules registered in the KernovaKernel, so that I access them through a consistent API.

#### Acceptance Criteria

1. THE KernovaKernel SHALL instantiate and register the Scheduler, Background_Loop module, Task_Queue, Proactive_Trigger_Engine, and Connector_Registry during construction, passing the EventBus instance and the data directory path to each module constructor
2. THE KernovaKernel SHALL expose each autonomy module via a read-only getter property named: scheduler, loops, taskQueue, triggers, channels
3. WHEN the KernovaKernel starts, THE KernovaKernel SHALL start all autonomy modules after the EventBus has started and before emitting the "kernel.started" event, in the order: Scheduler, Background_Loop module, Task_Queue, Proactive_Trigger_Engine, Connector_Registry
4. WHEN the KernovaKernel stops, THE KernovaKernel SHALL stop all autonomy modules before stopping the EventBus, in the reverse order of startup: Connector_Registry, Proactive_Trigger_Engine, Task_Queue, Background_Loop module, Scheduler
5. IF any autonomy module fails to start, THEN THE KernovaKernel SHALL stop all previously started autonomy modules in reverse order and throw an error indicating which module failed and the cause of failure
6. IF any autonomy module fails to stop, THEN THE KernovaKernel SHALL continue stopping the remaining modules and emit a "kernel.module.stopFailed" event on the EventBus with the module name and error details
