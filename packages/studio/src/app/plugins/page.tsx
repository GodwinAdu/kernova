'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchPlugins, type Plugin } from '@/lib/api';

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  useEffect(() => {
    const load = async () => {
      const data = await fetchPlugins();
      setPlugins(data.plugins);
    };
    load();
  }, []);

  const columns = [
    { key: 'name', header: 'Plugin', render: (p: Plugin) => (
      <div>
        <span className="font-medium text-white">{p.name}</span>
        <p className="text-xs text-zinc-500 mt-0.5">{p.description}</p>
      </div>
    )},
    { key: 'version', header: 'Version', render: (p: Plugin) => <span className="font-mono text-xs">{p.version}</span> },
    { key: 'author', header: 'Author' },
    { key: 'status', header: 'Status', render: (p: Plugin) => (
      <span className={`text-xs ${p.status === 'installed' ? 'text-emerald-400' : p.status === 'disabled' ? 'text-amber-400' : 'text-zinc-400'}`}>
        ● {p.status}
      </span>
    )},
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Plugin Manager</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Installed plugins and tools</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold text-white">{plugins.filter((p) => p.status === 'installed').length}</p>
          <p className="text-xs text-zinc-500">Installed</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold text-white">{plugins.filter((p) => p.status === 'available').length}</p>
          <p className="text-xs text-zinc-500">Available</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold text-white">{plugins.filter((p) => p.status === 'disabled').length}</p>
          <p className="text-xs text-zinc-500">Disabled</p>
        </div>
      </div>

      <DataTable columns={columns} data={plugins} emptyMessage="No plugins registered. Use kernel.plugins.register() to add plugins." />
    </div>
  );
}
