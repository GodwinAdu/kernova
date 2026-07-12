'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchIdentities, fetchApiKeys, type Identity, type ApiKey } from '@/lib/api';

export default function PermissionsPage() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  useEffect(() => {
    const load = async () => {
      const ids = await fetchIdentities();
      setIdentities(ids.identities);
      const keys = await fetchApiKeys();
      setApiKeys(keys.keys);
    };
    load();
  }, []);

  const identityColumns = [
    { key: 'name', header: 'Identity', render: (i: Identity) => <span className="font-medium text-white">{i.name}</span> },
    { key: 'type', header: 'Type', render: (i: Identity) => (
      <span className={`text-xs px-2 py-0.5 rounded ${
        i.type === 'user' ? 'bg-blue-500/20 text-blue-400' :
        i.type === 'agent' ? 'bg-emerald-500/20 text-emerald-400' :
        'bg-zinc-500/20 text-zinc-400'
      }`}>{i.type}</span>
    )},
    { key: 'roles', header: 'Roles', render: (i: Identity) => <span className="text-xs text-zinc-500">{i.roles.join(', ')}</span> },
    { key: 'lastActive', header: 'Last Active', render: (i: Identity) => <span className="text-xs text-zinc-500">{new Date(i.lastActive).toLocaleString()}</span> },
  ];

  const keyColumns = [
    { key: 'name', header: 'Key Name', render: (k: ApiKey) => <span className="font-medium text-white">{k.name}</span> },
    { key: 'prefix', header: 'Key', render: (k: ApiKey) => <span className="font-mono text-xs text-zinc-500">{k.prefix}</span> },
    { key: 'lastUsed', header: 'Last Used', render: (k: ApiKey) => <span className="text-xs text-zinc-500">{new Date(k.lastUsed).toLocaleString()}</span> },
    { key: 'createdAt', header: 'Created', render: (k: ApiKey) => <span className="text-xs text-zinc-500">{new Date(k.createdAt).toLocaleDateString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Permissions Management</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Identities, roles, and API keys</p>
      </div>

      {/* Identities */}
      <div>
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Identities</h2>
        <DataTable columns={identityColumns} data={identities} emptyMessage="No identities registered. Use kernel.identity.register() to add identities." />
      </div>

      {/* API Keys */}
      <div>
        <h2 className="text-sm font-medium text-zinc-400 mb-3">API Keys</h2>
        <DataTable columns={keyColumns} data={apiKeys} emptyMessage="No API keys configured. Set auth.tokens in your Gateway config." />
      </div>
    </div>
  );
}
