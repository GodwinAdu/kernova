/**
 * Built-in Tool: shell-exec
 *
 * Executes shell commands with the sandbox directory as the working directory
 * and a configurable timeout.
 *
 * This tool is NOT a security boundary. Commands run with the permissions of the
 * host user and can read or change anything that user can (`cd ..` works).
 * It is disabled by default; enable it only for agents whose input you trust.
 *
 * What it does enforce:
 *  - The working directory must be inside the sandbox
 *  - The child process gets a minimal environment, so API keys and other secrets
 *    in the host's environment are not visible to commands
 *  - The configured timeout is a ceiling: the model can lower it, not raise it
 *
 * Parameters:
 *  - command (required): Shell command to execute
 *  - cwd (optional): Working directory relative to sandbox (defaults to sandbox root)
 *  - timeout (optional): Timeout in ms (capped at the configured timeout, default 30000)
 *  - env (optional): Additional environment variables to set for the child process
 *
 * Returns: { stdout, stderr, exitCode, timedOut, error }
 *  - On success: exitCode = 0
 *  - On non-zero exit: still returns stdout/stderr/exitCode (does not throw)
 *  - On timeout: kills the command and every process it started, returns error indicating timeout
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { ToolDefinition } from '../plugins/plugin-registry.js';
import { validateSandboxPath } from './sandbox-path.js';

const DEFAULT_TIMEOUT = 30000;

/** Combined stdout + stderr limit */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** How long to wait for killed processes to exit before reporting a timeout anyway */
const KILL_GRACE_MS = 2000;

/** Host variables a shell needs to work. Everything else (API keys, tokens) is left out. */
const PASSTHROUGH_ENV = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TERM', 'SHELL',
];

export interface ShellExecOptions {
  /** Extra environment variables for every command (e.g. a token the commands need) */
  env?: Record<string, string>;
}

/** Builds the child environment from a few safe host variables plus explicit additions. */
export function buildShellEnv(...extra: Array<Record<string, string> | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH_ENV) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const vars of extra) {
    if (vars) Object.assign(env, vars);
  }
  return env;
}

/**
 * Creates a shell-exec tool whose commands start in the given sandbox directory.
 *
 * @param sandboxDir - Working directory root; `cwd` must stay inside it
 * @param defaultTimeout - Default and maximum timeout in ms (default: 30000)
 * @param options - Extra environment variables for commands
 */
export function createShellExecTool(
  sandboxDir: string,
  defaultTimeout?: number,
  options: ShellExecOptions = {},
): ToolDefinition {
  const maxTimeout = defaultTimeout ?? DEFAULT_TIMEOUT;

  return {
    id: 'shell-exec',
    name: 'Shell Execute',
    description: 'Execute a shell command. Starts in the sandbox directory, with a timeout.',
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
          description: `Timeout in milliseconds (at most ${maxTimeout})`,
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
      const requested = Number(params.timeout);
      const timeout = requested > 0 ? Math.min(requested, maxTimeout) : maxTimeout;
      const env = buildShellEnv(options.env, params.env as Record<string, string> | undefined);

      // Validate the working directory is within the sandbox (throws SandboxViolationError)
      const resolvedCwd = validateSandboxPath(cwdRelative, sandboxDir);
      await mkdir(resolvedCwd, { recursive: true });

      return new Promise((resolvePromise) => {
        const child = spawn(command, {
          cwd: resolvedCwd,
          env,
          shell: true,
          windowsHide: true,
          // Own process group on POSIX, so a timeout can stop everything the command started
          detached: process.platform !== 'win32',
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result: ShellResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(result);
        };

        const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
          if (stream === 'stdout') stdout += chunk; else stderr += chunk;
          if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
            killTree(child);
            finish({ stdout, stderr, exitCode: 1, timedOut: false, error: 'Output exceeded 1MB' });
          }
        };
        child.stdout?.on('data', collect('stdout'));
        child.stderr?.on('data', collect('stderr'));

        // Killing only the shell would leave the command itself running.
        // Report the timeout once the processes are gone (or after a short grace period).
        let timedOut = false;
        const timedOutResult = (): ShellResult => ({
          stdout,
          stderr,
          exitCode: 143, // Conventional SIGTERM exit code (128 + 15)
          timedOut: true,
          error: `Command timed out after ${timeout}ms`,
        });
        let timer = setTimeout(() => {
          timedOut = true;
          killTree(child);
          timer = setTimeout(() => finish(timedOutResult()), KILL_GRACE_MS);
        }, timeout);

        child.on('error', (error) => {
          finish({ stdout, stderr, exitCode: 1, timedOut: false, error: error.message });
        });

        child.on('close', (code, signal) => {
          if (timedOut) {
            finish(timedOutResult());
          } else if (code === 0) {
            finish({ stdout, stderr, exitCode: 0, timedOut: false, error: null });
          } else {
            // Non-zero exit — still return stdout/stderr/exitCode without throwing
            const detail = stderr.trim() ? `\n${stderr.trim()}` : '';
            finish({
              stdout,
              stderr,
              exitCode: code ?? 1,
              timedOut: false,
              error: `Command failed with ${code !== null ? `exit code ${code}` : `signal ${signal}`}: ${command}${detail}`,
            });
          }
        });
      });
    },
  };
}

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  error: string | null;
}

/** Stops the shell and every process it started. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      .on('error', () => child.kill());
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
