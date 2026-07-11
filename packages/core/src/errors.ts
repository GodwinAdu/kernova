/**
 * Kernova Custom Error Types
 *
 * Typed errors for input validation, queue capacity, and connector failures.
 */

/**
 * Thrown when input validation fails (cron expression, name length, priority, etc.)
 */
export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`Validation failed for '${field}': ${reason}`);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when a task queue has reached its configured maximum depth.
 */
export class QueueFullError extends Error {
  constructor(public readonly maxDepth: number) {
    super(`Queue is full (max depth: ${maxDepth})`);
    this.name = 'QueueFullError';
  }
}

/**
 * Thrown when a channel connector encounters an error (connection, send, etc.)
 */
export class ConnectorError extends Error {
  constructor(
    public readonly connectorId: string,
    public readonly reason: string,
  ) {
    super(`Connector '${connectorId}' error: ${reason}`);
    this.name = 'ConnectorError';
  }
}
