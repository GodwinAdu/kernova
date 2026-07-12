'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchAgents, submitIntent, type Agent } from '@/lib/api';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [intentGoal, setIntentGoal] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await fetchAgents();
      setAgents(data.agents);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async () => {
    if (!intentGoal.trim()) return;
    try {
      const result = await submitIntent(intentGoal, selectedAgent || undefined);
      setLastResult(`Intent ${result.id} → ${result.status}`);
      setIntentGoal('');
    } catch (err: any) {
      setLastResult(`Error: ${err.message}`);
    }
  };

  const columns = [
    { key: 'name', header: 'Name', render: (a: Agent) => <span className="font-medium text-white">{a.name}</span> },
    { key: 'status', header: 'Status', render: (a: Agent) => (
      <span className={`text-xs ${a.status === 'active' ? 'text-emerald-400' : a.status === 'idle' ? 'text-zinc-400' : 'text-red-400'}`}>
        ● {a.status}
      </span>
    )},
    { key: 'model', header: 'Model', render: (a: Agent) => <span className="font-mono text-xs text-zinc-400">{a.model}</span> },
    { key: 'capabilities', header: 'Capabilities', render: (a: Agent) => <span className="text-xs text-zinc-500">{a.capabilities.join(', ')}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Agents</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Registered agents and intent submission</p>
      </div>

      {/* Submit Intent */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Submit Intent to Agent</h2>
        <div className="flex gap-3">
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500"
          >
            <option value="">Any agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input
            type="text"
            value={intentGoal}
            onChange={(e) => setIntentGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Describe the goal..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500"
          />
          <button onClick={handleSubmit} className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-md font-medium transition-colors">
            Submit
          </button>
        </div>
        {lastResult && <p className="mt-2 text-xs text-zinc-400 font-mono">{lastResult}</p>}
      </div>

      {/* Agents Table */}
      <DataTable columns={columns} data={agents} emptyMessage="No agents registered. Use kernel.agentRegistry.register() to add agents." />
    </div>
  );
}
