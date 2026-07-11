/**
 * Built-in Tool: file-write
 *
 * Writes content to files within the configured sandbox directory.
 * Rejects any path that resolves outside the sandbox boundary.
 * Supports both overwrite and append modes.
 */

import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolDefinition } from '../plugins/plugin-registry.js';
import { validateSandboxPath } from './file-read.js';

export function createFileWriteTool(sandboxDir: string): ToolDefinition {
  return {
    id: 'file-write',
    name: 'File Write',
    description: 'Write content to a file within the sandbox directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the sandbox directory',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64', 'hex'],
          default: 'utf-8',
          description: 'Encoding to use when writing the file',
        },
        append: {
          type: 'boolean',
          default: false,
          description: 'If true, append content to the file instead of overwriting',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (params: Record<string, unknown>): Promise<unknown> => {
      const filePath = params.path as string;
      const content = params.content as string;
      const encoding = (params.encoding as BufferEncoding) || 'utf-8';
      const append = (params.append as boolean) ?? false;

      const resolvedPath = validateSandboxPath(filePath, sandboxDir);

      try {
        // Ensure parent directory exists (mkdir -p behavior)
        await mkdir(dirname(resolvedPath), { recursive: true });

        if (append) {
          await appendFile(resolvedPath, content, { encoding });
        } else {
          await writeFile(resolvedPath, content, { encoding });
        }
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;

        if (err.code === 'EACCES' || err.code === 'EPERM') {
          throw new Error(
            `Permission denied: cannot write to "${filePath}". Check file and directory permissions.`,
          );
        }

        if (err.code === 'ENOSPC') {
          throw new Error(
            `Disk full: cannot write to "${filePath}". Not enough disk space available.`,
          );
        }

        throw error;
      }

      return {
        path: resolvedPath,
        bytesWritten: Buffer.byteLength(content, encoding),
        append,
        success: true,
      };
    },
  };
}
