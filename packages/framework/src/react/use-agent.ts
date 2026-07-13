'use client';

/**
 * useAgent — The primary hook for talking to a Kernova agent.
 *
 * Usage:
 *   import { useAgent } from '@kernova/framework/react';
 *
 *   function ChatPage() {
 *     const { messages, send, isLoading, error } = useAgent('support');
 *
 *     return (
 *       <div>
 *         {messages.map(m => <p key={m.id}>{m.content}</p>)}
 *         <input onKeyDown={(e) => {
 *           if (e.key === 'Enter') send(e.currentTarget.value);
 *         }} />
 *       </div>
 *     );
 *   }
 */

import { useState, useCallback, useRef } from 'react';
import { useKernovaContext } from './provider.js';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface UseAgentOptions {
  /** Initial thread ID (for resuming conversations) */
  threadId?: string;
  /** Additional context to pass with each request */
  context?: Record<string, unknown>;
  /** User info to pass */
  user?: { id: string; [key: string]: unknown };
  /** Called when a response is received */
  onResponse?: (message: AgentMessage) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface UseAgentReturn {
  /** All messages in the conversation */
  messages: AgentMessage[];
  /** Send a message to the agent */
  send: (input: string) => Promise<void>;
  /** Whether a response is being generated */
  isLoading: boolean;
  /** Last error, if any */
  error: Error | null;
  /** Current thread ID */
  threadId: string;
  /** Clear the conversation */
  clear: () => void;
  /** Retry the last message */
  retry: () => Promise<void>;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateThreadId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Hook to interact with a named agent.
 * The agent name maps to the file: agents/<name>.agent.ts
 */
export function useAgent(agentName: string, options: UseAgentOptions = {}): UseAgentReturn {
  const { baseUrl, headers } = useKernovaContext();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const threadIdRef = useRef(options.threadId || generateThreadId());
  const lastInputRef = useRef<string>('');

  const send = useCallback(async (input: string) => {
    lastInputRef.current = input;
    setError(null);
    setIsLoading(true);

    // Add user message immediately
    const userMessage: AgentMessage = {
      id: generateId(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev: AgentMessage[]) => [...prev, userMessage]);

    try {
      const response = await fetch(`${baseUrl}/agents/${agentName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input,
          threadId: threadIdRef.current,
          context: options.context,
          user: options.user,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Agent request failed (${response.status}): ${errorBody}`);
      }

      const data = await response.json() as { content?: string; result?: string; metadata?: Record<string, unknown> };

      const assistantMessage: AgentMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.content || data.result || '',
        timestamp: new Date(),
        metadata: data.metadata,
      };

      setMessages((prev: AgentMessage[]) => [...prev, assistantMessage]);
      options.onResponse?.(assistantMessage);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      options.onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [agentName, baseUrl, headers, options]);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    threadIdRef.current = generateThreadId();
  }, []);

  const retry = useCallback(async () => {
    if (lastInputRef.current) {
      // Remove last assistant message (if failed) and retry
      setMessages((prev: AgentMessage[]) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'user') {
          return prev.slice(0, -1);
        }
        return prev;
      });
      await send(lastInputRef.current);
    }
  }, [send]);

  return {
    messages,
    send,
    isLoading,
    error,
    threadId: threadIdRef.current,
    clear,
    retry,
  };
}
