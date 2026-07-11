/**
 * Built-in Tool: shell-exec
 *
 * Executes shell commands within the sandbox directory with a configurable timeout.
 * Enforces that the working directory is within the sandbox boundary.
 *
 * Parameters:
 *  - command (required): Shell command to execute
 *  - cwd (optional): Working directory relative to sandbox (defaults to sandbox root)
 *  - timeout (optional): Timeout in ms (defaults to configured defaultTimeout, which defaults to 30000)
 *  - env (optional): Additional environment variables to set for the child process
 *
 * Returns: { stdout, stderr, exitCode, timedOut, error }
 *  - On success: exitCode = 0
 *  - On non-zero exit: still returns stdout/stderr/exitCode (does not throw)
 *  - On timeout: kills the process, returns error indicating timeout
 */

import { exec } from 'node:child_process';
import { resolve, normalize } from 'node:path';
import type { ToolDefinition } from '../plugins/plugin-registry.js';
import { SandboxViolationError } from './sandbox-error.js';

const DEFAULT_TIMEOUT = 30000;

/**
 * Creates a shell-exec tool scoped to the given sandbox directory.
 *
 * @param sandboxDir - Root directory within which all commands must execute
 * @param defaultTimeout - Default timeout in ms (default: 30000)
 */
export function createShellExecTool(sandboxDir: string, defaultTimeout?: number): ToolDefinition {
  const resolvedDefaultTimeout = defaultTimeout ?? DEFAULT_TIMEOUT;

  return {
    id: 'shell-exec',
    name: 'Shell Execute',
    description: 'Execute shell commands within the sandbox directory with a configurable timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory relative to sandbox (defaults to sandbox root)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (defaults to configured shell timeout)',
        },
        env: {
          type: 'object',
          description: 'Additional environment variables to set for the child process',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['command'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const command = params.command as string;
      const cwdRelative = (params.cwd as string) || '.';
      const timeout = (params.timeout as number) || resolvedDefaultTimeout;
      const env = params.env as Record<string, string> | undefined;

      // Resolve and validate working directory is within sandbox
      const resolvedSandbox = resolve(normalize(sandboxDir));
      const resolvedCwd = resolve(resolvedSandbox, normalize(cwdRelative));

      if (!resolvedCwd.startsWith(resolvedSandbox)) {
        throw new SandboxViolationError(
          `Access denied: working directory "${cwdRelative}" resolves outside the sandbox.`,
        );
      }

      return new Promise((resolvePromise) => {
        const child = exec(
          command,
          {
            cwd: resolvedCwd,
            timeout,
            maxBuffer: 1024 * 1024, // 1MB output limit
            env: env ? { ...process.env, ...env } : undefined,
          },
          (error, stdout, stderr) => {
            if (error) {
              // Check if it was a timeout (killed by Node.js timeout or our belt-and-suspenders timer)
              if (error.killed || error.signal === 'SIGTERM') {
                resolvePromise({
                  stdout: stdout || '',
                  stderr: stderr || '',
                  exitCode: 143, // Conventional SIGTERM exit code (128 + 15)
                  timedOut: true,
                  error: `Command timed out after ${timeout}ms`,
                });
              } else {
                // Non-zero exit — still return stdout/stderr/exitCode without throwing
                resolvePromise({
                  stdout: stdout || '',
                  stderr: stderr || '',
                  exitCode: error.code ?? 1,
                  timedOut: false,
                  error: error.message,
                });
              }
            } else {
              resolvePromise({
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: 0,
                timedOut: false,
                error: null,
              });
            }
          },
        );

        // Belt-and-suspenders: ensure process is killed on timeout even if
        // Node's built-in timeout mechanism doesn't fire correctly.
        const timer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGTERM');
          }
        }, timeout + 100);

        child.on('exit', () => clearTimeout(timer));
      });
    },
  };
}
