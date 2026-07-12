'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchDeployments, type Deployment } from '@/lib/api';

const mockDeployments: Deployment[] = [
  { id: 'dep-001', environment: 'production', status: 'running', version: 'v0.8.2', timestamp: '2024-01-20T12:00:00Z' },
  { id: 'dep-002', environment: 'staging', status: 'running', version: 'v0.9.0-rc1', timestamp: '2024-01-20T15:00:00Z' },
  { id: 'dep-003', environment: 'development', status: 'running', version: 'v0.9.0-dev', timestamp: '2024-01-20T15:30:00Z' },
  { id: 'dep-004', environment: 'production', status: 'failed', version: 'v0.8.3', timestamp: '2024-01-19T18:00:00Z' },
];

export default function DeployPage() {
  const [deployments, setDeployments] = useState<Deployment[]>(mockDeployments);

  useEffect(() => {
    fetchDeployments().then((r) => setDeployments(r.deployments)).catch(() => {});
  }, []);

  const columns = [
    { key: 'environment', header: 'Environment', render: (d: Deployment) => <span className="font-medium text-white">{d.environment}</span> },
    { key: 'version', header: 'Version', render: (d: Deployment) => <span className="font-mono text-xs">{d.version}</span> },
    { key: 'status', header: 'Status', render: (d: Deployment) => (
      <span className={`badge badge-${d.status === 'running' ? 'active' : d.status === 'deploying' ? 'info' : d.status === 'failed' ? 'error' : 'idle'}`}>
        {d.status}
      </span>
    )},
    { key: 'timestamp', header: 'Deployed', render: (d: Deployment) => <span className="text-xs text-zinc-500">{new Date(d.timestamp).toLocaleString()}</span> },
    { key: 'actions', header: '', render: (d: Deployment) => (
      <div className="flex gap-2">
        {d.status === 'running' && <button className="text-xs text-amber-400 hover:text-amber-300">Restart</button>}
        {d.status === 'failed' && <button className="text-xs text-kernova-400 hover:text-kernova-300">Retry</button>}
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Deployment Console</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Manage deployments across environments</p>
        </div>
        <button className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-md font-medium transition-colors">
          + New Deploy
        </button>
      </div>

      {/* Environment Status */}
      <div className="grid grid-cols-3 gap-4">
        {['production', 'staging', 'development'].map((env) => {
          const dep = deployments.find((d) => d.environment === env && d.status === 'running');
          return (
            <div key={env} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white capitalize">{env}</span>
                <span className={`w-2.5 h-2.5 rounded-full ${dep ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
              </div>
              <p className="text-xs text-zinc-500 mt-1 font-mono">{dep?.version ?? 'Not deployed'}</p>
            </div>
          );
        })}
      </div>

      <DataTable columns={columns} data={deployments} emptyMessage="No deployments" />
    </div>
  );
}
