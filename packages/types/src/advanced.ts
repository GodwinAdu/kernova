/**
 * Kernova Advanced Feature Types
 *
 * Type definitions for:
 * - Model Fallback Chains
 * - Tool Availability DSL
 * - Sub-Agent Spawning
 * - Webhook Router
 * - MCP Bridge
 * - Trajectory Recording
 */

import type { KernovaId, Timestamp, Priority } from './base.js';

// ─── Model Fallback ──────────────────────────────────────────

export interface ModelCandidate {
  provider: string;
  model: string;
  priority?: number;
}

export interface FallbackAttempt {
  provider: string;
  model: string;
  error: string;
  reason: FailoverReason;
  timestamp: Timestamp;
  latencyMs?: number;
  statusCode?: number;
}

export type FailoverReason =
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'auth'
  | 'model_not_found'
  | 'context_overflow'
  | 'empty_response'
  | 'billing'
  | 'network'
  | 'unknown';

export interface FallbackChainConfig {
  /** Ordered list of model candidates */
  candidates: ModelCandidate[];
  /** Cooldown duration per candidate after failure (ms) */
  cooldownMs?: number;            // default: 60_000
  /** Maximum attempts before circuit-breaking */
  maxAttempts?: number;           // default: candidates.length
  /** Whether to retry on rate limits with backoff */
  retryOnRateLimit?: boolean;     // default: true
  /** Maximum total timeout across all attempts */
  totalTimeoutMs?: number;        // default: 120_000
}

export interface FallbackResult<T = unknown> {
  success: boolean;
  result?: T;
  usedCandidate: ModelCandidate;
  attempts: FallbackAttempt[];
  totalLatencyMs: number;
}

// ─── Tool Availability DSL ───────────────────────────────────

export type ToolAvailabilitySignal =
  | { kind: 'always' }
  | { kind: 'auth'; providerId: string }
  | { kind: 'config'; path: string[]; check?: 'exists' | 'non-empty' }
  | { kind: 'env'; name: string }
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'context'; key: string; equals?: string | number | boolean | null };

export type ToolAvailabilityExpression =
  | ToolAvailabilitySignal
  | { allOf: ToolAvailabilityExpression[] }
  | { anyOf: ToolAvailabilityExpression[] };

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  availability?: ToolAvailabilityExpression;
  owner?: ToolOwner;
}

export type ToolOwner =
  | { kind: 'core' }
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'mcp'; serverId: string };

export interface ToolAvailabilityContext {
  authProviders?: Set<string>;
  config?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  enabledPlugins?: Set<string>;
  contextValues?: Record<string, unknown>;
}

export interface ToolAvailabilityDiagnostic {
  tool: string;
  reason: 'auth-missing' | 'config-missing' | 'env-missing' | 'plugin-disabled' | 'context-mismatch';
  message: string;
}

export interface ToolPlan {
  visible: ToolDescriptor[];
  hidden: Array<{ descriptor: ToolDescriptor; diagnostics: ToolAvailabilityDiagnostic[] }>;
}

// Tool Policy
export interface ToolPolicy {
  allow?: string[];               // Allowlisted tool names (glob supported)
  deny?: string[];                // Denylisted tool names
}

export interface ToolPolicyLayer {
  name: string;
  policy: ToolPolicy;
}

// ─── Sub-Agent Spawning ──────────────────────────────────────

export type SubAgentSpawnMode = 'run' | 'session';
export type SubAgentContextMode = 'isolated' | 'fork';
export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface SubAgentDef {
  id: KernovaId;
  parentId: KernovaId;
  name: string;
  agentName: string;
  goal: string;
  mode: SubAgentSpawnMode;
  contextMode: SubAgentContextMode;
  status: SubAgentStatus;
  result?: unknown;
  error?: string;
  depth: number;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  timeoutMs?: number;
}

export interface SubAgentSpawnInput {
  agentName: string;
  goal: string;
  mode?: SubAgentSpawnMode;        // default: 'run'
  contextMode?: SubAgentContextMode; // default: 'isolated'
  timeoutMs?: number;              // default: 60_000
  metadata?: Record<string, unknown>;
}

export interface SubAgentManagerConfig {
  maxDepth?: number;               // default: 3
  maxChildrenPerAgent?: number;    // default: 5
  defaultTimeoutMs?: number;       // default: 60_000
}

// ─── Webhook Router ──────────────────────────────────────────

export interface WebhookRoute {
  id: KernovaId;
  path: string;                    // e.g., '/hooks/github'
  method: 'POST' | 'GET' | 'PUT';
  secret?: string;                 // Signature verification secret
  transform?: WebhookTransform;
  target: WebhookTarget;
  enabled: boolean;
  createdAt: Timestamp;
}

export interface WebhookTransform {
  /** JSONPath to extract the body content */
  contentPath?: string;
  /** JSONPath to extract the sender */
  senderPath?: string;
  /** Header name for signature verification */
  signatureHeader?: string;
  /** Signature algorithm */
  signatureAlgorithm?: 'sha256' | 'sha1';
}

export interface WebhookTarget {
  type: 'intent' | 'event' | 'agent';
  agentName?: string;
  goal?: string;
  eventType?: string;
  priority?: Priority;
}

export interface WebhookEvent {
  id: KernovaId;
  routeId: KernovaId;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  receivedAt: Timestamp;
  processed: boolean;
}

// ─── MCP Bridge ──────────────────────────────────────────────

export interface MCPServerConfig {
  id: KernovaId;
  name: string;
  transport: MCPTransport;
  toolPrefix?: string;             // Prefix for tool names (e.g., 'github_')
  enabled: boolean;
}

export type MCPTransport =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> };

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: KernovaId;
}

export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

// ─── Trajectory Recording ────────────────────────────────────

export interface TrajectoryEvent {
  id: KernovaId;
  traceId: KernovaId;
  type: TrajectoryEventType;
  timestamp: Timestamp;
  seq: number;
  sessionId?: KernovaId;
  agentId?: KernovaId;
  intentId?: KernovaId;
  data?: Record<string, unknown>;
}

export type TrajectoryEventType =
  | 'intent.submitted'
  | 'intent.planned'
  | 'intent.executing'
  | 'intent.completed'
  | 'intent.failed'
  | 'agent.selected'
  | 'agent.executing'
  | 'agent.completed'
  | 'tool.called'
  | 'tool.result'
  | 'model.request'
  | 'model.response'
  | 'model.fallback'
  | 'memory.stored'
  | 'memory.queried'
  | 'event.emitted'
  | 'error.occurred';

export interface TrajectoryTrace {
  id: KernovaId;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  events: TrajectoryEvent[];
  metadata: {
    intentGoal?: string;
    agentName?: string;
    totalTokens?: number;
    durationMs?: number;
  };
}

export interface TrajectoryConfig {
  /** Enable trajectory recording */
  enabled?: boolean;              // default: false
  /** Maximum events per trace */
  maxEvents?: number;             // default: 1000
  /** Maximum trace age before pruning */
  maxAgeMs?: number;              // default: 3_600_000 (1 hour)
  /** Redact sensitive data in events */
  redactSecrets?: boolean;        // default: true
}
