'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchWorkflows, type Workflow } from '@/lib/api';

const mockWorkflows: Workflow[] = [
  { id: 'wf-001', name: 'Code Review Pipeline', steps: 5, status: 'active', lastRun: '2024-01-20T15:30:00Z', createdAt: '2024-01-10T10:00:00Z' },
  { id: 'wf-002', name: 'Research & Summarize', steps: 3, status: 'active', lastRun: '2024-01-20T14:00:00Z', createdAt: '2024-01-12T09:00:00Z' },
  { id: 'wf-003', name: 'Deploy Workflow', steps: 7, status: 'draft', lastRun: '', createdAt: '2024-01-19T16:00:00Z' },
  { id: 'wf-004', name: 'Bug Triage', steps: 4, status: 'paused', lastRun: '2024-01-18T11:00:00Z', createdAt: '2024-01-14T08:30:00Z' },
];

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>(mockWorkflows);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchWorkflows().then((r) => setWorkflows(r.workflows)).catch(() => {});
  }, []);

  const columns = [
    { key: 'name', header: 'Workflow', render: (w: Workflow) => <span className="font-medium text-white">{w.name}</span> },
    { key: 'steps', header: 'Steps', render: (w: Workflow) => <span className="font-mono">{w.steps}</span> },
    { key: 'status', header: 'Status', render: (w: Workflow) => <span className={`badge badge-${w.status === 'active' ? 'active' : w.status === 'paused' ? 'warn' : 'idle'}`}>{w.status}</span> },
    { key: 'lastRun', header: 'Last Run', render: (w: Workflow) => <span className="text-xs text-zinc-500">{w.lastRun ? new Date(w.lastRun).toLocaleString() : '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflow Designer</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Create and manage agent workflows</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-md font-medium transition-colors">
          + New Workflow
        </button>
      </div>

      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">Create Workflow</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workflow name..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500"
            />
            <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-md font-medium transition-colors">
              Create
            </button>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={workflows} emptyMessage="No workflows defined" />
    </div>
  );
}
