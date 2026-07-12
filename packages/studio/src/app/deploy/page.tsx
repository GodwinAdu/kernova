'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchDeployments, restartDeployment, type Deployment } from '@/lib/api';

export default function DeployPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const data = await fetchDeployments();
    setDeployments(data.deployments);
  };

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, []);

  const handleRestart = async (id: string) => {
    setRestarting(id);
    setMessage(null);
    try {
      const result = await restartDeployment(id);
      setMessage(result.message || 'Restart signal sent');
      await load();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setRestarting(null);
    }
  };

  const columns = [
    { key: 'environment', header: 'Environment', render: (d: Deployment) => <span className="font-medium text-white capitalize">{d.environment}</span> },
    { key: 'version', header: 'Version', render: (d: Deployment) => <span className="font-mono text-xs text-zinc-400">{d.version}</span> },
    { key: 'status', header: 'Status', render: (d: Deployment) => (
      <span className={`text-xs ${d.status === 'running' ? 'text-emerald-400' : d.status === 'failed' ? 'text-red-400' : 'text-zinc-400'}`}>
        ● {d.status}
      </span>
    )},
    { key: 'timestamp', header: 'Started', render: (d: Deployment) => <span className="text-xs text-zinc-500">{new Date(d.timestamp).toLocaleString()}</span> },
    { key: 'actions', header: '', render: (d: Deployment) => (
      <div className="flex gap-2">
        {d.status === 'running' && (
          <button
            onClick={() => handleRestart(d.id)}
            disabled={restarting === d.id}
            className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 font-medium"
          >
            {restarting === d.id ? 'Restarting...' : 'Restart'}
          </button>
        )}
        {d.status === 'failed' && (
          <button
            onClick={() => handleRestart(d.id)}
            disabled={restarting === d.id}
            className="text-xs text-kernova-400 hover:text-kernova-300 disabled:opacity-50 font-medium"
          >
            {restarting === d.id ? 'Retrying...' : 'Retry'}
          </button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Deployment Console</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Running Kernova instances</p>
      </div>

      {message && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm text-blue-300">{message}</div>
      )}

      <DataTable columns={columns} data={deployments} emptyMessage="No active deployments." />
    </div>
  );
}
