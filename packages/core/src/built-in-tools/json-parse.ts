/**
 * Built-in Tool: json-parse
 *
 * Parses raw JSON strings with optional dot-path extraction and transformations.
 * Supports nested path access (e.g., "data.users[0].name") and transforms
 * like keys, values, flatten, and pretty-print.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

/**
 * Resolves a dot-path expression against a parsed JSON value.
 * Supports array index notation: "items[0].name"
 */
function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Recursively flattens a nested object/array into a single-level object
 * with dot-notation keys.
 */
function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    if (prefix) {
      result[prefix] = obj;
    }
    return result;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const key = prefix ? `${prefix}[${i}]` : `[${i}]`;
      Object.assign(result, flatten(obj[i], key));
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object') {
        Object.assign(result, flatten(value, fullKey));
      } else {
        result[fullKey] = value;
      }
    }
  }

  return result;
}

export function createJsonParseTool(): ToolDefinition {
  return {
    id: 'json-parse',
    name: 'JSON Parse',
    description:
      'Parse raw JSON strings with optional dot-path extraction and transformations (keys, values, flatten, pretty).',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Raw JSON string to parse',
        },
        path: {
          type: 'string',
          description:
            'Optional dot-path to extract a nested value (e.g., "data.users[0].name")',
        },
        transform: {
          type: 'string',
          enum: ['keys', 'values', 'flatten', 'pretty'],
          description:
            'Optional transformation to apply: keys (object keys), values (object values), flatten (nested to flat), pretty (formatted JSON)',
        },
      },
      required: ['input'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const input = params.input as string;
      const path = params.path as string | undefined;
      const transform = params.transform as string | undefined;

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch (err) {
        return {
          error: true,
          message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // Apply path extraction
      let result: unknown = parsed;
      if (path) {
        result = resolvePath(parsed, path);
        if (result === undefined) {
          return {
            error: true,
            message: `Path "${path}" not found in the parsed JSON`,
          };
        }
      }

      // Apply transformation
      if (transform) {
        switch (transform) {
          case 'keys':
            if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
              result = Object.keys(result as Record<string, unknown>);
            } else {
              return {
                error: true,
                message: 'Transform "keys" requires an object value',
              };
            }
            break;

          case 'values':
            if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
              result = Object.values(result as Record<string, unknown>);
            } else {
              return {
                error: true,
                message: 'Transform "values" requires an object value',
              };
            }
            break;

          case 'flatten':
            result = flatten(result);
            break;

          case 'pretty':
            result = JSON.stringify(result, null, 2);
            break;

          default:
            return {
              error: true,
              message: `Unknown transform: "${transform}". Valid options: keys, values, flatten, pretty`,
            };
        }
      }

      return { result };
    },
  };
}
