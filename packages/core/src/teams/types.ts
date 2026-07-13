/**
 * Multi-Agent Team System — Types
 *
 * Defines the structure of teams, delegation, and shared workspaces.
 */

/** Unique ID type */
export type AgentId = string;
export type TeamId = string;
export type TaskId = string;
export type MessageId = string;

/** Team delegation strategies */
export type DelegationStrategy =
  | 'sequential'    // Tasks flow agent → agent in order
  | 'hierarchical'  // Lead assigns to members, reviews results
  | 'collaborative' // Agents can delegate to each other freely
  | 'round-robin'   // Tasks distributed evenly across agents
  | 'broadcast'     // All agents work on the same task, best result wins
  | 'pipeline';     // Output of one agent feeds into next

/** Agent role within a team */
export interface TeamMember {
  /** Agent name (matches defineAgent name) */
  agent: string;
  /** Role within the team */
  role: 'lead' | 'member' | 'reviewer' | 'specialist';
  /** Human-readable description of what this member does */
  description?: string;
  /** What kind of tasks this member handles */
  specialization?: string[];
  /** Can this agent delegate to others? */
  canDelegate?: boolean;
  /** Can this agent approve other agents' work? */
  canApprove?: boolean;
  /** Maximum concurrent tasks for this member */
  maxConcurrentTasks?: number;
}

/** Team definition (stored in core) */
export interface TeamConfig {
  /** Team ID */
  id: TeamId;
  /** Team name */
  name: string;
  /** Description */
  description?: string;
  /** Members of the team */
  members: TeamMember[];
  /** How tasks are distributed */
  strategy: DelegationStrategy;
  /** Which agent leads (for hierarchical strategy) */
  lead?: string;
  /** Maximum delegation depth (prevent infinite loops) */
  maxDelegationDepth?: number;
  /** Timeout for the entire team task in ms */
  taskTimeout?: number;
  /** Whether to require the lead's approval before final output */
  requireLeadApproval?: boolean;
  /** Shared workspace config */
  workspace?: {
    /** Whether to persist workspace across tasks */
    persistent?: boolean;
    /** Max size in bytes */
    maxSize?: number;
  };
}

/** A message between agents in the team */
export interface AgentMessage {
  id: MessageId;
  from: AgentId;
  to: AgentId;
  type: 'delegate' | 'result' | 'feedback' | 'question' | 'broadcast' | 'approve' | 'reject';
  content: string;
  /** Structured data payload */
  payload?: Record<string, unknown>;
  /** Original task this message relates to */
  taskId?: TaskId;
  /** Timestamp */
  timestamp: string;
  /** Message priority */
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

/** A task assigned to an agent within the team */
export interface TeamTask {
  id: TaskId;
  /** Team this task belongs to */
  teamId: TeamId;
  /** The high-level goal */
  goal: string;
  /** Current assignee */
  assignee: AgentId;
  /** Who assigned this task */
  assignedBy: AgentId | 'system';
  /** Current status */
  status: 'pending' | 'in-progress' | 'awaiting-review' | 'approved' | 'rejected' | 'completed' | 'failed';
  /** Result from the agent */
  result?: string;
  /** Structured result data */
  resultData?: Record<string, unknown>;
  /** Feedback from reviewer */
  feedback?: string;
  /** Sub-tasks delegated from this task */
  subtasks?: TaskId[];
  /** Parent task (if this is a subtask) */
  parentTask?: TaskId;
  /** Delegation depth (how many levels deep) */
  depth: number;
  /** Timestamps */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Number of attempts (for retries) */
  attempts: number;
  /** Max retries allowed */
  maxRetries: number;
  /** Context/constraints for the task */
  context?: Record<string, unknown>;
}

/** Shared workspace item */
export interface WorkspaceEntry {
  key: string;
  value: unknown;
  setBy: AgentId;
  timestamp: string;
  /** Version for optimistic concurrency */
  version: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Execution trace for the full team task */
export interface TeamExecutionTrace {
  teamId: TeamId;
  rootTaskId: TaskId;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  /** All tasks in execution order */
  tasks: TeamTask[];
  /** All messages exchanged */
  messages: AgentMessage[];
  /** Final result */
  result?: string;
  /** Total tokens used across all agents */
  totalTokens?: number;
  /** Total cost in USD */
  totalCost?: number;
}

/** Options for executing a team task */
export interface TeamExecuteOptions {
  /** The goal/task to accomplish */
  goal: string;
  /** Additional context to provide all agents */
  context?: Record<string, unknown>;
  /** Override the default strategy for this execution */
  strategy?: DelegationStrategy;
  /** Timeout in ms */
  timeout?: number;
  /** Callback for progress updates */
  onProgress?: (event: TeamProgressEvent) => void;
  /** Thread ID for conversation context */
  threadId?: string;
}

/** Progress events emitted during team execution */
export interface TeamProgressEvent {
  type: 'task-assigned' | 'task-started' | 'task-completed' | 'delegation' | 'review' | 'message' | 'error' | 'completed';
  agent?: string;
  task?: TeamTask;
  message?: AgentMessage;
  error?: string;
  timestamp: string;
}
