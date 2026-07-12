'use client';

import { useState, useEffect } from 'react';
import { StatCard } from '@/components/stat-card';
import { fetchHealth, fetchMetrics, submitIntent, isGatewayConnected, type Metrics } from '@/lib/api';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics>({ totalTokens: 0, totalRequests: 0, errorRate: 0, avgLatency: 0, activeAgents: 0, pendingTasks: 0, uptime: 0 });
  const [health, setHealth] = useState<{ status: string; running?: boolean }>({ status: 'connecting' });
  const [connected, setConnected] = useState(false);
  const [intentGoal, setIntentGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const h = await fetchHealth();
      setHealth(h);
      setConnected(h.status === 'ok');
      const m = await fetchMetrics();
      setMetrics(m);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmitIntent = async () => {
    if (!intentGoal.trim()) return;
    setSubmitting(true);
    setLastResult(null);
    try {
      const result = await submitIntent(intentGoal);
      setLastResult(`Intent ${result.id} → ${result.status}${result.result?.summary ? ': ' + result.result.summary : ''}`);
      setIntentGoal('');
    } catch (err: any) {
      setLastResult(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Kernova platform overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-sm text-zinc-400">{connected ? 'Gateway connected' : 'Gateway offline'}</span>
        </div>
      </div>

      {!connected && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 text-sm text-amber-300">
          Gateway is not reachable at <code className="font-mono text-xs bg-zinc-800 px-1 py-0.5 rounded">localhost:3000</code>. 
          Start your Kernova app or run <code className="font-mono text-xs bg-zinc-800 px-1 py-0.5 rounded">kernova serve</code> to connect.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <StatCard title="Status" value={connected ? 'Connected' : 'Offline'} icon="◉" trend={connected ? 'up' : 'neutral'} subtitle={connected ? 'All systems nominal' : 'Waiting for gateway'} />
        <StatCard title="Active Agents" value={metrics.activeAgents} icon="⬡" trend="up" subtitle="Registered" />
        <StatCard title="Pending Tasks" value={metrics.pendingTasks} icon="⏳" trend="neutral" subtitle="Active intents" />
        <StatCard title="Total Requests" value={metrics.totalRequests.toLocaleString()} icon="↗" trend="up" subtitle="Since start" />
        <StatCard title="Token Usage" value={`${(metrics.totalTokens / 1000).toFixed(0)}k`} icon="⚙" trend="neutral" subtitle="Consumed" />
        <StatCard title="Avg Latency" value={`${metrics.avgLatency}ms`} icon="⚡" trend="down" subtitle="Response time" />
        <StatCard title="Error Rate" value={`${(metrics.errorRate * 100).toFixed(1)}%`} icon="⚠" trend="down" subtitle="Current" />
        <StatCard title="Uptime" value={`${Math.floor(metrics.uptime / 3600)}h ${Math.floor((metrics.uptime % 3600) / 60)}m`} icon="△" trend="up" subtitle="Process uptime" />
      </div>

      {/* Quick Actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Submit Intent</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={intentGoal}
            onChange={(e) => setIntentGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitIntent()}
            placeholder="Describe what you want the agent to do..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500"
            disabled={!connected || submitting}
          />
          <button
            onClick={handleSubmitIntent}
            disabled={!connected || submitting}
            className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-md font-medium transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
        {lastResult && (
          <p className="mt-2 text-xs text-zinc-400 font-mono">{lastResult}</p>
        )}
      </div>
    </div>
  );
}
