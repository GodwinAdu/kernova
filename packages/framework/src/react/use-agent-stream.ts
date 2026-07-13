'use client';

/**
 * useAgentStream — Streaming hook for real-time agent responses.
 *
 * Usage:
 *   import { useAgentStream } from '@kernova/framework/react';
 *
 *   function ChatPage() {
 *     const { messages, send, streamingContent, isStreaming } = useAgentStream('support');
 *
 *     return (
 *       <div>
 *         {messages.map(m => <p key={m.id}>{m.content}</p>)}
 *         {isStreaming && <p className="animate-pulse">{streamingContent}</p>}
 *       </div>
 *     );
 *   }
 */

import { useState, useCallback, useRef } from 'react';
import { useKernovaContext } from './provider.js';
import type { AgentMessage } from './use-agent.js';

export interface UseAgentStreamOptions {
  threadId?: string;
  context?: Record<string, unknown>;
  user?: { id: string; [key: string]: unknown };
  onChunk?: (chunk: string) => void;
  onComplete?: (message: AgentMessage) => void;
  onError?: (error: Error) => void;
}

export interface UseAgentStreamReturn {
  messages: AgentMessage[];
  send: (input: string) => Promise<void>;
  isStreaming: boolean;
  streamingContent: string;
  error: Error | null;
  threadId: string;
  clear: () => void;
  abort: () => void;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateThreadId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Hook for streaming agent responses (Server-Sent Events).
 */
export function useAgentStream(agentName: string, options: UseAgentStreamOptions = {}): UseAgentStreamReturn {
  const { baseUrl, headers } = useKernovaContext();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const threadIdRef = useRef(options.threadId || generateThreadId());
  const abortControllerRef = useRef<AbortController | null>(null);

  const send = useCallback(async (input: string) => {
    setError(null);
    setIsStreaming(true);
    setStreamingContent('');

    // Add user message
    const userMessage: AgentMessage = {
      id: generateId(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev: AgentMessage[]) => [...prev, userMessage]);

    // Create abort controller for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${baseUrl}/agents/${agentName}/stream`, {
        method: 'POST',
        headers: {
          ...headers,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          input,
          threadId: threadIdRef.current,
          context: options.context,
          user: options.user,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Stream request failed (${response.status}): ${errorBody}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE data
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || parsed.content || '';
              if (content) {
                fullContent += content;
                setStreamingContent(fullContent);
                options.onChunk?.(content);
              }
            } catch {
              // If not JSON, treat as plain text chunk
              fullContent += data;
              setStreamingContent(fullContent);
              options.onChunk?.(data);
            }
          }
        }
      }

      // Finalize the message
      const assistantMessage: AgentMessage = {
        id: generateId(),
        role: 'assistant',
        content: fullContent,
        timestamp: new Date(),
      };
      setMessages((prev: AgentMessage[]) => [...prev, assistantMessage]);
      setStreamingContent('');
      options.onComplete?.(assistantMessage);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User aborted, save partial content
        if (streamingContent) {
          const partialMessage: AgentMessage = {
            id: generateId(),
            role: 'assistant',
            content: streamingContent + ' [aborted]',
            timestamp: new Date(),
          };
          setMessages((prev: AgentMessage[]) => [...prev, partialMessage]);
        }
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options.onError?.(error);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [agentName, baseUrl, headers, options, streamingContent]);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    setStreamingContent('');
    threadIdRef.current = generateThreadId();
  }, []);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    messages,
    send,
    isStreaming,
    streamingContent,
    error,
    threadId: threadIdRef.current,
    clear,
    abort,
  };
}
