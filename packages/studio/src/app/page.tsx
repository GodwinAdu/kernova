'use client';

import { useState, useEffect } from 'react';
import { StatCard } from '@/components/stat-card';
import { fetchHealth, fetchMetrics, type Metrics } from '@/lib/api';

// Mock data for initial build
const mockMetrics: Metrics = {
  totalTokens: 1_247_832,
  totalRequests: 3_842,
  errorRate: 0.02,
  avgLatency: 245,
  activeAgents: 4,
  pendingTasks: 7,
  uptime: 86400,
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics>(mockMetrics);
  const [health, setHealth] = useState<{ status: string; version: string }>({ status: 'healthy', version: '0.1.0' });
  const [intentGoal, setIntentGoal] = useState('');

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => {});
    fetchMetrics().then(setMetrics).catch(() => {});
  }, []);

  const handleSubmitIntent = async () => {
    if (!intentGoal.trim()) return;
    // In production: await submitIntent(intentGoal);
    alert(`Intent submitted: ${intentGoal}`);
    setIntentGoal('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Kernova platform overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${health.status === 'healthy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-sm text-zinc-400">{health.status} • v{health.version}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <StatCard title="Status" value={health.status} icon="◉" trend="up" subtitle="All systems nominal" />
        <StatCard title="Active Agents" value={metrics.activeAgents} icon="⬡" trend="up" subtitle="+2 this week" />
        <StatCard title="Pending Tasks" value={metrics.pendingTasks} icon="⏳" trend="neutral" subtitle="Processing" />
        <StatCard title="Total Requests" value={metrics.totalRequests.toLocaleString()} icon="↗" trend="up" subtitle="+12% from yesterday" />
        <StatCard title="Token Usage" value={`${(metrics.totalTokens / 1000).toFixed(0)}k`} icon="⚙" trend="neutral" subtitle="This session" />
        <StatCard title="Avg Latency" value={`${metrics.avgLatency}ms`} icon="⚡" trend="down" subtitle="Improved 8%" />
        <StatCard title="Error Rate" value={`${(metrics.errorRate * 100).toFixed(1)}%`} icon="⚠" trend="down" subtitle="Below threshold" />
        <StatCard title="Uptime" value={`${Math.floor(metrics.uptime / 3600)}h`} icon="△" trend="up" subtitle="Continuous" />
      </div>

      {/* Quick Actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-400 mb-3">Quick Actions</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={intentGoal}
            onChange={(e) => setIntentGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitIntent()}
            placeholder="Submit an intent — describe what you want the agent to do..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-kernova-500"
          />
          <button
            onClick={handleSubmitIntent}
            className="px-4 py-2 bg-kernova-600 hover:bg-kernova-500 text-white text-sm rounded-md font-medium transition-colors"
          >
            Submit Intent
          </button>
        </div>
      </div>
    </div>
  );
}
