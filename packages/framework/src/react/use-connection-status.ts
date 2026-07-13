'use client';

/**
 * useConnectionStatus — Monitor the connection to the Kernova backend.
 *
 * Usage:
 *   import { useConnectionStatus } from '@kernova/framework/react';
 *
 *   function StatusBadge() {
 *     const { isConnected, latency, check } = useConnectionStatus();
 *     return <span>{isConnected ? '🟢 Connected' : '🔴 Disconnected'}</span>;
 *   }
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useKernovaContext } from './provider.js';

export interface UseConnectionStatusReturn {
  /** Whether the backend is reachable */
  isConnected: boolean;
  /** Last measured latency in ms */
  latency: number | null;
  /** Manually trigger a health check */
  check: () => Promise<boolean>;
  /** Last check timestamp */
  lastCheck: Date | null;
}

/**
 * Hook to monitor the connection to the Kernova agent backend.
 * Automatically polls every 30s.
 */
export function useConnectionStatus(pollInterval = 30000): UseConnectionStatusReturn {
  const { baseUrl, headers } = useKernovaContext();
  const [isConnected, setIsConnected] = useState(true);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async (): Promise<boolean> => {
    const start = Date.now();
    try {
      const response = await fetch(`${baseUrl}/../health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      const elapsed = Date.now() - start;
      const connected = response.ok;
      setIsConnected(connected);
      setLatency(elapsed);
      setLastCheck(new Date());
      return connected;
    } catch {
      setIsConnected(false);
      setLatency(null);
      setLastCheck(new Date());
      return false;
    }
  }, [baseUrl, headers]);

  useEffect(() => {
    check(); // Initial check
    intervalRef.current = setInterval(check, pollInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check, pollInterval]);

  return { isConnected, latency, check, lastCheck };
}
