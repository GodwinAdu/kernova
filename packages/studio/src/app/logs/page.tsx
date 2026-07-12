'use client';

import { useState, useEffect } from 'react';
import { fetchLogs, type LogEntry } from '@/lib/api';

const mockLogs: LogEntry[] = [
  { id: 'log-001', level: 'info', message: 'Intent int-042 completed successfully', source: 'planner', traceId: 'tr-8a4f2b', timestamp: '2024-01-20T15:30:22Z' },
  { id: 'log-002', level: 'debug', message: 'Memory layer "working" updated: 3 entries added', source: 'memory-engine', traceId: 'tr-8a4f2b', timestamp: '2024-01-20T15:30:21Z' },
  { id: 'log-003', level: 'warn', message: 'Token budget 80% consumed for session ctx-19', source: 'context-engine', traceId: 'tr-8a4f2b', timestamp: '2024-01-20T15:30:20Z' },
  { id: 'log-004', level: 'error', message: 'Tool execution failed: file_write permission denied', source: 'tool-runner', traceId: 'tr-7c3e1a', timestamp: '2024-01-20T15:29:58Z' },
  { id: 'log-005', level: 'info', message: 'Agent "Coder" started processing intent int-043', source: 'orchestrator', traceId: 'tr-9b5g3c', timestamp: '2024-01-20T15:29:45Z' },
  { id: 'log-006', level: 'info', message: 'Plugin @kernova/github loaded successfully', source: 'plugin-loader', timestamp: '2024-01-20T15:25:00Z' },
  { id: 'log-007', level: 'debug', message: 'Health check passed: all subsystems operational', source: 'health-monitor', timestamp: '2024-01-20T15:20:00Z' },
  { id: 'log-008', level: 'info', message: 'Workflow "Code Review" triggered for PR #127', source: 'workflow-engine', traceId: 'tr-6d2f0b', timestamp: '2024-01-20T15:18:30Z' },
];

const levels = ['all', 'debug', 'info', 'warn', 'error'] as const;

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>(mockLogs);
  const [level, setLevel] = useState<string>('all');

  useEffect(() => {
    fetchLogs({ level: level === 'all' ? undefined : level, limit: 100 })
      .then((r) => setLogs(r.logs))
      .catch(() => {});
  }, [level]);

  const filtered = level === 'all' ? logs : logs.filter((l) => l.level === level);

  const levelColors: Record<string, string> = {
    debug: 'text-zinc-500',
    info: 'text-blue-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Logs & Traces</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Trajectory recording and intent traces</p>
        </div>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500">
          {levels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* Log Stream */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs">
        <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
          <span className="text-zinc-500">$ kernova logs --follow</span>
        </div>
        <div className="p-3 space-y-1 max-h-[600px] overflow-y-auto">
          {filtered.map((log) => (
            <div key={log.id} className="flex gap-3 py-1 hover:bg-zinc-900/50 px-2 rounded">
              <span className="text-zinc-600 w-20 flex-shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className={`w-12 flex-shrink-0 ${levelColors[log.level]}`}>{log.level.toUpperCase().padEnd(5)}</span>
              <span className="text-zinc-600 w-28 flex-shrink-0 truncate">[{log.source}]</span>
              <span className="text-zinc-300 flex-1">{log.message}</span>
              {log.traceId && <span className="text-zinc-700 flex-shrink-0">{log.traceId}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
