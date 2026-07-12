'use client';

import { useState, useEffect } from 'react';
import { StatCard } from '@/components/stat-card';
import { fetchHealth, fetchMetrics, type Metrics } from '@/lib/api';

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState<Metrics>({ totalTokens: 0, totalRequests: 0, errorRate: 0, avgLatency: 0, activeAgents: 0, pendingTasks: 0, uptime: 0 });
  const [health, setHealth] = useState<{ status: string }>({ status: 'connecting' });

  useEffect(() => {
    const load = async () => {
      setHealth(await fetchHealth());
      setMetrics(await fetchMetrics());
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const isHealthy = health.status === 'ok';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Monitoring Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Platform health and performance metrics • Auto-refreshing</p>
      </div>

      {/* Health Banner */}
      <div className={`${isHealthy ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'} border rounded-lg p-4 flex items-center gap-3`}>
        <span className={`w-4 h-4 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <div>
          <p className={`${isHealthy ? 'text-emerald-400' : 'text-red-400'} font-medium`}>System {isHealthy ? 'healthy' : 'offline'}</p>
          <p className="text-xs text-zinc-500">Uptime: {formatUptime(metrics.uptime)}</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Requests" value={metrics.totalRequests.toLocaleString()} icon="↗" trend="up" subtitle="All time" />
        <StatCard title="Token Usage" value={`${(metrics.totalTokens / 1_000_000).toFixed(2)}M`} icon="⚙" trend="neutral" subtitle="Total consumed" />
        <StatCard title="Error Rate" value={`${(metrics.errorRate * 100).toFixed(2)}%`} icon="⚠" trend="down" subtitle="Current" />
        <StatCard title="Avg Latency" value={`${metrics.avgLatency}ms`} icon="⚡" trend="down" subtitle="Response time" />
      </div>

      {/* Token Breakdown */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Token Usage Breakdown (estimated)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-xl font-semibold text-white font-mono">{Math.floor(metrics.totalTokens * 0.6 / 1000)}k</p>
            <p className="text-xs text-zinc-500 mt-1">Input tokens</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold text-white font-mono">{Math.floor(metrics.totalTokens * 0.3 / 1000)}k</p>
            <p className="text-xs text-zinc-500 mt-1">Output tokens</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold text-white font-mono">{Math.floor(metrics.totalTokens * 0.08 / 1000)}k</p>
            <p className="text-xs text-zinc-500 mt-1">Context tokens</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold text-white font-mono">{Math.floor(metrics.totalTokens * 0.02 / 1000)}k</p>
            <p className="text-xs text-zinc-500 mt-1">Tool tokens</p>
          </div>
        </div>
      </div>
    </div>
  );
}
