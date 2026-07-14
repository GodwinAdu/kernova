/**
 * Memory Providers — Pluggable storage backends.
 *
 * Usage:
 *   import { createMemoryProvider } from '@kernova/core';
 *
 *   // SQLite (default)
 *   const provider = await createMemoryProvider({ provider: 'sqlite', path: './data/memory.db' });
 *
 *   // PostgreSQL with pgvector
 *   const provider = await createMemoryProvider({ provider: 'postgres', url: process.env.DATABASE_URL });
 *
 *   // In-memory (testing)
 *   const provider = await createMemoryProvider({ provider: 'memory' });
 *
 *   // Custom
 *   const provider = await createMemoryProvider({ provider: 'custom', adapter: myCustomProvider });
 */

export type { MemoryProvider, MemoryEntry, MemorySearchOptions, MemorySearchResult, MemoryProviderConfig } from './types.js';
export { SqliteMemoryProvider } from './sqlite-provider.js';
export { PostgresMemoryProvider } from './postgres-provider.js';
export { InMemoryProvider } from './memory-provider.js';

import type { MemoryProvider, MemoryProviderConfig } from './types.js';
import { SqliteMemoryProvider } from './sqlite-provider.js';
import { PostgresMemoryProvider } from './postgres-provider.js';
import { InMemoryProvider } from './memory-provider.js';

/**
 * Factory function — creates and initializes a memory provider based on config.
 */
export async function createMemoryProvider(config: MemoryProviderConfig): Promise<MemoryProvider> {
  let provider: MemoryProvider;

  switch (config.provider) {
    case 'sqlite':
      provider = new SqliteMemoryProvider({
        path: config.path || './kernova-data/memory.db',
      });
      break;

    case 'postgres':
      if (!config.url) {
        throw new Error('PostgreSQL provider requires a "url" (DATABASE_URL)');
      }
      provider = new PostgresMemoryProvider({
        url: config.url,
        table: config.table,
        vectorDimensions: (config.options?.vectorDimensions as number) || 1536,
      });
      break;

    case 'memory':
      provider = new InMemoryProvider();
      break;

    case 'custom':
      if (!config.adapter) {
        throw new Error('Custom provider requires an "adapter" (instance or path)');
      }
      if (typeof config.adapter === 'string') {
        // Dynamic import of adapter file
        const mod = await import(config.adapter);
        provider = mod.default || mod;
      } else {
        provider = config.adapter;
      }
      break;

    default:
      // Default to SQLite
      provider = new SqliteMemoryProvider({
        path: config.path || './kernova-data/memory.db',
      });
  }

  await provider.initialize();
  return provider;
}
