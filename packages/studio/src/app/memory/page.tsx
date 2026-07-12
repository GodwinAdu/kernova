'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { searchMemory, type MemoryEntry } from '@/lib/api';

const mockMemory: MemoryEntry[] = [
  { id: 'm-001', content: 'User prefers TypeScript with strict mode enabled', layer: 'longterm', tags: ['preference', 'typescript'], relevance: 0.95, timestamp: '2024-01-20T10:00:00Z' },
  { id: 'm-002', content: 'Current task: refactor authentication module', layer: 'working', tags: ['task', 'auth'], relevance: 0.88, timestamp: '2024-01-20T15:30:00Z' },
  { id: 'm-003', content: 'Project uses Next.js 14 with App Router', layer: 'session', tags: ['context', 'framework'], relevance: 0.82, timestamp: '2024-01-20T14:00:00Z' },
  { id: 'm-004', content: 'Team coding standards require 80% test coverage', layer: 'organizational', tags: ['standard', 'testing'], relevance: 0.76, timestamp: '2024-01-19T09:00:00Z' },
  { id: 'm-005', content: 'Common pattern: use dependency injection for services', layer: 'global', tags: ['pattern', 'architecture'], relevance: 0.71, timestamp: '2024-01-18T12:00:00Z' },
];

const layers = ['all', 'working', 'session', 'longterm', 'organizational', 'global'] as const;

export default function MemoryPage() {
  const [results, setResults] = useState<MemoryEntry[]>(mockMemory);
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<string>('all');

  const handleSearch = async () => {
    if (!query.trim()) { setResults(mockMemory); return; }
    const res = await searchMemory(query, layer === 'all' ? undefined : layer).catch(() => null);
    if (res) setResults(res.results);
  };

  const filtered = layer === 'all' ? results : results.filter((m) => m.layer === layer);

  const columns = [
    { key: 'content', header: 'Content', render: (m: MemoryEntry) => <span className="text-white max-w-md truncate block">{m.content}</span> },
    { key: 'layer', header: 'Layer', render: (m: MemoryEntry) => <span className={`badge badge-${m.layer === 'working' ? 'active' : m.layer === 'session' ? 'info' : 'idle'}`}>{m.layer}</span> },
    { key: 'relevance', header: 'Relevance', render: (m: MemoryEntry) => <span className="font-mono text-kernova-400">{(m.relevance * 100).toFixed(0)}%</span> },
    { key: 'tags', header: 'Tags', render: (m: MemoryEntry) => <span className="text-xs text-zinc-500">{m.tags.join(', ')}</span> },
    { key: 'timestamp', header: 'Time', render: (m: MemoryEntry) => <span className="text-xs text-zinc-500">{new Date(m.timestamp).toLocaleString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Memory Explorer</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Search and inspect agent memory across all layers</p>
      </div>

      {/* Search & Filter */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Semantic search across memory..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500"
          />
          <select
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500"
          >
            {layers.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button onClick={handleSearch} className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-md font-medium transition-colors">
            Search
          </button>
        </div>
      </div>

      <DataTable columns={columns} data={filtered} emptyMessage="No memory entries found" />
    </div>
  );
}
