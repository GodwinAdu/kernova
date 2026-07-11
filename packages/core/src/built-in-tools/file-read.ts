/**
 * Built-in Tool: file-read
 *
 * Reads file contents within the configured sandbox directory.
 * Rejects any path that resolves outside the sandbox boundary.
 */

import { readFile } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import type { ToolDefinition } from '../plugins/plugin-registry.js';
import { SandboxViolationError } from './sandbox-error.js';

/**
 * Validates that the resolved path is within the sandbox directory.
 * Throws SandboxViolationError if the path escapes the sandbox.
 */
export function validateSandboxPath(filePath: string, sandboxDir: string): string {
  const resolvedSandbox = resolve(normalize(sandboxDir));
  const resolvedPath = resolve(resolvedSandbox, normalize(filePath));

  if (!resolvedPath.startsWith(resolvedSandbox)) {
    throw new SandboxViolationError(
      `Access denied: path "${filePath}" resolves outside the sandbox directory.`,
    );
  }

  return resolvedPath;
}

export function createFileReadTool(sandboxDir: string): ToolDefinition {
  return {
    id: 'file-read',
    name: 'File Read',
    description: 'Read file contents from the local filesystem within the sandbox directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the sandbox directory',
        },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64', 'hex'],
          default: 'utf-8',
          description: 'Encoding to use when reading the file',
        },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const filePath = params.path as string;
      const encoding = (params.encoding as BufferEncoding) || 'utf-8';

      // Validate sandbox boundary (throws SandboxViolationError on violation)
      const resolvedPath = validateSandboxPath(filePath, sandboxDir);

      try {
        const content = await readFile(resolvedPath, { encoding });

        return {
          path: filePath,
          content,
          size: Buffer.byteLength(content, encoding),
        };
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;

        if (err.code === 'ENOENT') {
          throw new Error(
            `File not found: "${filePath}" does not exist within the sandbox directory.`,
          );
        }

        if (err.code === 'EACCES' || err.code === 'EPERM') {
          throw new Error(
            `Permission denied: cannot read "${filePath}". Check file permissions.`,
          );
        }

        throw new Error(
          `Failed to read file "${filePath}": ${err.message || String(error)}`,
        );
      }
    },
  };
}
