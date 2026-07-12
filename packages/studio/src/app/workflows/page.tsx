'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchWorkflows, createWorkflow, type Workflow } from '@/lib/api';

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const data = await fetchWorkflows();
    setWorkflows(data.workflows);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createWorkflow({ name: newName, description: newDesc });
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const columns = [
    { key: 'name', header: 'Workflow', render: (w: Workflow) => <span className="font-medium text-white">{w.name}</span> },
    { key: 'steps', header: 'Steps', render: (w: Workflow) => <span className="font-mono">{w.steps}</span> },
    { key: 'status', header: 'Status', render: (w: Workflow) => (
      <span className={`text-xs ${w.status === 'active' ? 'text-emerald-400' : w.status === 'paused' ? 'text-amber-400' : 'text-zinc-400'}`}>
        ● {w.status}
      </span>
    )},
    { key: 'lastRun', header: 'Last Run', render: (w: Workflow) => <span className="text-xs text-zinc-500">{w.lastRun ? new Date(w.lastRun).toLocaleString() : '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflow Designer</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Create and manage agent workflows</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-lg font-medium transition-colors">
          + New Workflow
        </button>
      </div>

      {showCreate && (
        <div className="glass-card rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-medium text-zinc-400">Create Workflow</h2>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Workflow name..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500" />
          <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500" />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors">
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg font-medium transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={workflows} emptyMessage="No workflows defined. Click '+ New Workflow' to create one." />
    </div>
  );
}
