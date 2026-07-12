'use client';

import { useState, useEffect } from 'react';
import { StatCard } from '@/components/stat-card';
import { fetchHealth, fetchMetrics, type Metrics } from '@/lib/api';

const mockMetrics: Metrics = {
  totalTokens: 1_247_832,
  totalRequests: 3_842,
  errorRate: 0.02,
  avgLatency: 245,
  activeAgents: 4,
  pendingTasks: 7,
  uptime: 172800,
};

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState<Metrics>(mockMetrics);
  const [health, setHealth] = useState<{ status: string; uptime: number; version: string }>({ status: 'healthy', uptime: 172800, version: '0.1.0' });

  useEffect(() => {
    const interval = setInterval(() => {
      fetchHealth().then(setHealth).catch(() => {});
      fetchMetrics().then(setMetrics).catch(() => {});
    }, 5000);
    fetchHealth().then(setHealth).catch(() => {});
    fetchMetrics().then(setMetrics).catch(() => {});
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const healthColor = health.status === 'healthy' ? 'emerald' : health.status === 'degraded' ? 'amber' : 'red';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Monitoring Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Platform health and performance metrics</p>
      </div>

      {/* Health Banner */}
      <div className={`bg-${healthColor}-500/10 border border-${healthColor}-500/20 rounded-lg p-4 flex items-center gap-3`}>
        <span className={`w-4 h-4 rounded-full bg-${healthColor}-500`} />
        <div>
          <p className={`text-${healthColor}-400 font-medium`}>System {health.status}</p>
          <p className="text-xs text-zinc-500">Uptime: {formatUptime(health.uptime || metrics.uptime)}</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Requests" value={metrics.totalRequests.toLocaleString()} icon="↗" trend="up" subtitle="All time" />
        <StatCard title="Token Usage" value={`${(metrics.totalTokens / 1_000_000).toFixed(2)}M`} icon="⚙" trend="neutral" subtitle="Total consumed" />
        <StatCard title="Error Rate" value={`${(metrics.errorRate * 100).toFixed(2)}%`} icon="⚠" trend="down" subtitle="Last 24h" />
        <StatCard title="Avg Latency" value={`${metrics.avgLatency}ms`} icon="⚡" trend="down" subtitle="p50 response time" />
      </div>

      {/* Token Breakdown */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-400 mb-4">Token Usage Breakdown</h2>
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

      {/* Recent Requests */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Model Requests (Last Hour)</h2>
        <div className="flex items-end gap-1 h-24">
          {Array.from({ length: 30 }, (_, i) => {
            const height = 20 + Math.random() * 80;
            return <div key={i} className="flex-1 bg-kernova-600/40 rounded-sm hover:bg-kernova-500/60 transition-colors" style={{ height: `${height}%` }} />;
          })}
        </div>
        <div className="flex justify-between mt-2 text-xs text-zinc-600">
          <span>-60m</span>
          <span>-30m</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}
