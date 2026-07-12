'use client';

import { useState, useEffect } from 'react';
import { fetchLogs, type LogEntry } from '@/lib/api';

const levels = ['all', 'debug', 'info', 'warn', 'error'] as const;

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<string>('all');

  useEffect(() => {
    const load = async () => {
      const data = await fetchLogs({ level: level === 'all' ? undefined : level, limit: 100 });
      setLogs(data.logs);
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [level]);

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
          <p className="text-sm text-zinc-500 mt-0.5">Runtime log stream • Auto-refreshing every 3s</p>
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
          {logs.length === 0 ? (
            <div className="text-center py-8 text-zinc-600">
              No logs yet. Events will appear here as the runtime processes intents.
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-3 py-1 hover:bg-zinc-900/50 px-2 rounded">
                <span className="text-zinc-600 w-20 flex-shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className={`w-12 flex-shrink-0 ${levelColors[log.level] || 'text-zinc-500'}`}>{log.level.toUpperCase()}</span>
                <span className="text-zinc-600 w-28 flex-shrink-0 truncate">[{log.source}]</span>
                <span className="text-zinc-300 flex-1">{log.message}</span>
                {log.traceId && <span className="text-zinc-700 flex-shrink-0">{log.traceId}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
