const API_URL = process.env.NEXT_PUBLIC_KERNOVA_URL || 'http://localhost:3000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// Health & Status
export async function fetchHealth() {
  return request<{ status: string; uptime: number; version: string }>('/health');
}

// Agents
export async function fetchAgents() {
  return request<{ agents: Agent[] }>('/v1/agents');
}

export async function fetchAgent(id: string) {
  return request<Agent>(`/v1/agents/${id}`);
}

export async function createAgent(data: Partial<Agent>) {
  return request<Agent>('/v1/agents', { method: 'POST', body: JSON.stringify(data) });
}

// Intents
export async function submitIntent(goal: string, agentId?: string) {
  return request<{ id: string; status: string }>('/v1/intents', {
    method: 'POST',
    body: JSON.stringify({ goal, agentId }),
  });
}

// Events
export async function fetchEvents(params?: { category?: string; severity?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.severity) query.set('severity', params.severity);
  if (params?.limit) query.set('limit', String(params.limit));
  return request<{ events: KernovaEvent[] }>(`/v1/events?${query}`);
}

// Memory
export async function searchMemory(query: string, layer?: string) {
  return request<{ results: MemoryEntry[] }>('/v1/memory/search', {
    method: 'POST',
    body: JSON.stringify({ query, layer }),
  });
}

// Metrics
export async function fetchMetrics() {
  return request<Metrics>('/v1/metrics');
}

// Workflows
export async function fetchWorkflows() {
  return request<{ workflows: Workflow[] }>('/v1/workflows');
}

export async function createWorkflow(data: Partial<Workflow>) {
  return request<Workflow>('/v1/workflows', { method: 'POST', body: JSON.stringify(data) });
}

// Plugins
export async function fetchPlugins() {
  return request<{ plugins: Plugin[] }>('/v1/plugins');
}

export async function installPlugin(name: string) {
  return request<Plugin>('/v1/plugins/install', { method: 'POST', body: JSON.stringify({ name }) });
}

// Permissions
export async function fetchIdentities() {
  return request<{ identities: Identity[] }>('/v1/permissions/identities');
}

export async function fetchApiKeys() {
  return request<{ keys: ApiKey[] }>('/v1/permissions/keys');
}

// Logs
export async function fetchLogs(params?: { level?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.level) query.set('level', params.level);
  if (params?.limit) query.set('limit', String(params.limit));
  return request<{ logs: LogEntry[] }>(`/v1/logs?${query}`);
}

// Deploy
export async function fetchDeployments() {
  return request<{ deployments: Deployment[] }>('/v1/deployments');
}

// Context
export async function fetchContext(intentId: string) {
  return request<ContextResult>(`/v1/context/${intentId}`);
}

// Types
export interface Agent {
  id: string;
  name: string;
  capabilities: string[];
  status: 'active' | 'idle' | 'error';
  model: string;
  intentsProcessed: number;
  createdAt: string;
}

export interface KernovaEvent {
  id: string;
  type: string;
  category: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  layer: 'working' | 'session' | 'longterm' | 'organizational' | 'global';
  tags: string[];
  relevance: number;
  timestamp: string;
}

export interface Metrics {
  totalTokens: number;
  totalRequests: number;
  errorRate: number;
  avgLatency: number;
  activeAgents: number;
  pendingTasks: number;
  uptime: number;
}

export interface Workflow {
  id: string;
  name: string;
  steps: number;
  status: 'active' | 'draft' | 'paused';
  lastRun: string;
  createdAt: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  status: 'installed' | 'available' | 'disabled';
  description: string;
  author: string;
}

export interface Identity {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'service';
  roles: string[];
  lastActive: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsed: string;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source: string;
  traceId?: string;
  timestamp: string;
}

export interface Deployment {
  id: string;
  environment: string;
  status: 'running' | 'deploying' | 'failed' | 'stopped';
  version: string;
  timestamp: string;
}

export interface ContextResult {
  intentId: string;
  layers: { name: string; entries: number; tokens: number }[];
  totalTokens: number;
  computedAt: string;
}
