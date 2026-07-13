'use client';

/**
 * useMemory — Hook for interacting with agent memory from the frontend.
 *
 * Usage:
 *   import { useMemory } from '@kernova/framework/react';
 *
 *   function Dashboard() {
 *     const { entries, search, store } = useMemory('conversations');
 *
 *     return (
 *       <div>
 *         <button onClick={() => search('recent meetings')}>Search</button>
 *         {entries.map(e => <p key={e.id}>{e.content}</p>)}
 *       </div>
 *     );
 *   }
 */

import { useState, useCallback } from 'react';
import { useKernovaContext } from './provider.js';

export interface MemoryEntry {
  id: string;
  content: string;
  score?: number;
  tags: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UseMemoryOptions {
  /** Auto-fetch recent entries on mount */
  autoFetch?: boolean;
  /** Number of entries to fetch */
  limit?: number;
}

export interface UseMemoryReturn {
  /** Current entries */
  entries: MemoryEntry[];
  /** Search memory by query */
  search: (query: string, limit?: number) => Promise<MemoryEntry[]>;
  /** Store a new memory entry */
  store: (content: string, tags?: string[], metadata?: Record<string, unknown>) => Promise<void>;
  /** Delete a memory entry */
  remove: (id: string) => Promise<void>;
  /** Loading state */
  isLoading: boolean;
  /** Last error */
  error: Error | null;
}

/**
 * Hook for reading and writing agent memory.
 */
export function useMemory(namespace: string, options: UseMemoryOptions = {}): UseMemoryReturn {
  const { baseUrl, headers } = useKernovaContext();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const search = useCallback(async (query: string, limit?: number): Promise<MemoryEntry[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: query,
        namespace,
        ...(limit ? { limit: String(limit) } : {}),
      });

      const response = await fetch(`${baseUrl}/memory/search?${params}`, { headers });

      if (!response.ok) {
        throw new Error(`Memory search failed (${response.status})`);
      }

      const data = await response.json() as { entries?: MemoryEntry[]; results?: MemoryEntry[] };
      const results = data.entries || data.results || [];
      setEntries(results);
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, headers, namespace]);

  const store = useCallback(async (
    content: string,
    tags: string[] = [],
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    setError(null);

    try {
      const response = await fetch(`${baseUrl}/memory`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ namespace, content, tags, metadata }),
      });

      if (!response.ok) {
        throw new Error(`Memory store failed (${response.status})`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    }
  }, [baseUrl, headers, namespace]);

  const remove = useCallback(async (id: string): Promise<void> => {
    setError(null);

    try {
      const response = await fetch(`${baseUrl}/memory/${id}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Memory delete failed (${response.status})`);
      }

      setEntries((prev: MemoryEntry[]) => prev.filter((e: MemoryEntry) => e.id !== id));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    }
  }, [baseUrl, headers]);

  return {
    entries,
    search,
    store,
    remove,
    isLoading,
    error,
  };
}
