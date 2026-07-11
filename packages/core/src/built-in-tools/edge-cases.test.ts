/**
 * Edge-Case Tests: Sandbox Violations & Shell Timeout Enforcement
 *
 * Tests that built-in tools properly reject path traversal attempts
 * and that shell-exec enforces command timeouts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createShellExecTool } from './shell-exec.js';
import { SandboxViolationError } from './sandbox-error.js';

// ─── Helpers ─────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kernova-edge-case-test-'));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ─── Sandbox Violations: file-read ───────────────────────────

describe('Edge Cases - file-read sandbox violations', () => {
  let sandboxDir: string;
  let fileReadTool: ReturnType<typeof createFileReadTool>;

  beforeEach(() => {
    sandboxDir = createTempDir();
    fileReadTool = createFileReadTool(sandboxDir);
  });

  afterEach(() => {
    cleanupDir(sandboxDir);
  });

  it('rejects path traversal with ../../etc/passwd', async () => {
    await expect(
      fileReadTool.execute({ path: '../../etc/passwd' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects absolute path outside sandbox', async () => {
    const outsidePath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/passwd';

    await expect(
      fileReadTool.execute({ path: outsidePath }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects path with encoded traversal characters (..%2f..)', async () => {
    // Even if someone tries URL-encoded traversal, the raw string still
    // contains ".." segments after normalize on some platforms.
    // The key test: the path should not resolve within sandbox.
    await expect(
      fileReadTool.execute({ path: '..%2f..%2fetc%2fpasswd' }),
    ).rejects.toThrow(); // Throws either SandboxViolationError or file-not-found (both acceptable)
  });

  it('rejects deeply nested traversal (subdir/../../../outside)', async () => {
    await expect(
      fileReadTool.execute({ path: 'subdir/../../../outside.txt' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects traversal with backslashes on Windows-style paths', async () => {
    await expect(
      fileReadTool.execute({ path: '..\\..\\etc\\passwd' }),
    ).rejects.toThrow(SandboxViolationError);
  });
});

// ─── Sandbox Violations: file-write ──────────────────────────

describe('Edge Cases - file-write sandbox violations', () => {
  let sandboxDir: string;
  let fileWriteTool: ReturnType<typeof createFileWriteTool>;

  beforeEach(() => {
    sandboxDir = createTempDir();
    fileWriteTool = createFileWriteTool(sandboxDir);
  });

  afterEach(() => {
    cleanupDir(sandboxDir);
  });

  it('rejects writing to ../outside.txt', async () => {
    await expect(
      fileWriteTool.execute({ path: '../outside.txt', content: 'malicious' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects path traversal with ../../etc/crontab', async () => {
    await expect(
      fileWriteTool.execute({ path: '../../etc/crontab', content: 'bad' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects absolute path outside sandbox', async () => {
    const outsidePath = process.platform === 'win32'
      ? 'C:\\temp\\malicious.txt'
      : '/tmp/malicious.txt';

    await expect(
      fileWriteTool.execute({ path: outsidePath, content: 'evil' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects nested traversal (a/b/../../../../etc/shadow)', async () => {
    await expect(
      fileWriteTool.execute({ path: 'a/b/../../../../etc/shadow', content: 'x' }),
    ).rejects.toThrow(SandboxViolationError);
  });
});

// ─── Sandbox Violations: shell-exec ─────────────────────────

describe('Edge Cases - shell-exec sandbox violations', () => {
  let sandboxDir: string;
  let shellExecTool: ReturnType<typeof createShellExecTool>;

  beforeEach(() => {
    sandboxDir = createTempDir();
    shellExecTool = createShellExecTool(sandboxDir, 5000);
  });

  afterEach(() => {
    cleanupDir(sandboxDir);
  });

  it('rejects cwd set to ../../ (traversal outside sandbox)', async () => {
    await expect(
      shellExecTool.execute({ command: 'echo hello', cwd: '../../' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects cwd set to absolute path outside sandbox', async () => {
    const outsideCwd = process.platform === 'win32' ? 'C:\\Windows' : '/tmp';

    await expect(
      shellExecTool.execute({ command: 'echo hello', cwd: outsideCwd }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('rejects cwd with deeply nested traversal', async () => {
    await expect(
      shellExecTool.execute({ command: 'ls', cwd: 'sub/../../../' }),
    ).rejects.toThrow(SandboxViolationError);
  });
});

// ─── Shell Timeout Enforcement ──────────────────────────────

describe('Edge Cases - shell-exec timeout enforcement', () => {
  let sandboxDir: string;
  let shellExecTool: ReturnType<typeof createShellExecTool>;

  beforeEach(() => {
    sandboxDir = createTempDir();
    // Use a short default timeout for tests
    shellExecTool = createShellExecTool(sandboxDir, 5000);
  });

  afterEach(() => {
    cleanupDir(sandboxDir);
  });

  it('returns timedOut: true when command exceeds timeout', async () => {
    // Use a very short timeout to force timeout behavior
    const command = process.platform === 'win32'
      ? 'ping -n 10 127.0.0.1'
      : 'sleep 10';

    const result = await shellExecTool.execute({
      command,
      timeout: 200, // 200ms - command will not complete in time
    }) as { timedOut: boolean; exitCode: number; error: string };

    expect(result.timedOut).toBe(true);
    expect(result.error).toContain('timed out');
  }, 10000); // Allow up to 10s for the test itself

  it('returns timedOut: false when command completes within timeout', async () => {
    const command = process.platform === 'win32'
      ? 'echo done'
      : 'echo done';

    const result = await shellExecTool.execute({
      command,
      timeout: 5000,
    }) as { timedOut: boolean; exitCode: number; stdout: string };

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('done');
  });

  it('uses default timeout when none specified and command is fast', async () => {
    const result = await shellExecTool.execute({
      command: 'echo quick',
    }) as { timedOut: boolean; exitCode: number; stdout: string };

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('quick');
  });
});
