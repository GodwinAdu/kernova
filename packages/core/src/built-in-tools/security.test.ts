/**
 * Security regression tests for the built-in tools.
 *
 * Tool arguments come from the model, so each tool must hold up against a model
 * that has been steered by a prompt injection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createShellExecTool } from './shell-exec.js';
import { createCodeEvalTool } from './code-eval.js';
import { createRegexMatchTool } from './regex-match.js';
import { createHttpFetchTool, isPrivateAddress } from './http-fetch.js';
import { SandboxViolationError } from './sandbox-error.js';

let root: string;
let sandbox: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kernova-sec-'));
  sandbox = join(root, 'sbx');
  mkdirSync(sandbox);
  // A sibling whose name starts with the sandbox's name
  mkdirSync(join(root, 'sbx-private'));
  writeFileSync(join(root, 'sbx-private', 'secret.txt'), 'outside');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('file tools sandbox', () => {
  it('file-read rejects a sibling directory that shares the sandbox name prefix', async () => {
    await expect(
      createFileReadTool(sandbox).execute({ path: '../sbx-private/secret.txt' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('file-write rejects a sibling directory that shares the sandbox name prefix', async () => {
    await expect(
      createFileWriteTool(sandbox).execute({ path: '../sbx-private/new.txt', content: 'x' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('file-read rejects a link inside the sandbox that points outside it', async () => {
    // A junction needs no special privileges on Windows; elsewhere this makes a symlink
    symlinkSync(join(root, 'sbx-private'), join(sandbox, 'link'), 'junction');
    await expect(
      createFileReadTool(sandbox).execute({ path: 'link/secret.txt' }),
    ).rejects.toThrow(SandboxViolationError);
  });

  it('file-write and file-read still work inside the sandbox', async () => {
    await createFileWriteTool(sandbox).execute({ path: 'notes/a.txt', content: 'hello' });
    const result = await createFileReadTool(sandbox).execute({ path: 'notes/a.txt' }) as { content: string };
    expect(result.content).toBe('hello');
  });
});

describe('shell-exec', () => {
  const echo = (name: string) => (process.platform === 'win32' ? `echo %${name}%` : `echo $${name}`);

  it('does not pass the host environment (API keys) to commands', async () => {
    process.env.KERNOVA_TEST_SECRET = 'sk-test-123';
    try {
      const result = await createShellExecTool(sandbox, 5000).execute({ command: echo('KERNOVA_TEST_SECRET') }) as { stdout: string };
      expect(result.stdout).not.toContain('sk-test-123');
    } finally {
      delete process.env.KERNOVA_TEST_SECRET;
    }
  });

  it('passes variables the developer configures', async () => {
    const tool = createShellExecTool(sandbox, 5000, { env: { KERNOVA_TOOL_TOKEN: 'configured' } });
    const result = await tool.execute({ command: echo('KERNOVA_TOOL_TOKEN') }) as { stdout: string };
    expect(result.stdout).toContain('configured');
  });

  it('treats the configured timeout as a ceiling the model cannot raise', async () => {
    const command = process.platform === 'win32' ? 'ping -n 6 127.0.0.1' : 'sleep 5';
    const started = Date.now();
    const result = await createShellExecTool(sandbox, 500).execute({ command, timeout: 60_000 }) as { timedOut: boolean };
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  }, 10_000);
});

describe('code-eval', () => {
  const tool = createCodeEvalTool(2000);

  it('runs code and captures console output', async () => {
    const result = await tool.execute({ code: "console.log('hi'); 1 + 2" }) as { result: unknown; stdout: string };
    expect(result.result).toBe(3);
    expect(result.stdout).toBe('hi');
  });

  it('cannot reach the host process through constructors', async () => {
    for (const code of [
      "Object.constructor('return typeof process')()",
      "this.constructor.constructor('return typeof process')()",
      "(() => {}).constructor('return typeof process')()",
    ]) {
      const result = await tool.execute({ code }) as { result: unknown };
      expect(result.result).toBe('undefined');
    }
  });

  it('stops an infinite loop in a promise callback without hanging the host', async () => {
    const result = await tool.execute({
      code: 'Promise.resolve().then(() => { while (true) {} }); 1',
      timeout: 500,
    }) as { error: boolean; message: string };
    expect(result.error).toBe(true);
    expect(result.message).toBe('Execution timed out');
  }, 10_000);

  it('treats the configured timeout as a ceiling the model cannot raise', async () => {
    const started = Date.now();
    const result = await createCodeEvalTool(300).execute({ code: 'while (true) {}', timeout: 60_000 }) as { error: boolean };
    expect(result.error).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);
});

describe('regex-match', () => {
  it('times out on catastrophic backtracking while the event loop keeps running', async () => {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 50);
    try {
      const result = await createRegexMatchTool().execute({
        pattern: '^(a+)+$',
        text: 'a'.repeat(40) + '!',
      }) as { error: boolean; message: string };
      expect(result.error).toBe(true);
      expect(result.message).toMatch(/timed out/);
      expect(ticks).toBeGreaterThan(10);
    } finally {
      clearInterval(interval);
    }
  }, 15_000);

  it('still matches and replaces normally', async () => {
    const tool = createRegexMatchTool();
    const matched = await tool.execute({ pattern: '(?<word>\\w+)', flags: 'g', text: 'a bb' }) as { matches: string[]; groups: unknown[] };
    expect(matched.matches).toEqual(['a', 'bb']);
    expect(matched.groups).toEqual([{ word: 'a' }, { word: 'bb' }]);

    const replaced = await tool.execute({ pattern: 'b', flags: 'g', text: 'abb', replace: 'c' }) as { result: string; replacements: number };
    expect(replaced).toEqual({ result: 'acc', replacements: 2 });
  });
});

describe('http-fetch', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('classifies private and public addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('blocks hosts that resolve to private addresses, including cloud metadata', async () => {
    globalThis.fetch = vi.fn();
    const tool = createHttpFetchTool({ lookup: async () => [{ address: '127.0.0.1', family: 4 }] });

    const viaDns = await tool.execute({ url: 'http://internal.example.com/admin' }) as { error: boolean; message: string };
    expect(viaDns.error).toBe(true);
    expect(viaDns.message).toMatch(/private or internal address/);

    const metadata = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }) as { error: boolean };
    expect(metadata.error).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('checks every redirect hop', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } }),
    );
    const tool = createHttpFetchTool({
      lookup: async (host) => [{ address: host === '127.0.0.1' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
    });

    const result = await tool.execute({ url: 'https://example.com/redirect' }) as { error: boolean; message: string };
    expect(result.error).toBe(true);
    expect(result.message).toMatch(/127\.0\.0\.1/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('allows private addresses when explicitly configured', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const tool = createHttpFetchTool({ allowPrivateNetwork: true });
    const result = await tool.execute({ url: 'http://127.0.0.1:9/health' }) as { status: number; body: string };
    expect(result).toMatchObject({ status: 200, body: 'ok' });
  });

  it('rejects non-http protocols', async () => {
    const result = await createHttpFetchTool().execute({ url: 'file:///etc/passwd' }) as { error: boolean; message: string };
    expect(result.error).toBe(true);
    expect(result.message).toMatch(/Unsupported protocol/);
  });

  it('truncates large responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('x'.repeat(5000), { status: 200 }));
    const tool = createHttpFetchTool({
      maxResponseBytes: 1000,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    const result = await tool.execute({ url: 'https://example.com/big' }) as { body: string; truncated: boolean };
    expect(result.body).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });
});
