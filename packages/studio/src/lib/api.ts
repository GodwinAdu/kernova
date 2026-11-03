/**
 * Kernova Studio API Client
 * 
 * Connects to the Kernova Gateway API for real-time data.
 * Falls back gracefully when Gateway is unavailable.
 */

declare global {
  interface Window {
    /** Set by `kernova studio` when it serves the static export: the path of its gateway proxy */
    __KERNOVA_GATEWAY__?: string;
  }
}

const API_URL =
  (typeof window !== 'undefined' && window.__KERNOVA_GATEWAY__) ||
  process.env.NEXT_PUBLIC_KERNOVA_URL ||
  'http://localhost:3000';

/** Through `kernova studio`'s proxy (a relative path), which adds the gateway token itself */
const VIA_PROXY = API_URL.startsWith('/');

/** For `npm run dev` against a gateway directly (exposes the token to the browser: local use only) */
const DEV_TOKEN = process.env.NEXT_PUBLIC_KERNOVA_TOKEN;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(VIA_PROXY ? { 'X-Kernova-Studio': '1' } : DEV_TOKEN ? { Authorization: `Bearer ${DEV_TOKEN}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Safe request wrapper — returns null instead of throwing on failure.
 * This allows the UI to show empty states when Gateway is offline.
 */
async function safeRequest<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    return await request<T>(path, options);
  } catch {
    return null;
  }
}

// ─── Health & Status ─────────────────────────────────────────

export async function fetchHealth() {
  const data = await safeRequest<{ status: string; running?: boolean; agents?: number; activeIntents?: number }>('/health');
  return data || { status: 'offline', running: false, agents: 0, activeIntents: 0 };
}

export async function isGatewayConnected(): Promise<boolean> {
  const health = await fetchHealth();
  return health.status === 'ok';
}

// ─── Agents ─────────────────────────────────────────────────

export async function fetchAgents() {
  const data = await safeRequest<{ agents: Agent[] }>('/v1/agents');
  return data || { agents: [] };
}

export async function fetchAgent(id: string) {
  return request<Agent>(`/v1/agents/${id}`);
}

export async function createAgent(data: Partial<Agent>) {
  return request<Agent>('/v1/agents', { method: 'POST', body: JSON.stringify(data) });
}

// ─── Intents ────────────────────────────────────────────────

export async function submitIntent(goal: string, agentId?: string) {
  return request<{ id: string; status: string; result?: any }>('/v1/intents', {
    method: 'POST',
    body: JSON.stringify({ goal, agentId }),
  });
}

// ─── Events ─────────────────────────────────────────────────

export async function fetchEvents(params?: { category?: string; severity?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.severity) query.set('severity', params.severity);
  if (params?.limit) query.set('limit', String(params.limit));
  const data = await safeRequest<{ events: KernovaEvent[] }>(`/v1/events?${query}`);
  return data || { events: [] };
}

// ─── Memory ─────────────────────────────────────────────────

export async function searchMemory(query: string, layer?: string) {
  const data = await safeRequest<{ results: MemoryEntry[] }>('/v1/memory/search', {
    method: 'POST',
    body: JSON.stringify({ query, layer }),
  });
  return data || { results: [] };
}

// ─── Metrics ────────────────────────────────────────────────

export async function fetchMetrics() {
  const data = await safeRequest<Metrics>('/v1/metrics');
  return data || { totalTokens: 0, totalRequests: 0, errorRate: 0, avgLatency: 0, activeAgents: 0, pendingTasks: 0, uptime: 0 };
}

// ─── Workflows ──────────────────────────────────────────────

export async function fetchWorkflows() {
  const data = await safeRequest<{ workflows: Workflow[] }>('/v1/workflows');
  return data || { workflows: [] };
}

export async function createWorkflow(data: { name: string; description?: string; steps?: { name: string; type?: string }[] }) {
  return request<{ id: string; name: string; steps: number; status: string }>('/v1/workflows', { method: 'POST', body: JSON.stringify(data) });
}

// ─── Plugins ────────────────────────────────────────────────

export async function fetchPlugins() {
  const data = await safeRequest<{ plugins: Plugin[] }>('/v1/plugins');
  return data || { plugins: [] };
}

export async function installPlugin(name: string) {
  return request<Plugin>('/v1/plugins/install', { method: 'POST', body: JSON.stringify({ name }) });
}

// ─── Permissions ────────────────────────────────────────────

export async function fetchIdentities() {
  const data = await safeRequest<{ identities: Identity[] }>('/v1/permissions/identities');
  return data || { identities: [] };
}

export async function createIdentity(data: { name: string; type: 'user' | 'agent' | 'service'; roles?: string[] }) {
  return request<Identity>('/v1/permissions/identities', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchApiKeys() {
  const data = await safeRequest<{ keys: ApiKey[] }>('/v1/permissions/keys');
  return data || { keys: [] };
}

export async function createApiKey(data: { name: string; ownerId: string; permissions?: string[] }) {
  return request<{ id: string; name: string; key: string; prefix: string; createdAt: string }>('/v1/permissions/keys', { method: 'POST', body: JSON.stringify(data) });
}

export async function revokeApiKey(keyId: string) {
  return request<{ ok: boolean }>(`/v1/permissions/keys/${keyId}`, { method: 'DELETE' });
}

// ─── Logs ───────────────────────────────────────────────────

export async function fetchLogs(params?: { level?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.level) query.set('level', params.level);
  if (params?.limit) query.set('limit', String(params.limit));
  const data = await safeRequest<{ logs: LogEntry[] }>(`/v1/logs?${query}`);
  return data || { logs: [] };
}

// ─── Deployments ────────────────────────────────────────────

export async function fetchDeployments() {
  const data = await safeRequest<{ deployments: Deployment[] }>('/v1/deployments');
  return data || { deployments: [] };
}

export async function restartDeployment(deploymentId: string) {
  return request<{ ok: boolean; message: string }>(`/v1/deployments/${deploymentId}/restart`, { method: 'POST' });
}

// ─── Context ────────────────────────────────────────────────

export async function fetchContext(intentId: string) {
  const data = await safeRequest<ContextResult>(`/v1/context/${intentId}`);
  return data || { intentId, layers: [], totalTokens: 0, computedAt: new Date().toISOString() };
}

// ─── Types ──────────────────────────────────────────────────

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
