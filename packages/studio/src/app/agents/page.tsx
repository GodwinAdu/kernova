'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchAgents, submitIntent, type Agent } from '@/lib/api';

const mockAgents: Agent[] = [
  { id: 'agent-001', name: 'Planner', capabilities: ['planning', 'decomposition'], status: 'active', model: 'gpt-4o', intentsProcessed: 142, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'agent-002', name: 'Coder', capabilities: ['code-generation', 'debugging'], status: 'active', model: 'claude-3.5', intentsProcessed: 89, createdAt: '2024-01-16T14:30:00Z' },
  { id: 'agent-003', name: 'Researcher', capabilities: ['web-search', 'summarization'], status: 'idle', model: 'gpt-4o-mini', intentsProcessed: 56, createdAt: '2024-01-17T09:15:00Z' },
  { id: 'agent-004', name: 'Reviewer', capabilities: ['code-review', 'testing'], status: 'error', model: 'claude-3.5', intentsProcessed: 23, createdAt: '2024-01-18T11:45:00Z' },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>(mockAgents);
  const [intentGoal, setIntentGoal] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');

  useEffect(() => {
    fetchAgents().then((r) => setAgents(r.agents)).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!intentGoal.trim()) return;
    await submitIntent(intentGoal, selectedAgent || undefined).catch(() => {});
    setIntentGoal('');
  };

  const columns = [
    { key: 'name', header: 'Name', render: (a: Agent) => <span className="font-medium text-white">{a.name}</span> },
    { key: 'status', header: 'Status', render: (a: Agent) => <span className={`badge badge-${a.status === 'active' ? 'active' : a.status === 'idle' ? 'idle' : 'error'}`}>{a.status}</span> },
    { key: 'model', header: 'Model' },
    { key: 'capabilities', header: 'Capabilities', render: (a: Agent) => <span className="text-xs text-zinc-500">{a.capabilities.join(', ')}</span> },
    { key: 'intentsProcessed', header: 'Intents', render: (a: Agent) => <span className="font-mono">{a.intentsProcessed}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Agent Builder</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage and interact with registered agents</p>
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
      </div>

      {/* Agents Table */}
      <DataTable columns={columns} data={agents} emptyMessage="No agents registered" />
    </div>
  );
}
