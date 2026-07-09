/**
 * Nexus Intent System
 * 
 * This is the core innovation of Nexus.
 * Intent is a first-class object — not a prompt, not a message.
 * 
 * Everything the system does traces back to an Intent.
 * This makes the system explainable, auditable, and governable.
 */

import type {
  NexusObject,
  NexusId,
  Priority,
  Confidence,
  Temporal,
  Evidence,
  Timestamp,
} from './base.js';

/** What kind of intent this is */
export type IntentType =
  | 'query'       // User wants information
  | 'action'      // User wants something done
  | 'workflow'    // User wants a multi-step process
  | 'decision'   // User wants help deciding
  | 'creation'   // User wants something built
  | 'analysis'   // User wants something analyzed
  | 'monitoring' // User wants ongoing observation
  | 'automation' // User wants recurring execution

/** Status specific to intent lifecycle */
export type IntentStatus =
  | 'pending'       // Received, not yet started
  | 'planning'     // Decomposing into tasks
  | 'executing'    // Tasks are running
  | 'waiting'      // Blocked on external input
  | 'reviewing'    // Awaiting human approval
  | 'completed'    // Successfully fulfilled
  | 'failed'       // Could not be fulfilled
  | 'cancelled';   // User cancelled

/**
 * The Intent Object
 * 
 * This is what replaces "prompts" and "conversations" in Nexus.
 * An Intent captures WHAT the user wants, WHY, and all constraints.
 */
export interface Intent extends NexusObject {
  type: 'intent';

  /** What kind of intent */
  intentType: IntentType;

  /** The goal in natural language */
  goal: string;

  /** Structured goal description */
  description?: string;

  /** Priority level */
  priority: Priority;

  /** Current intent status */
  intentStatus: IntentStatus;

  /** Confidence that we understand the intent correctly */
  confidence: Confidence;

  /** Who or what created this intent */
  source: IntentSource;

  /** Time constraints */
  temporal: Temporal & {
    /** Hard deadline */
    deadline?: Timestamp;
  };

  /** What this intent depends on */
  dependencies: NexusId[];

  /** Parent intent (for decomposed intents) */
  parentId?: NexusId;

  /** Child intents (sub-goals) */
  childIds: NexusId[];

  /** Constraints and requirements */
  constraints: IntentConstraint[];

  /** Who must approve before execution */
  approvals: Approval[];

  /** Risk assessment */
  risk: RiskAssessment;

  /** Evidence supporting this intent's resolution */
  evidence?: Evidence;

  /** The result when completed */
  result?: IntentResult;
}

export interface IntentSource {
  /** Who created this intent */
  actorId: NexusId;

  /** How it was created */
  channel: 'user' | 'agent' | 'workflow' | 'schedule' | 'event';

  /** Original raw input (if applicable) */
  rawInput?: string;
}

export interface IntentConstraint {
  /** What kind of constraint */
  type: 'budget' | 'time' | 'permission' | 'quality' | 'security' | 'custom';

  /** Constraint description */
  description: string;

  /** Is this a hard constraint (must satisfy) or soft (prefer) */
  hard: boolean;
}

export interface Approval {
  /** Who needs to approve */
  approverId: NexusId;

  /** Current approval status */
  status: 'pending' | 'approved' | 'rejected';

  /** When decided */
  decidedAt?: Timestamp;

  /** Reason for decision */
  reason?: string;
}

export interface RiskAssessment {
  /** Overall risk level */
  level: 'none' | 'low' | 'medium' | 'high' | 'critical';

  /** What could go wrong */
  factors: string[];

  /** Can this be undone */
  reversible: boolean;

  /** Impact if it goes wrong */
  impact?: string;
}

export interface IntentResult {
  /** Was it successful */
  success: boolean;

  /** Result data */
  data?: unknown;

  /** Human-readable summary */
  summary: string;

  /** Evidence for how we got here */
  evidence: Evidence;

  /** How long execution took */
  durationMs: number;
}
