/**
 * Built-in Tool: file-read
 *
 * Reads file contents within the configured sandbox directory.
 * Rejects any path that resolves outside the sandbox boundary.
 */

import { readFile } from 'node:fs/promises';
import type { ToolDefinition } from '../plugins/plugin-registry.js';
import { assertRealPathInSandbox, validateSandboxPath } from './sandbox-path.js';

export { validateSandboxPath };

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
      await assertRealPathInSandbox(resolvedPath, sandboxDir);

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
