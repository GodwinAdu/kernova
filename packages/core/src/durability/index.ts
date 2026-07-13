/**
 * Durable Execution & Checkpoints
 *
 * Enables agents and workflows to survive crashes, restarts, and long-running
 * operations. State is persisted to SQLite and automatically restored.
 *
 * Key concepts:
 * - Checkpoint: A snapshot of execution state at a point in time
 * - DurableTask: A task that can be paused, resumed, and recovered
 * - ExecutionLog: A record of all steps for replay
 */

export { DurableExecutor } from './durable-executor.js';
export { CheckpointStore } from './checkpoint-store.js';
export type { Checkpoint, DurableTaskState, DurableOptions } from './types.js';
