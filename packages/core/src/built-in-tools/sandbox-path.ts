/**
 * Sandbox path checks shared by the file and shell tools.
 *
 * A path is inside the sandbox only if it is the sandbox root or a descendant of it.
 * A plain prefix check is not enough: "/data/sbx-private" starts with "/data/sbx".
 */

import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { SandboxViolationError } from './sandbox-error.js';

/** True if `target` is `root` or inside it. Both must be absolute. */
export function isInsideDir(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Validates that the resolved path is within the sandbox directory.
 * Throws SandboxViolationError if the path escapes the sandbox.
 */
export function validateSandboxPath(filePath: string, sandboxDir: string): string {
  const resolvedSandbox = resolve(sandboxDir);
  const resolvedPath = resolve(resolvedSandbox, filePath);

  if (!isInsideDir(resolvedPath, resolvedSandbox)) {
    throw new SandboxViolationError(
      `Access denied: path "${filePath}" resolves outside the sandbox directory.`,
    );
  }

  return resolvedPath;
}

/**
 * Follows symlinks and checks that the real location is still inside the sandbox.
 * Checks the nearest existing ancestor when the path itself does not exist yet.
 */
export async function assertRealPathInSandbox(resolvedPath: string, sandboxDir: string): Promise<void> {
  const resolvedSandbox = resolve(sandboxDir);
  const realSandbox = await realpathOrSelf(resolvedSandbox);

  let existing = resolvedPath;
  for (;;) {
    try {
      const real = await realpath(existing);
      if (!isInsideDir(real, realSandbox)) {
        throw new SandboxViolationError(
          `Access denied: "${resolvedPath}" resolves through a link to a location outside the sandbox.`,
        );
      }
      return;
    } catch (error) {
      if (error instanceof SandboxViolationError) throw error;
      // Nothing exists yet at this level; check the parent, but never climb above the sandbox
      const parent = dirname(existing);
      if (parent === existing || !isInsideDir(parent, resolvedSandbox)) return;
      existing = parent;
    }
  }
}

async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
