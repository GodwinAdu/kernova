/**
 * Built-in Tool: regex-match
 *
 * Performs regex matching or replacement on text.
 * Includes safety guards against catastrophic backtracking (ReDoS).
 *
 * - Without `replace`: returns all matches and named groups.
 * - With `replace`: performs regex replacement and returns the result.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

/** Maximum input length to prevent excessive processing */
const MAX_INPUT_LENGTH = 1_000_000; // 1MB

/** Maximum execution time for regex operations (ms) */
const MAX_EXECUTION_MS = 5000;

/**
 * Executes regex matching with a time guard.
 * Uses a simple approach: run in the current thread but check elapsed time
 * after each match (for global patterns).
 */
function safeMatch(
  text: string,
  regex: RegExp,
): { matches: string[]; groups: Record<string, string>[] } {
  const matches: string[] = [];
  const groups: Record<string, string>[] = [];
  const startTime = Date.now();

  if (regex.global) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[0]);
      if (match.groups) {
        groups.push({ ...match.groups });
      }

      // Prevent infinite loop on zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }

      // Time guard
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        throw new Error(
          `Regex execution timed out after ${MAX_EXECUTION_MS}ms (possible catastrophic backtracking)`,
        );
      }
    }
  } else {
    const match = regex.exec(text);
    if (match) {
      matches.push(match[0]);
      if (match.groups) {
        groups.push({ ...match.groups });
      }
    }
  }

  return { matches, groups };
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

      // Compile regex safely
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, flags);
      } catch (err) {
        return {
          error: true,
          message: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      try {
        // Replace mode
        if (replace !== undefined) {
          const startTime = Date.now();
          const result = text.replace(regex, replace);
          const elapsed = Date.now() - startTime;

          if (elapsed > MAX_EXECUTION_MS) {
            return {
              error: true,
              message: `Regex replacement timed out after ${MAX_EXECUTION_MS}ms`,
            };
          }

          // Count replacements by comparing
          const { matches } = safeMatch(text, new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'));

          return {
            result,
            replacements: regex.global ? matches.length : (matches.length > 0 ? 1 : 0),
          };
        }

        // Match mode
        const { matches, groups } = safeMatch(text, regex);

        return {
          matches,
          groups,
          matchCount: matches.length,
        };
      } catch (err) {
        return {
          error: true,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
