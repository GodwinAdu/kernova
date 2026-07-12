'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchIdentities, fetchApiKeys, type Identity, type ApiKey } from '@/lib/api';

const mockIdentities: Identity[] = [
  { id: 'id-001', name: 'admin@kernova.dev', type: 'user', roles: ['admin', 'developer'], lastActive: '2024-01-20T15:30:00Z' },
  { id: 'id-002', name: 'Planner Agent', type: 'agent', roles: ['agent', 'planner'], lastActive: '2024-01-20T15:25:00Z' },
  { id: 'id-003', name: 'Coder Agent', type: 'agent', roles: ['agent', 'coder'], lastActive: '2024-01-20T15:30:00Z' },
  { id: 'id-004', name: 'CI/CD Service', type: 'service', roles: ['service', 'deployer'], lastActive: '2024-01-20T12:00:00Z' },
  { id: 'id-005', name: 'dev@kernova.dev', type: 'user', roles: ['developer'], lastActive: '2024-01-19T18:00:00Z' },
];

const mockApiKeys: ApiKey[] = [
  { id: 'key-001', name: 'Production API Key', prefix: 'kn_prod_****...a8f2', lastUsed: '2024-01-20T15:30:00Z', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'key-002', name: 'Development Key', prefix: 'kn_dev_****...c3d1', lastUsed: '2024-01-20T14:00:00Z', createdAt: '2024-01-10T00:00:00Z' },
  { id: 'key-003', name: 'CI Pipeline', prefix: 'kn_ci_****...b7e4', lastUsed: '2024-01-20T12:00:00Z', createdAt: '2024-01-15T00:00:00Z' },
];

export default function PermissionsPage() {
  const [identities, setIdentities] = useState<Identity[]>(mockIdentities);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(mockApiKeys);

  useEffect(() => {
    fetchIdentities().then((r) => setIdentities(r.identities)).catch(() => {});
    fetchApiKeys().then((r) => setApiKeys(r.keys)).catch(() => {});
  }, []);

  const identityColumns = [
    { key: 'name', header: 'Identity', render: (i: Identity) => <span className="font-medium text-white">{i.name}</span> },
    { key: 'type', header: 'Type', render: (i: Identity) => <span className={`badge badge-${i.type === 'user' ? 'info' : i.type === 'agent' ? 'active' : 'idle'}`}>{i.type}</span> },
    { key: 'roles', header: 'Roles', render: (i: Identity) => <span className="text-xs text-zinc-500">{i.roles.join(', ')}</span> },
    { key: 'lastActive', header: 'Last Active', render: (i: Identity) => <span className="text-xs text-zinc-500">{new Date(i.lastActive).toLocaleString()}</span> },
  ];

  const keyColumns = [
    { key: 'name', header: 'Key Name', render: (k: ApiKey) => <span className="font-medium text-white">{k.name}</span> },
    { key: 'prefix', header: 'Key', render: (k: ApiKey) => <span className="font-mono text-xs text-zinc-500">{k.prefix}</span> },
    { key: 'lastUsed', header: 'Last Used', render: (k: ApiKey) => <span className="text-xs text-zinc-500">{new Date(k.lastUsed).toLocaleString()}</span> },
    { key: 'createdAt', header: 'Created', render: (k: ApiKey) => <span className="text-xs text-zinc-500">{new Date(k.createdAt).toLocaleDateString()}</span> },
    { key: 'actions', header: '', render: () => <button className="text-xs text-red-400 hover:text-red-300">Revoke</button> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Permissions Management</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage identities, roles, and API keys</p>
      </div>

      {/* Identities */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-400">Identities</h2>
          <button className="text-xs text-kernova-400 hover:text-kernova-300 font-medium">+ Add Identity</button>
        </div>
        <DataTable columns={identityColumns} data={identities} emptyMessage="No identities" />
      </div>

      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-400">API Keys</h2>
          <button className="text-xs text-kernova-400 hover:text-kernova-300 font-medium">+ Generate Key</button>
        </div>
        <DataTable columns={keyColumns} data={apiKeys} emptyMessage="No API keys" />
      </div>
    </div>
  );
}
