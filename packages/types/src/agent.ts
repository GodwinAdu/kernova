/**
 * Kernova Agent System
 * 
 * Agents are the execution units of Kernova.
 * They receive Intents and produce Results.
 * 
 * An Agent is NOT just a wrapper around an LLM.
 * An Agent is a capability-bearing entity with:
 * - Identity (who it is)
 * - Capabilities (what it can do)
 * - Permissions (what it's allowed to do)
 * - Memory (what it knows)
 * - Tools (what it has access to)
 */

import type {
  NexusObject,
  NexusId,
  Confidence,
} from './base.js';

/** Agent operational state */
export type AgentState =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting'
  | 'error'
  | 'offline';

/**
 * Agent Definition
 * The blueprint for creating an agent
 */
export interface AgentDefinition extends NexusObject {
  type: 'agent_definition';

  /** Human-readable name */
  name: string;

  /** What this agent does */
  description: string;

  /** What capabilities this agent has */
  capabilities: Capability[];

  /** What tools this agent can use */
  tools: ToolReference[];

  /** What models this agent can use */
  models: ModelReference[];

  /** Agent's system instructions */
  instructions: string;

  /** Memory configuration */
  memoryConfig: MemoryConfig;

  /** Permissions granted to this agent */
  permissions: Permission[];

  /** Maximum concurrent intents */
  concurrency: number;

  /** Configuration for the agent's behavior */
  config: AgentConfig;
}

/**
 * Agent Instance
 * A running instance of an agent definition
 */
export interface AgentInstance extends NexusObject {
  type: 'agent_instance';

  /** Which definition this is an instance of */
  definitionId: NexusId;

  /** Current operational state */
  state: AgentState;

  /** Currently processing intent IDs */
  activeIntents: NexusId[];

  /** Session context */
  sessionId?: NexusId;

  /** Runtime metrics */
  metrics: AgentMetrics;
}

export interface Capability {
  /** Unique capability identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** What this capability does */
  description: string;

  /** Confidence that this agent can perform this capability */
  confidence: Confidence;
}

export interface ToolReference {
  /** Tool identifier */
  toolId: string;

  /** Tool name */
  name: string;

  /** Why the agent has this tool */
  purpose: string;

  /** Is this tool required or optional */
  required: boolean;
}

export interface ModelReference {
  /** Model provider */
  provider: string;

  /** Model identifier */
  model: string;

  /** What this model is used for */
  purpose: 'reasoning' | 'generation' | 'embedding' | 'classification' | 'custom';

  /** Fallback model if primary is unavailable */
  fallback?: string;
}

export interface MemoryConfig {
  /** Enable working memory */
  workingMemory: boolean;

  /** Enable session memory */
  sessionMemory: boolean;

  /** Enable long-term memory */
  longTermMemory: boolean;

  /** Maximum working memory items */
  workingMemoryLimit: number;

  /** Session memory TTL in seconds */
  sessionMemoryTtl: number;
}

export interface Permission {
  /** What resource this permission applies to */
  resource: string;

  /** What actions are allowed */
  actions: string[];

  /** Conditions for this permission */
  conditions?: Record<string, unknown>;
}

export interface AgentConfig {
  /** Temperature for model calls */
  temperature?: number;

  /** Maximum tokens per response */
  maxTokens?: number;

  /** Retry configuration */
  retries: {
    maxAttempts: number;
    backoffMs: number;
  };

  /** Timeout for individual operations */
  timeoutMs: number;

  /** Per-agent self-reflection configuration */
  reflection?: {
    /** Whether reflection is enabled for this agent */
    enabled: boolean;
    /** Confidence score threshold (overrides global, default: 0.7) */
    threshold?: number;
    /** Maximum regeneration attempts (overrides global, default: 2) */
    maxAttempts?: number;
  };
}

export interface AgentMetrics {
  /** Total intents processed */
  intentsProcessed: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Average response time in ms */
  avgResponseMs: number;

  /** Total tokens consumed */
  tokensConsumed: number;

  /** Uptime since last restart */
  uptimeMs: number;
}
