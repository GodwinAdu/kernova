'use client';

import { useState, useEffect } from 'react';
import { DataTable } from '@/components/data-table';
import { fetchIdentities, fetchApiKeys, createIdentity, createApiKey, revokeApiKey, type Identity, type ApiKey } from '@/lib/api';

export default function PermissionsPage() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showAddIdentity, setShowAddIdentity] = useState(false);
  const [showGenKey, setShowGenKey] = useState(false);
  const [newKeyRevealed, setNewKeyRevealed] = useState<string | null>(null);

  // Identity form
  const [idName, setIdName] = useState('');
  const [idType, setIdType] = useState<'user' | 'agent' | 'service'>('user');
  const [idRoles, setIdRoles] = useState('');

  // Key form
  const [keyName, setKeyName] = useState('');
  const [keyOwner, setKeyOwner] = useState('');

  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const ids = await fetchIdentities();
    setIdentities(ids.identities);
    const keys = await fetchApiKeys();
    setApiKeys(keys.keys);
  };

  useEffect(() => { load(); }, []);

  const handleCreateIdentity = async () => {
    if (!idName.trim()) return;
    setError(null);
    try {
      await createIdentity({
        name: idName,
        type: idType,
        roles: idRoles.split(',').map(r => r.trim()).filter(Boolean),
      });
      setIdName('');
      setIdRoles('');
      setShowAddIdentity(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGenerateKey = async () => {
    if (!keyName.trim() || !keyOwner.trim()) return;
    setError(null);
    try {
      const result = await createApiKey({ name: keyName, ownerId: keyOwner });
      setNewKeyRevealed(result.key);
      setKeyName('');
      setKeyOwner('');
      setShowGenKey(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
    try {
      await revokeApiKey(keyId);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const identityColumns = [
    { key: 'name', header: 'Identity', render: (i: Identity) => <span className="font-medium text-white">{i.name}</span> },
    { key: 'type', header: 'Type', render: (i: Identity) => (
      <span className={`text-xs px-2 py-0.5 rounded ${
        i.type === 'user' ? 'bg-blue-500/20 text-blue-400' :
        i.type === 'agent' ? 'bg-emerald-500/20 text-emerald-400' :
        'bg-zinc-500/20 text-zinc-400'
      }`}>{i.type}</span>
    )},
    { key: 'roles', header: 'Roles', render: (i: Identity) => <span className="text-xs text-zinc-500">{(i.roles || []).join(', ') || '—'}</span> },
    { key: 'lastActive', header: 'Last Active', render: (i: Identity) => <span className="text-xs text-zinc-500">{new Date(i.lastActive).toLocaleString()}</span> },
  ];

  const keyColumns = [
    { key: 'name', header: 'Key Name', render: (k: ApiKey) => <span className="font-medium text-white">{k.name}</span> },
    { key: 'prefix', header: 'Key', render: (k: ApiKey) => <span className="font-mono text-xs text-zinc-500">{k.prefix}</span> },
    { key: 'lastUsed', header: 'Last Used', render: (k: ApiKey) => <span className="text-xs text-zinc-500">{new Date(k.lastUsed).toLocaleString()}</span> },
    { key: 'createdAt', header: 'Created', render: (k: ApiKey) => <span className="text-xs text-zinc-500">{new Date(k.createdAt).toLocaleDateString()}</span> },
    { key: 'actions', header: '', render: (k: ApiKey) => (
      <button onClick={() => handleRevoke(k.id)} className="text-xs text-red-400 hover:text-red-300 font-medium">Revoke</button>
    )},
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Permissions Management</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Identities, roles, and API keys</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">{error}</div>
      )}

      {/* New Key Revealed */}
      {newKeyRevealed && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
          <p className="text-sm text-emerald-400 font-medium mb-2">API Key Generated — copy it now, it won't be shown again!</p>
          <code className="block bg-zinc-900 rounded px-3 py-2 font-mono text-sm text-white break-all">{newKeyRevealed}</code>
          <button onClick={() => { navigator.clipboard.writeText(newKeyRevealed); setNewKeyRevealed(null); }} className="mt-2 text-xs text-kernova-400 hover:text-kernova-300 font-medium">Copy & Dismiss</button>
        </div>
      )}

      {/* Identities */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-400">Identities</h2>
          <button onClick={() => setShowAddIdentity(!showAddIdentity)} className="text-xs text-kernova-400 hover:text-kernova-300 font-medium">+ Add Identity</button>
        </div>

        {showAddIdentity && (
          <div className="glass-card rounded-xl p-4 mb-4 space-y-3">
            <input type="text" value={idName} onChange={(e) => setIdName(e.target.value)} placeholder="Name (e.g. user@example.com)..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500" />
            <div className="flex gap-3">
              <select value={idType} onChange={(e) => setIdType(e.target.value as any)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500">
                <option value="user">User</option>
                <option value="agent">Agent</option>
                <option value="service">Service</option>
              </select>
              <input type="text" value={idRoles} onChange={(e) => setIdRoles(e.target.value)} placeholder="Roles (comma-separated)..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateIdentity} disabled={!idName.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium">Create</button>
              <button onClick={() => setShowAddIdentity(false)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg font-medium">Cancel</button>
            </div>
          </div>
        )}

        <DataTable columns={identityColumns} data={identities} emptyMessage="No identities registered." />
      </div>

      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-400">API Keys</h2>
          <button onClick={() => setShowGenKey(!showGenKey)} className="text-xs text-kernova-400 hover:text-kernova-300 font-medium">+ Generate Key</button>
        </div>

        {showGenKey && (
          <div className="glass-card rounded-xl p-4 mb-4 space-y-3">
            <input type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name (e.g. Production API)..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500" />
            <select value={keyOwner} onChange={(e) => setKeyOwner(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-kernova-500">
              <option value="">Select owner identity...</option>
              {identities.map(i => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={handleGenerateKey} disabled={!keyName.trim() || !keyOwner} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium">Generate</button>
              <button onClick={() => setShowGenKey(false)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg font-medium">Cancel</button>
            </div>
          </div>
        )}

        <DataTable columns={keyColumns} data={apiKeys} emptyMessage="No API keys configured." />
      </div>
    </div>
  );
}
