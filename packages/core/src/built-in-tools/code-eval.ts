/**
 * Built-in Tool: code-eval
 *
 * Executes JavaScript in an isolated child process with a hard timeout.
 *
 * Isolation, from the inside out:
 *  - The code runs in a `vm` context created from a null-prototype object, so it gets
 *    its own built-ins (Object, JSON, Math, Promise, ...) and no host objects to climb
 *    back through. Only console.log/warn/error are provided, and their output is captured.
 *  - Promise callbacks count toward the timeout (`microtaskMode: 'afterEvaluate'`).
 *  - The context lives in a separate Node process started with the permission model
 *    (no file system, child processes, or worker threads), an empty environment
 *    (no API keys), and a 128 MB heap cap. The process is killed if it overruns.
 *
 * Disabled by default; enable it only for agents whose input you trust.
 */

import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../plugins/plugin-registry.js';

const DEFAULT_TIMEOUT = 5000;

/** Extra time allowed for the child process to start before it is killed */
const STARTUP_GRACE_MS = 2000;

/** Maximum bytes accepted from the child process */
const MAX_OUTPUT_BYTES = 1024 * 1024;

const [major, minor] = process.versions.node.split('.').map(Number);
const PERMISSION_FLAG =
  major > 23 || (major === 23 && minor >= 5) || (major === 22 && minor >= 13)
    ? '--permission'
    : '--experimental-permission';

/** Runs inside the sandbox context before the user code: captures console output and serializes results. */
const SETUP_SOURCE = `
globalThis.__out = [];
globalThis.__fmt = (args) => args
  .map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a, null, 2) : String(a)))
  .join(' ');
globalThis.console = {
  log: (...args) => { __out.push(__fmt(args)); },
  warn: (...args) => { __out.push('[warn] ' + __fmt(args)); },
  error: (...args) => { __out.push('[error] ' + __fmt(args)); },
};
globalThis.__serialize = (value) => {
  if (value === undefined) return 'null';
  try {
    const json = JSON.stringify(value);
    return json === undefined ? JSON.stringify(String(value)) : json;
  } catch {
    return JSON.stringify(String(value));
  }
};
`;

/** Runs inside the child process. Reads { code, timeout } from stdin, writes a JSON result. */
const CHILD_SOURCE = String.raw`
const vm = require('node:vm');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const { code, timeout } = JSON.parse(input);
  const context = vm.createContext(Object.create(null), { microtaskMode: 'afterEvaluate' });
  const run = (source) => vm.runInContext(source, context, { timeout, filename: 'sandbox.js' });
  run(${JSON.stringify(SETUP_SOURCE)});
  const started = Date.now();
  const out = { result: null, error: null, stdout: '' };
  try {
    context.__value = run(code);
    out.result = JSON.parse(run('__serialize(__value)'));
  } catch (err) {
    let message;
    try { message = err && err.message !== undefined ? String(err.message) : String(err); } catch { message = 'Unknown error'; }
    out.error = message;
  }
  out.executionMs = Date.now() - started;
  try { out.stdout = String(run('__out.join("\\n")')); } catch {}
  process.stdout.write(JSON.stringify(out));
});
`;

interface ChildResult {
  result: unknown;
  error: string | null;
  stdout: string;
  executionMs: number;
}

function runIsolated(code: string, timeout: number): Promise<ChildResult | { killed: true; reason: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [PERMISSION_FLAG, '--max-old-space-size=128', '-e', CHILD_SOURCE],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );

    let output = '';
    let errorOutput = '';
    let settled = false;
    const finish = (value: ChildResult | { killed: true; reason: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ killed: true, reason: 'Execution timed out' });
    }, timeout + STARTUP_GRACE_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish({ killed: true, reason: 'Output exceeded 1MB' });
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (errorOutput.length < 4096) errorOutput += chunk;
    });

    child.on('error', (err) => finish({ killed: true, reason: `Could not start sandbox: ${err.message}` }));
    child.on('close', (exitCode) => {
      try {
        finish(JSON.parse(output) as ChildResult);
      } catch {
        const detail = /heap out of memory/i.test(errorOutput)
          ? 'Memory limit exceeded'
          : `Sandbox exited with code ${exitCode}`;
        finish({ killed: true, reason: detail });
      }
    });

    child.stdin.end(JSON.stringify({ code, timeout }));
  });
}

export function createCodeEvalTool(defaultTimeout?: number): ToolDefinition {
  const maxTimeout = defaultTimeout ?? DEFAULT_TIMEOUT;

  return {
    id: 'code-eval',
    name: 'Code Eval',
    description:
      'Execute JavaScript code in an isolated sandbox with timeout protection. Returns the result, captured console output, and execution time.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. The value of the last expression is returned.',
        },
        timeout: {
          type: 'number',
          description: `Execution timeout in milliseconds (at most ${maxTimeout})`,
        },
      },
      required: ['code'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const code = params.code as string;
      const requested = Number(params.timeout);
      const execTimeout = requested > 0 ? Math.min(requested, maxTimeout) : maxTimeout;

      if (!code || code.trim().length === 0) {
        return {
          error: true,
          message: 'Code cannot be empty',
        };
      }

      const startTime = Date.now();
      const outcome = await runIsolated(code, execTimeout);

      if ('killed' in outcome) {
        return {
          error: true,
          message: outcome.reason,
          executionMs: Date.now() - startTime,
          stdout: '',
        };
      }

      if (outcome.error !== null) {
        return {
          error: true,
          message: /Script execution timed out/.test(outcome.error) ? 'Execution timed out' : outcome.error,
          executionMs: outcome.executionMs,
          stdout: outcome.stdout,
        };
      }

      return {
        result: outcome.result,
        stdout: outcome.stdout,
        executionMs: outcome.executionMs,
      };
    },
  };
}
