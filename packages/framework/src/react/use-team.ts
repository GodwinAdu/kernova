'use client';

/**
 * useTeam — React hook for executing team tasks and tracking progress.
 *
 * Usage:
 *   import { useTeam } from '@kernova/framework/react';
 *
 *   function TeamDashboard() {
 *     const { execute, isRunning, progress, result, trace } = useTeam('engineering-team');
 *
 *     return (
 *       <div>
 *         <button onClick={() => execute('Build a login page')}>
 *           Start Task
 *         </button>
 *
 *         {isRunning && (
 *           <div>
 *             {progress.map(event => (
 *               <p key={event.timestamp}>
 *                 [{event.agent}] {event.type}
 *               </p>
 *             ))}
 *           </div>
 *         )}
 *
 *         {result && <div>{result}</div>}
 *       </div>
 *     );
 *   }
 */

import { useState, useCallback, useRef } from 'react';
import { useKernovaContext } from './provider.js';

export interface TeamProgressEvent {
  type: 'task-assigned' | 'task-started' | 'task-completed' | 'delegation' | 'review' | 'message' | 'error' | 'completed';
  agent?: string;
  taskGoal?: string;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface TeamExecutionResult {
  result: string;
  tasks: Array<{
    agent: string;
    goal: string;
    status: string;
    result?: string;
  }>;
  messages: Array<{
    from: string;
    to: string;
    type: string;
    content: string;
  }>;
  duration: number;
  totalTasks: number;
}

export interface UseTeamOptions {
  /** Override the strategy for this execution */
  strategy?: string;
  /** Additional context to provide all agents */
  context?: Record<string, unknown>;
  /** Timeout in ms */
  timeout?: number;
  /** Callback on each progress event */
  onProgress?: (event: TeamProgressEvent) => void;
  /** Callback on completion */
  onComplete?: (result: TeamExecutionResult) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export interface UseTeamReturn {
  /** Execute a task with the team */
  execute: (goal: string, options?: UseTeamOptions) => Promise<TeamExecutionResult | null>;
  /** Whether the team is currently working */
  isRunning: boolean;
  /** Progress events from the current execution */
  progress: TeamProgressEvent[];
  /** The final result (null if not yet completed) */
  result: TeamExecutionResult | null;
  /** Error if execution failed */
  error: Error | null;
  /** Cancel the current execution */
  cancel: () => void;
  /** Reset state */
  reset: () => void;
}

export function useTeam(teamName: string, defaultOptions?: UseTeamOptions): UseTeamReturn {
  const { baseUrl } = useKernovaContext();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<TeamProgressEvent[]>([]);
  const [result, setResult] = useState<TeamExecutionResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setIsRunning(false);
    setProgress([]);
    setResult(null);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const execute = useCallback(async (
    goal: string,
    options?: UseTeamOptions,
  ): Promise<TeamExecutionResult | null> => {
    const mergedOptions = { ...defaultOptions, ...options };

    // Reset state
    setIsRunning(true);
    setProgress([]);
    setResult(null);
    setError(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const response = await fetch(`${baseUrl}/v1/teams/${teamName}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal,
          strategy: mergedOptions.strategy,
          context: mergedOptions.context,
          timeout: mergedOptions.timeout,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Team execution failed: ${response.statusText}`);
      }

      // Check if streaming response
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // Handle SSE streaming for progress updates
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: TeamExecutionResult | null = null;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));

                  if (data.type === 'progress') {
                    const event: TeamProgressEvent = data.event;
                    setProgress(prev => [...prev, event]);
                    mergedOptions.onProgress?.(event);
                  } else if (data.type === 'result') {
                    finalResult = data.result;
                  }
                } catch {
                  // Skip malformed SSE
                }
              }
            }
          }
        }

        if (finalResult) {
          setResult(finalResult);
          mergedOptions.onComplete?.(finalResult);
          setIsRunning(false);
          return finalResult;
        }
      } else {
        // Non-streaming: get the full result
        const data = await response.json();
        const executionResult: TeamExecutionResult = {
          result: data.result || data.trace?.result || '',
          tasks: data.trace?.tasks?.map((t: any) => ({
            agent: t.assignee,
            goal: t.goal,
            status: t.status,
            result: t.result,
          })) || [],
          messages: data.trace?.messages || [],
          duration: data.duration || 0,
          totalTasks: data.trace?.tasks?.length || 0,
        };

        setResult(executionResult);
        mergedOptions.onComplete?.(executionResult);
        setIsRunning(false);
        return executionResult;
      }

      setIsRunning(false);
      return null;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setIsRunning(false);
        return null;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      mergedOptions.onError?.(error);
      setIsRunning(false);
      return null;
    }
  }, [teamName, baseUrl, defaultOptions]);

  return { execute, isRunning, progress, result, error, cancel, reset };
}
