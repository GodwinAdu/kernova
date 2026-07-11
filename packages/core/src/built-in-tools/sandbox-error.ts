/**
 * SandboxViolationError
 *
 * Thrown when a built-in tool attempts to access a path or resource
 * outside the configured sandbox directory.
 */

export class SandboxViolationError extends Error {
  readonly code = 'SANDBOX_VIOLATION';

  constructor(message: string) {
    super(message);
    this.name = 'SandboxViolationError';
  }
}
