/**
 * Kernova Identity & Trust System
 * 
 * Pillar 1 (Identity): Who are you?
 * Pillar 2 (Trust): Should we believe you?
 * 
 * Every actor in the system — human, agent, service — has an identity.
 * Trust is earned and verified, not assumed.
 */

import type {
  NexusObject,
  NexusId,
  Timestamp,
} from './base.js';

/** Types of actors in the system */
export type ActorType = 'user' | 'agent' | 'service' | 'system';

/** Authentication methods */
export type AuthMethod = 'api_key' | 'oauth' | 'jwt' | 'certificate' | 'internal';

/**
 * Identity
 * Represents any actor in the system
 */
export interface Identity extends NexusObject {
  type: 'identity';

  /** What kind of actor */
  actorType: ActorType;

  /** Display name */
  name: string;

  /** Email (for users) */
  email?: string;

  /** Organization this identity belongs to */
  organizationId?: NexusId;

  /** Roles assigned */
  roles: Role[];

  /** Trust level (0-1, earned over time) */
  trustLevel: number;

  /** Authentication method */
  authMethod: AuthMethod;

  /** Is this identity verified */
  verified: boolean;

  /** Last authentication time */
  lastAuthAt?: Timestamp;

  /** Permissions derived from roles */
  effectivePermissions: EffectivePermission[];
}

export interface Role {
  /** Role identifier */
  id: string;

  /** Role name */
  name: string;

  /** Role scope (global, org, project) */
  scope: 'global' | 'organization' | 'project';

  /** Scope reference (org or project ID) */
  scopeRef?: NexusId;
}

export interface EffectivePermission {
  /** Resource pattern (supports wildcards) */
  resource: string;

  /** Allowed actions */
  actions: string[];

  /** Deny rules override allows */
  effect: 'allow' | 'deny';
}

/**
 * Organization
 * A group of identities that share resources
 */
export interface Organization extends NexusObject {
  type: 'organization';

  /** Organization name */
  name: string;

  /** Organization slug (URL-friendly) */
  slug: string;

  /** Member count */
  memberCount: number;

  /** Organization-level settings */
  settings: OrgSettings;

  /** Subscription tier */
  tier: 'free' | 'pro' | 'enterprise';
}

export interface OrgSettings {
  /** Default model provider */
  defaultModelProvider?: string;

  /** Default model */
  defaultModel?: string;

  /** Data retention policy in days */
  retentionDays: number;

  /** Enable audit logging */
  auditLogging: boolean;

  /** Allowed authentication methods */
  allowedAuthMethods: AuthMethod[];

  /** Custom policies */
  policies: Policy[];
}

/**
 * Policy
 * Governance rules that apply to the organization
 * Pillar 7: Governance — Who is accountable?
 */
export interface Policy extends NexusObject {
  type: 'policy';

  /** Policy name */
  name: string;

  /** What this policy governs */
  description: string;

  /** Policy rules */
  rules: PolicyRule[];

  /** Is this policy enforced (true) or advisory (false) */
  enforced: boolean;

  /** Who created this policy */
  authorId: NexusId;
}

export interface PolicyRule {
  /** Rule identifier */
  id: string;

  /** What this rule checks */
  condition: string;

  /** What happens when triggered */
  action: 'block' | 'warn' | 'log' | 'require_approval';

  /** Human-readable explanation */
  message: string;
}
