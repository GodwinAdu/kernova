'use client';

import { useState } from 'react';
import { fetchContext, type ContextResult } from '@/lib/api';

export default function ContextPage() {
  const [intentId, setIntentId] = useState('');
  const [context, setContext] = useState<ContextResult | null>(null);

  const handleLookup = async () => {
    if (!intentId.trim()) return;
    const res = await fetchContext(intentId);
    setContext(res);
  };

  const maxTokens = context ? Math.max(...context.layers.map((l) => l.tokens), 1) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Context Debugger</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Inspect computed context for any intent</p>
      </div>

      {/* Lookup */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={intentId}
            onChange={(e) => setIntentId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            placeholder="Enter intent ID (e.g. intent_abc123)..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500"
          />
          <button onClick={handleLookup} className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-md font-medium transition-colors">
            Lookup
          </button>
        </div>
      </div>

      {/* Context Visualization */}
      {context ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-400">Context Layers • Intent: {context.intentId}</h2>
            <span className="text-xs text-zinc-500">Computed: {new Date(context.computedAt).toLocaleString()}</span>
          </div>

          <div className="space-y-3">
            {context.layers.map((layer) => (
              <div key={layer.name} className="flex items-center gap-4">
                <span className="w-28 text-sm text-zinc-400 text-right">{layer.name}</span>
                <div className="flex-1 h-6 bg-zinc-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-kernova-600/60 rounded transition-all"
                    style={{ width: `${(layer.tokens / maxTokens) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-zinc-500 w-20 text-right">{layer.tokens} tok</span>
                <span className="text-xs text-zinc-600 w-16 text-right">{layer.entries} entries</span>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800 flex justify-between">
            <span className="text-sm text-zinc-400">Total Context Window</span>
            <span className="text-sm font-mono text-kernova-400">{context.totalTokens.toLocaleString()} tokens</span>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-zinc-600 text-sm">
          Enter an intent ID above to inspect its computed context layers.
        </div>
      )}
    </div>
  );
}
