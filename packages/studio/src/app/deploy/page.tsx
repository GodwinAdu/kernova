'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchDeployments, type Deployment } from '@/lib/api';

export default function DeployPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  useEffect(() => {
    const load = async () => {
      const data = await fetchDeployments();
      setDeployments(data.deployments);
    };
    load();
  }, []);

  const columns = [
    { key: 'environment', header: 'Environment', render: (d: Deployment) => <span className="font-medium text-white capitalize">{d.environment}</span> },
    { key: 'version', header: 'Version', render: (d: Deployment) => <span className="font-mono text-xs">{d.version}</span> },
    { key: 'status', header: 'Status', render: (d: Deployment) => (
      <span className={`text-xs ${d.status === 'running' ? 'text-emerald-400' : d.status === 'failed' ? 'text-red-400' : 'text-zinc-400'}`}>
        ● {d.status}
      </span>
    )},
    { key: 'timestamp', header: 'Started', render: (d: Deployment) => <span className="text-xs text-zinc-500">{new Date(d.timestamp).toLocaleString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Deployment Console</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Running Kernova instances</p>
      </div>

      <DataTable columns={columns} data={deployments} emptyMessage="No active deployments." />
    </div>
  );
}
