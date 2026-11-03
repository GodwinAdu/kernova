/**
 * Built-in Tool: regex-match
 *
 * Performs regex matching or replacement on text.
 *
 * Patterns come from the model, so a pattern can backtrack catastrophically (ReDoS).
 * A single `RegExp.exec` call cannot be interrupted on the main thread, so the regex
 * runs in a worker thread that is terminated when it overruns. The host's event loop
 * stays responsive either way.
 *
 * - Without `replace`: returns all matches and named groups.
 * - With `replace`: performs regex replacement and returns the result.
 */

import { Worker } from 'node:worker_threads';
import type { ToolDefinition } from '../plugins/plugin-registry.js';

/** Maximum input length to prevent excessive processing */
const MAX_INPUT_LENGTH = 1_000_000; // 1MB

/** Maximum execution time for regex operations (ms) */
const MAX_EXECUTION_MS = 5000;

/** Maximum number of matches returned */
const MAX_MATCHES = 10_000;

/** Runs in the worker: performs the match or replacement and posts the result. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { text, pattern, flags, replace, maxMatches } = workerData;

function collect(regex) {
  const matches = [];
  const groups = [];
  let truncated = false;
  if (regex.global) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (matches.length >= maxMatches) { truncated = true; break; }
      matches.push(match[0]);
      if (match.groups) groups.push({ ...match.groups });
      // Prevent infinite loop on zero-length matches
      if (match[0].length === 0) regex.lastIndex++;
    }
  } else {
    const match = regex.exec(text);
    if (match) {
      matches.push(match[0]);
      if (match.groups) groups.push({ ...match.groups });
    }
  }
  return { matches, groups, truncated };
}

try {
  if (replace !== undefined) {
    const regex = new RegExp(pattern, flags);
    const result = text.replace(regex, replace);
    const { matches } = collect(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'));
    parentPort.postMessage({
      result,
      replacements: regex.global ? matches.length : (matches.length > 0 ? 1 : 0),
    });
  } else {
    const { matches, groups, truncated } = collect(new RegExp(pattern, flags));
    parentPort.postMessage({ matches, groups, matchCount: matches.length, ...(truncated && { truncated }) });
  }
} catch (err) {
  parentPort.postMessage({ error: true, message: err instanceof Error ? err.message : String(err) });
}
`;

function runInWorker(data: { text: string; pattern: string; flags: string; replace?: string }): Promise<unknown> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { ...data, maxMatches: MAX_MATCHES },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });

    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(value);
    };

    const timer = setTimeout(() => finish({
      error: true,
      message: `Regex execution timed out after ${MAX_EXECUTION_MS}ms (possible catastrophic backtracking)`,
    }), MAX_EXECUTION_MS);

    worker.once('message', finish);
    worker.once('error', (err) => finish({ error: true, message: err.message }));
    worker.once('exit', (code) => finish({ error: true, message: `Regex worker exited with code ${code}` }));
  });
}

export function createRegexMatchTool(): ToolDefinition {
  return {
    id: 'regex-match',
    name: 'Regex Match',
    description:
      'Perform regex matching or replacement on text. Returns matches, named groups, and match count. Supports replace mode.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to search in',
        },
        pattern: {
          type: 'string',
          description: 'Regular expression pattern',
        },
        flags: {
          type: 'string',
          description: 'Regex flags (e.g., "g", "i", "gi", "gm")',
        },
        replace: {
          type: 'string',
          description:
            'Replacement text. If provided, performs regex replace instead of match.',
        },
      },
      required: ['text', 'pattern'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const text = params.text as string;
      const pattern = params.pattern as string;
      const flags = (params.flags as string) || '';
      const replace = params.replace as string | undefined;

      // Input length guard
      if (text.length > MAX_INPUT_LENGTH) {
        return {
          error: true,
          message: `Input text exceeds maximum length of ${MAX_INPUT_LENGTH} characters`,
        };
      }

      // Validate the pattern up front for a clear error message
      try {
        new RegExp(pattern, flags);
      } catch (err) {
        return {
          error: true,
          message: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      return runInWorker({ text, pattern, flags, replace });
    },
  };
}
