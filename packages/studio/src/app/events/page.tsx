'use client';

import { useState, useEffect } from 'react';
import { fetchEvents, type KernovaEvent } from '@/lib/api';

const categories = ['all', 'intent', 'agent', 'tool', 'memory', 'workflow', 'system'];
const severities = ['all', 'info', 'warn', 'error', 'critical'];

export default function EventsPage() {
  const [events, setEvents] = useState<KernovaEvent[]>([]);
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await fetchEvents({
        category: category === 'all' ? undefined : category,
        severity: severity === 'all' ? undefined : severity,
        limit: 50,
      });
      setEvents(data.events);
    };
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [category, severity]);

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
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-600">
            No events yet. Submit an intent or interact with the runtime to generate events.
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="hover:bg-zinc-800/30 transition-colors">
              <button onClick={() => setExpanded(expanded === event.id ? null : event.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  event.severity === 'error' ? 'bg-red-500/20 text-red-400' :
                  event.severity === 'warn' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-blue-500/20 text-blue-400'
                }`}>
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
          ))
        )}
      </div>
    </div>
  );
}
