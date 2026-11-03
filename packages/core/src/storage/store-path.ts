/**
 * Store Path Resolution
 *
 * Shared by the SQLite-backed autonomy stores (scheduler, loops, task queue,
 * triggers). Resolves the database file for a data directory, or an in-memory
 * database when the kernel runs in ephemeral mode.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Pass as `dataDir` to keep a store's database in memory (nothing written to disk). */
export const IN_MEMORY_DATA_DIR = ':memory:';

/** Database file name shared by every store inside a data directory. */
const DATABASE_FILE = 'kernova.db';

/**
 * Resolve the SQLite path for a store, creating the data directory if needed.
 * Returns `':memory:'` when `dataDir` is {@link IN_MEMORY_DATA_DIR}.
 */
export function resolveStorePath(dataDir: string): string {
  if (dataDir === IN_MEMORY_DATA_DIR) return IN_MEMORY_DATA_DIR;

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return join(dataDir, DATABASE_FILE);
}
