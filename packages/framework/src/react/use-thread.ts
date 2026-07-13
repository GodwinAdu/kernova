'use client';

/**
 * useThread — Hook for managing conversation threads.
 *
 * Usage:
 *   import { useThread } from '@kernova/framework/react';
 *
 *   function Sidebar() {
 *     const { threads, create, switchTo, active } = useThread();
 *
 *     return (
 *       <ul>
 *         {threads.map(t => (
 *           <li key={t.id} onClick={() => switchTo(t.id)}>
 *             {t.title}
 *           </li>
 *         ))}
 *         <button onClick={() => create()}>New Chat</button>
 *       </ul>
 *     );
 *   }
 */

import { useState, useCallback } from 'react';
import { useKernovaContext } from './provider.js';

export interface Thread {
  id: string;
  title: string;
  agentName: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UseThreadReturn {
  /** All threads */
  threads: Thread[];
  /** Currently active thread ID */
  activeId: string | null;
  /** Create a new thread */
  create: (agentName?: string, title?: string) => Promise<Thread>;
  /** Switch to a thread */
  switchTo: (threadId: string) => void;
  /** Delete a thread */
  remove: (threadId: string) => Promise<void>;
  /** Fetch all threads */
  refresh: () => Promise<void>;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Hook for managing multiple conversation threads.
 */
export function useThread(): UseThreadReturn {
  const { baseUrl, headers } = useKernovaContext();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${baseUrl}/threads`, { headers });
      if (response.ok) {
        const data = await response.json() as { threads?: Thread[] };
        setThreads(data.threads || []);
      }
    } catch {
      // Silently fail — threads are non-critical
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, headers]);

  const create = useCallback(async (agentName?: string, title?: string): Promise<Thread> => {
    const response = await fetch(`${baseUrl}/threads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentName, title }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create thread (${response.status})`);
    }

    const thread = await response.json() as Thread;
    setThreads((prev: Thread[]) => [thread, ...prev]);
    setActiveId(thread.id);
    return thread;
  }, [baseUrl, headers]);

  const switchTo = useCallback((threadId: string) => {
    setActiveId(threadId);
  }, []);

  const remove = useCallback(async (threadId: string) => {
    const response = await fetch(`${baseUrl}/threads/${threadId}`, {
      method: 'DELETE',
      headers,
    });

    if (response.ok) {
      setThreads((prev: Thread[]) => prev.filter((t: Thread) => t.id !== threadId));
      if (activeId === threadId) {
        setActiveId(null);
      }
    }
  }, [baseUrl, headers, activeId]);

  return {
    threads,
    activeId,
    create,
    switchTo,
    remove,
    refresh,
    isLoading,
  };
}
