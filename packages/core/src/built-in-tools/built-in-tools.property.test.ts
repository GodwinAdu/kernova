/**
 * Property-Based Tests for Built-in Tools
 *
 * Tests file-read/write round-trip within sandbox (Property 12).
 * Uses fast-check for randomized input generation.
 *
 * **Validates: Requirements 9.2, 9.3**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';

// ─── Helpers ─────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kernova-builtin-tools-test-'));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Arbitrary for valid file content: strings of various lengths including
 * empty, unicode characters, and multi-line content.
 */
const fileContentArb = fc.oneof(
  // Empty content
  fc.constant(''),
  // Simple ASCII strings
  fc.string({ minLength: 1, maxLength: 5000 }),
  // Unicode strings (includes emojis, CJK characters, diacritics)
  fc.string({ unit: 'binary', minLength: 1, maxLength: 2000 }),
  // Multi-line content
  fc.array(fc.string({ minLength: 0, maxLength: 200 }), { minLength: 1, maxLength: 50 })
    .map((lines) => lines.join('\n')),
);

/**
 * Arbitrary for valid relative file paths within sandbox.
 * Generates simple single-level or nested paths with no path traversal.
 */
const safeFileNameArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/);

const safeRelativePathArb = fc.tuple(
  fc.array(safeFileNameArb, { minLength: 0, maxLength: 3 }),
  safeFileNameArb,
).map(([dirs, file]) => [...dirs, `${file}.txt`].join('/'));

// ─── Property 12: File Read/Write Round-Trip ─────────────────────

describe('Built-in Tools - Property 12: File Read/Write Round-Trip', () => {
  let sandboxDir: string;
  let fileReadTool: ReturnType<typeof createFileReadTool>;
  let fileWriteTool: ReturnType<typeof createFileWriteTool>;

  beforeEach(() => {
    sandboxDir = createTempDir();
    fileReadTool = createFileReadTool(sandboxDir);
    fileWriteTool = createFileWriteTool(sandboxDir);
  });

  afterEach(() => {
    cleanupDir(sandboxDir);
  });

  it('for any content written via file-write, reading the same path returns identical content', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeRelativePathArb,
        fileContentArb,
        async (path, content) => {
          // Write content using file-write tool
          const writeResult = await fileWriteTool.execute({ path, content }) as { success: boolean };
          expect(writeResult.success).toBe(true);

          // Read it back using file-read tool
          const readResult = await fileReadTool.execute({ path }) as { content: string };

          // The read content must be identical to what was written
          expect(readResult.content).toBe(content);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
