'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { searchMemory, type MemoryEntry } from '@/lib/api';

const layers = ['all', 'working', 'session', 'longterm', 'organizational', 'global'] as const;

export default function MemoryPage() {
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<string>('all');
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearched(true);
    const res = await searchMemory(query, layer === 'all' ? undefined : layer);
    setResults(res.results);
  };

  const columns = [
    { key: 'content', header: 'Content', render: (m: MemoryEntry) => <span className="text-white max-w-md truncate block">{m.content}</span> },
    { key: 'layer', header: 'Layer', render: (m: MemoryEntry) => (
      <span className={`text-xs px-2 py-0.5 rounded ${
        m.layer === 'working' ? 'bg-emerald-500/20 text-emerald-400' :
        m.layer === 'session' ? 'bg-blue-500/20 text-blue-400' :
        m.layer === 'longterm' ? 'bg-purple-500/20 text-purple-400' :
        'bg-zinc-500/20 text-zinc-400'
      }`}>{m.layer}</span>
    )},
    { key: 'relevance', header: 'Relevance', render: (m: MemoryEntry) => <span className="font-mono text-kernova-400">{(m.relevance * 100).toFixed(0)}%</span> },
    { key: 'tags', header: 'Tags', render: (m: MemoryEntry) => <span className="text-xs text-zinc-500">{m.tags.join(', ')}</span> },
    { key: 'timestamp', header: 'Time', render: (m: MemoryEntry) => <span className="text-xs text-zinc-500">{new Date(m.timestamp).toLocaleString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Memory Explorer</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Search agent memory across all layers</p>
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

      {searched ? (
        <DataTable columns={columns} data={results} emptyMessage="No memory entries found for this query." />
      ) : (
        <div className="text-center py-12 text-zinc-600 text-sm">
          Enter a query above to search agent memory. Results are ranked by semantic relevance.
        </div>
      )}
    </div>
  );
}
