'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchPlugins, installPlugin, type Plugin } from '@/lib/api';

const mockPlugins: Plugin[] = [
  { id: 'pl-001', name: '@kernova/github', version: '1.2.0', status: 'installed', description: 'GitHub integration for code operations', author: 'Kernova Team' },
  { id: 'pl-002', name: '@kernova/slack', version: '0.9.1', status: 'installed', description: 'Slack notifications and commands', author: 'Kernova Team' },
  { id: 'pl-003', name: '@kernova/jira', version: '1.0.3', status: 'disabled', description: 'Jira ticket management integration', author: 'Community' },
  { id: 'pl-004', name: '@kernova/postgres', version: '2.1.0', status: 'available', description: 'PostgreSQL database tools', author: 'Community' },
  { id: 'pl-005', name: '@kernova/web-scraper', version: '0.5.0', status: 'available', description: 'Web scraping and data extraction', author: 'Community' },
];

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>(mockPlugins);

  useEffect(() => {
    fetchPlugins().then((r) => setPlugins(r.plugins)).catch(() => {});
  }, []);

  const handleInstall = async (name: string) => {
    await installPlugin(name).catch(() => {});
    setPlugins((prev) => prev.map((p) => p.name === name ? { ...p, status: 'installed' as const } : p));
  };

  const columns = [
    { key: 'name', header: 'Plugin', render: (p: Plugin) => (
      <div>
        <span className="font-medium text-white">{p.name}</span>
        <p className="text-xs text-zinc-500 mt-0.5">{p.description}</p>
      </div>
    )},
    { key: 'version', header: 'Version', render: (p: Plugin) => <span className="font-mono text-xs">{p.version}</span> },
    { key: 'author', header: 'Author' },
    { key: 'status', header: 'Status', render: (p: Plugin) => <span className={`badge badge-${p.status === 'installed' ? 'active' : p.status === 'disabled' ? 'warn' : 'idle'}`}>{p.status}</span> },
    { key: 'actions', header: '', render: (p: Plugin) => p.status === 'available' ? (
      <button onClick={() => handleInstall(p.name)} className="text-xs text-kernova-400 hover:text-kernova-300 font-medium">Install</button>
    ) : p.status === 'disabled' ? (
      <button className="text-xs text-zinc-500 hover:text-white font-medium">Enable</button>
    ) : null },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Plugin Manager</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Install and configure platform plugins</p>
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

      <DataTable columns={columns} data={plugins} emptyMessage="No plugins found" />
    </div>
  );
}
