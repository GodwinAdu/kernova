'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchWorkflows, type Workflow } from '@/lib/api';

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  useEffect(() => {
    const load = async () => {
      const data = await fetchWorkflows();
      setWorkflows(data.workflows);
    };
    load();
  }, []);

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
      <div>
        <h1 className="text-2xl font-bold text-white">Workflow Designer</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Registered workflows</p>
      </div>

      <DataTable columns={columns} data={workflows} emptyMessage="No workflows defined. Use kernel.workflows.define() to create workflows." />
    </div>
  );
}
