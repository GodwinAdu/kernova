/**
 * Built-in Tool: code-eval
 *
 * Safely executes JavaScript code in a sandboxed VM context.
 * Uses Node.js `vm` module with strict timeout and limited globals.
 *
 * Allowed globals: console.log (captured), JSON, Math, Date, parseInt,
 * parseFloat, String, Number, Boolean, Array, Object, Map, Set,
 * Promise, RegExp, Error, isNaN, isFinite, undefined, null, NaN, Infinity.
 *
 * Explicitly excluded: process, require, import, fs, child_process, Buffer,
 * global, globalThis (overridden), setTimeout, setInterval, fetch, etc.
 */

import vm from 'node:vm';
import type { ToolDefinition } from '../plugins/plugin-registry.js';

const DEFAULT_TIMEOUT = 5000;

export function createCodeEvalTool(defaultTimeout?: number): ToolDefinition {
  const timeout = defaultTimeout ?? DEFAULT_TIMEOUT;

  return {
    id: 'code-eval',
    name: 'Code Eval',
    description:
      'Execute JavaScript code in a sandboxed environment with timeout protection. Returns the result, captured stdout, and execution time.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute',
        },
        timeout: {
          type: 'number',
          description: `Execution timeout in milliseconds (default: ${timeout})`,
        },
      },
      required: ['code'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const code = params.code as string;
      const execTimeout = (params.timeout as number) ?? timeout;

      if (!code || code.trim().length === 0) {
        return {
          error: true,
          message: 'Code cannot be empty',
        };
      }

      // Capture console.log output
      const stdout: string[] = [];
      const capturedConsole = {
        log: (...args: unknown[]) => {
          stdout.push(
            args
              .map((a) =>
                typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a),
              )
              .join(' '),
          );
        },
        warn: (...args: unknown[]) => {
          stdout.push(
            '[warn] ' +
              args
                .map((a) =>
                  typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a),
                )
                .join(' '),
          );
        },
        error: (...args: unknown[]) => {
          stdout.push(
            '[error] ' +
              args
                .map((a) =>
                  typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a),
                )
                .join(' '),
          );
        },
      };

      // Sandboxed context with minimal globals
      const sandbox: Record<string, unknown> = {
        console: capturedConsole,
        JSON,
        Math,
        Date,
        parseInt,
        parseFloat,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        RegExp,
        Error,
        TypeError,
        RangeError,
        SyntaxError,
        isNaN,
        isFinite,
        NaN,
        Infinity,
        undefined,
        Promise,
        // Explicitly block dangerous globals
        process: undefined,
        require: undefined,
        module: undefined,
        exports: undefined,
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        globalThis: undefined,
        Buffer: undefined,
        setTimeout: undefined,
        setInterval: undefined,
        setImmediate: undefined,
        clearTimeout: undefined,
        clearInterval: undefined,
        clearImmediate: undefined,
        fetch: undefined,
        XMLHttpRequest: undefined,
        WebSocket: undefined,
      };

      const context = vm.createContext(sandbox);

      const startTime = Date.now();
      try {
        const result = vm.runInContext(code, context, {
          timeout: execTimeout,
          filename: 'sandbox.js',
          breakOnSigint: true,
        });

        const executionMs = Date.now() - startTime;

        return {
          result: result === undefined ? null : result,
          stdout: stdout.join('\n'),
          executionMs,
        };
      } catch (err) {
        const executionMs = Date.now() - startTime;

        if (err instanceof Error && err.message.includes('Script execution timed out')) {
          return {
            error: true,
            message: 'Execution timed out',
            executionMs,
            stdout: stdout.join('\n'),
          };
        }

        return {
          error: true,
          message: err instanceof Error ? err.message : String(err),
          executionMs,
          stdout: stdout.join('\n'),
        };
      }
    },
  };
}
