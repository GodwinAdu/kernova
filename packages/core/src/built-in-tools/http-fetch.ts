/**
 * Built-in Tool: http-fetch
 *
 * Makes HTTP requests to external URLs with configurable method, headers, body, and timeout.
 * Uses the Node.js native fetch API (available in Node 18+).
 *
 * Returns response body (as text), status code, and response headers.
 * Handles errors (network failures, timeouts) gracefully — returns error message as tool result.
 */

import type { ToolDefinition } from '../plugins/plugin-registry.js';

export function createHttpFetchTool(): ToolDefinition {
  return {
    id: 'http-fetch',
    name: 'HTTP Fetch',
    description: 'Make HTTP requests to external URLs and return the response body, status code, and headers.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          default: 'GET',
          description: 'HTTP method to use',
        },
        headers: {
          type: 'object',
          description: 'HTTP headers to include in the request',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: 'string',
          description: 'Request body (for POST, PUT, PATCH)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
          default: 30000,
        },
      },
      required: ['url'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const url = params.url as string;
      const method = (params.method as string) || 'GET';
      const headers = (params.headers as Record<string, string>) || {};
      const body = params.body as string | undefined;
      const timeout = (params.timeout as number) ?? 30000;

      // Create an AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
          signal: controller.signal,
        });

        // Always read body as text for consistent return type
        const responseBody = await response.text();

        // Collect response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return {
            error: true,
            message: `Request timed out after ${timeout}ms`,
          };
        }

        return {
          error: true,
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
