/**
 * KernovaProvider — React context provider.
 *
 * Wraps your app and provides the connection config to all hooks.
 * In dev mode, connects to localhost. In production, connects to your Kernova Cloud URL.
 *
 * Usage:
 *   // app/layout.tsx
 *   import { KernovaProvider } from '@kernova/framework/react';
 *
 *   export default function Layout({ children }) {
 *     return (
 *       <KernovaProvider>
 *         {children}
 *       </KernovaProvider>
 *     );
 *   }
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

export interface KernovaContextValue {
  /** Base URL of the Kernova backend */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Default headers to include in requests */
  headers: Record<string, string>;
  /** WebSocket URL */
  wsUrl: string;
}

export interface KernovaProviderProps {
  children: ReactNode;
  /** Override the base URL (defaults to auto-detection) */
  baseUrl?: string;
  /** API key for Kernova Cloud */
  apiKey?: string;
  /** Additional headers */
  headers?: Record<string, string>;
}

const KernovaContext = createContext<KernovaContextValue | null>(null);

/**
 * Auto-detect the backend URL.
 * In development: same origin with /api prefix (Next.js rewrites to agent backend)
 * In production: same origin with /api prefix (Kernova Cloud gateway routes it)
 *
 * This means the frontend ALWAYS talks to its own URL — no CORS, no separate ports.
 */
function detectBaseUrl(): string {
  if (typeof window === 'undefined') {
    // Server-side: use env variable or default to internal agent port
    return process.env.KERNOVA_URL || 'http://localhost:4555';
  }

  // Client-side: check for explicit override
  if (process.env.NEXT_PUBLIC_KERNOVA_URL) {
    return process.env.NEXT_PUBLIC_KERNOVA_URL;
  }

  // Default: same-origin /api path (proxied by Next.js rewrites or Kernova Cloud gateway)
  return `${window.location.origin}/api`;
}

function deriveWsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/?$/, '/ws');
  return url.toString();
}

export function KernovaProvider({ children, baseUrl, apiKey, headers = {} }: KernovaProviderProps) {
  const value = useMemo<KernovaContextValue>(() => {
    const resolvedUrl = baseUrl || detectBaseUrl();
    const resolvedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (apiKey) {
      resolvedHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    return {
      baseUrl: resolvedUrl,
      apiKey,
      headers: resolvedHeaders,
      wsUrl: deriveWsUrl(resolvedUrl),
    };
  }, [baseUrl, apiKey, headers]);

  return (
    <KernovaContext.Provider value={value}>
      {children}
    </KernovaContext.Provider>
  );
}

export function useKernovaContext(): KernovaContextValue {
  const context = useContext(KernovaContext);
  if (!context) {
    throw new Error('useKernovaContext: Must be used within a <KernovaProvider>');
  }
  return context;
}
