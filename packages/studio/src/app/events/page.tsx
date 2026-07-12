'use client';

import { useState, useEffect } from 'react';
import { fetchEvents, type KernovaEvent } from '@/lib/api';

const mockEvents: KernovaEvent[] = [
  { id: 'ev-001', type: 'intent.created', category: 'intent', severity: 'info', message: 'New intent submitted: refactor auth module', timestamp: '2024-01-20T15:30:22Z' },
  { id: 'ev-002', type: 'agent.assigned', category: 'agent', severity: 'info', message: 'Agent "Coder" assigned to intent ev-001', timestamp: '2024-01-20T15:30:23Z' },
  { id: 'ev-003', type: 'tool.executed', category: 'tool', severity: 'info', message: 'Tool file_read executed successfully', timestamp: '2024-01-20T15:30:25Z' },
  { id: 'ev-004', type: 'memory.updated', category: 'memory', severity: 'info', message: 'Working memory updated with new context', timestamp: '2024-01-20T15:30:26Z' },
  { id: 'ev-005', type: 'agent.error', category: 'agent', severity: 'error', message: 'Agent "Reviewer" failed: rate limit exceeded', timestamp: '2024-01-20T15:29:10Z', data: { code: 'RATE_LIMIT', retryAfter: 60 } },
  { id: 'ev-006', type: 'workflow.step', category: 'workflow', severity: 'info', message: 'Workflow "Code Review" step 3/5 completed', timestamp: '2024-01-20T15:28:45Z' },
  { id: 'ev-007', type: 'system.health', category: 'system', severity: 'warn', message: 'Memory usage above 80% threshold', timestamp: '2024-01-20T15:25:00Z' },
];

const categories = ['all', 'intent', 'agent', 'tool', 'memory', 'workflow', 'system'];
const severities = ['all', 'info', 'warn', 'error', 'critical'];

export default function EventsPage() {
  const [events, setEvents] = useState<KernovaEvent[]>(mockEvents);
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchEvents({ category: category === 'all' ? undefined : category, severity: severity === 'all' ? undefined : severity, limit: 50 })
        .then((r) => setEvents(r.events))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [category, severity]);

  const filtered = events
    .filter((e) => category === 'all' || e.category === category)
    .filter((e) => severity === 'all' || e.severity === severity);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Event Inspector</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Real-time event stream • Auto-refreshing every 2s</p>
        </div>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500">
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500">
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Event Stream */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800/50">
        {filtered.map((event) => (
          <div key={event.id} className="hover:bg-zinc-800/30 transition-colors">
            <button onClick={() => setExpanded(expanded === event.id ? null : event.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
              <span className={`badge badge-${event.severity === 'error' ? 'error' : event.severity === 'warn' ? 'warn' : 'info'}`}>
                {event.severity}
              </span>
              <span className="text-xs text-zinc-600 font-mono">{event.type}</span>
              <span className="text-sm text-zinc-300 flex-1 truncate">{event.message}</span>
              <span className="text-xs text-zinc-600">{new Date(event.timestamp).toLocaleTimeString()}</span>
            </button>
            {expanded === event.id && event.data && (
              <div className="px-4 pb-3">
                <pre className="bg-zinc-900 border border-zinc-800 rounded p-3 text-xs text-zinc-400 overflow-auto">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
