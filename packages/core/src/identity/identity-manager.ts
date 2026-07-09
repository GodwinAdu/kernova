/**
 * Nexus Identity Manager
 * 
 * Pillar 1: Identity — "Who are you?"
 * 
 * Manages users, agents, services, and organizations.
 * Every actor in the system has an identity.
 */

import type { NexusId } from '@nexus/types';
import { EventBus } from '../events/event-bus.js';
import { ApiKeyManager, type ApiKey, type CreateKeyOptions } from './api-keys.js';
import { PermissionEngine, type PermissionCheck, type PermissionResult, type Role } from './permission-engine.js';
import { SessionManager, type Session, type CreateSessionOptions } from './session-manager.js';
import { IdentityStore } from './identity-store.js';
import { generateId, now } from '../utils.js';

/** Types of actors in the system */
export type ActorType = 'user' | 'agent' | 'service' | 'system';

/** A registered identity */
export interface RegisteredIdentity {
  id: NexusId;
  type: ActorType;
  name: string;
  email?: string;
  organizationId?: NexusId;
  createdAt: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

/** Organization */
export interface Organization {
  id: NexusId;
  name: string;
  slug: string;
  ownerId: NexusId;
  createdAt: string;
  settings: Record<string, unknown>;
}

export interface IdentityManagerConfig {
  /** Default session TTL in seconds */
  sessionTtlSeconds?: number;

  /** Path to SQLite database for persistent storage */
  storePath?: string;

  /** Disable persistence (in-memory only) */
  ephemeral?: boolean;
}

/**
 * The central identity management system.
 * Coordinates API keys, sessions, permissions, and organizations.
 */
export class IdentityManager {
  private identities: Map<NexusId, RegisteredIdentity> = new Map();
  private organizations: Map<NexusId, Organization> = new Map();
  private orgMembers: Map<NexusId, Set<NexusId>> = new Map(); // orgId → identityIds
  private store: IdentityStore | null = null;

  readonly apiKeys: ApiKeyManager;
  readonly permissions: PermissionEngine;
  readonly sessions: SessionManager;

  private eventBus: EventBus;

  constructor(eventBus: EventBus, config: IdentityManagerConfig = {}) {
    this.eventBus = eventBus;
    this.apiKeys = new ApiKeyManager();
    this.permissions = new PermissionEngine(eventBus);
    this.sessions = new SessionManager(config.sessionTtlSeconds);

    // Initialize persistent store if not ephemeral
    if (!config.ephemeral) {
      try {
        this.store = new IdentityStore({ path: config.storePath });
      } catch {
        // Store initialization failed — continue in-memory only
        this.store = null;
      }
    }

    // Register the system identity
    this.registerIdentity({
      type: 'system',
      name: 'System',
    });
  }

  /**
   * Register a new identity (user, agent, or service)
   */
  registerIdentity(options: {
    type: ActorType;
    name: string;
    email?: string;
    organizationId?: NexusId;
    roles?: string[];
  }): RegisteredIdentity {
    const identity: RegisteredIdentity = {
      id: generateId(options.type),
      type: options.type,
      name: options.name,
      email: options.email,
      organizationId: options.organizationId,
      createdAt: now(),
      active: true,
      metadata: {},
    };

    this.identities.set(identity.id, identity);

    // Persist to store
    if (this.store) {
      this.store.storeIdentity(identity);
    }

    // Assign default role based on type
    const defaultRole = options.type === 'agent' ? 'agent'
      : options.type === 'service' ? 'developer'
      : 'developer';

    this.permissions.assignRole(identity.id, defaultRole);

    // Assign additional roles
    if (options.roles) {
      for (const role of options.roles) {
        this.permissions.assignRole(identity.id, role);
      }
    }

    // Add to organization if specified
    if (options.organizationId) {
      const members = this.orgMembers.get(options.organizationId) || new Set();
      members.add(identity.id);
      this.orgMembers.set(options.organizationId, members);
    }

    this.emitEvent('identity.registered', {
      identityId: identity.id,
      type: identity.type,
      name: identity.name,
    });

    return identity;
  }

  /**
   * Get an identity by ID
   */
  getIdentity(id: NexusId): RegisteredIdentity | undefined {
    return this.identities.get(id);
  }

  /**
   * Authenticate with an API key. Returns the identity if valid.
   */
  authenticateWithKey(apiKey: string): { identity: RegisteredIdentity; permissions: string[] } | null {
    const validation = this.apiKeys.validate(apiKey);
    if (!validation.valid || !validation.key) return null;

    const identity = this.identities.get(validation.key.ownerId);
    if (!identity || !identity.active) return null;

    return {
      identity,
      permissions: validation.key.permissions,
    };
  }

  /**
   * Authenticate with a session token. Returns the identity if valid.
   */
  authenticateWithSession(token: string): { identity: RegisteredIdentity; permissions: string[] } | null {
    const session = this.sessions.validate(token);
    if (!session) return null;

    const identity = this.identities.get(session.identityId);
    if (!identity || !identity.active) return null;

    return {
      identity,
      permissions: session.permissions,
    };
  }

  /**
   * Create an API key for an identity
   */
  createApiKey(options: CreateKeyOptions): { plaintext: string; key: ApiKey } {
    // Verify the owner exists
    if (!this.identities.has(options.ownerId)) {
      throw new Error(`Identity "${options.ownerId}" not found`);
    }
    const result = this.apiKeys.create(options);

    // Persist key to store
    if (this.store) {
      this.store.storeKey(result.key);
    }

    return result;
  }

  /**
   * Create a session for an identity
   */
  createSession(options: CreateSessionOptions): Session {
    if (!this.identities.has(options.identityId)) {
      throw new Error(`Identity "${options.identityId}" not found`);
    }
    return this.sessions.create(options);
  }

  /**
   * Check a permission
   */
  checkPermission(check: PermissionCheck): PermissionResult {
    return this.permissions.check(check);
  }

  /**
   * Require a permission (throws if denied)
   */
  requirePermission(check: PermissionCheck): void {
    this.permissions.require(check);
  }

  /**
   * Create an organization
   */
  createOrganization(options: { name: string; slug: string; ownerId: NexusId }): Organization {
    const org: Organization = {
      id: generateId('org'),
      name: options.name,
      slug: options.slug,
      ownerId: options.ownerId,
      createdAt: now(),
      settings: {},
    };

    this.organizations.set(org.id, org);
    this.orgMembers.set(org.id, new Set([options.ownerId]));

    // Grant admin role to owner within org
    this.permissions.assignRole(options.ownerId, 'admin');

    this.emitEvent('organization.created', {
      orgId: org.id,
      name: org.name,
      ownerId: options.ownerId,
    });

    return org;
  }

  /**
   * Add a member to an organization
   */
  addOrgMember(orgId: NexusId, identityId: NexusId, role = 'developer'): void {
    const members = this.orgMembers.get(orgId) || new Set();
    members.add(identityId);
    this.orgMembers.set(orgId, members);

    // Update identity's org reference
    const identity = this.identities.get(identityId);
    if (identity) {
      identity.organizationId = orgId;
    }

    this.permissions.assignRole(identityId, role);
  }

  /**
   * Get organization members
   */
  getOrgMembers(orgId: NexusId): RegisteredIdentity[] {
    const memberIds = this.orgMembers.get(orgId) || new Set();
    return Array.from(memberIds)
      .map(id => this.identities.get(id))
      .filter((i): i is RegisteredIdentity => i !== undefined);
  }

  /**
   * Get an organization by ID
   */
  getOrganization(orgId: NexusId): Organization | undefined {
    return this.organizations.get(orgId);
  }

  /**
   * List all identities
   */
  listIdentities(type?: ActorType): RegisteredIdentity[] {
    const all = Array.from(this.identities.values());
    return type ? all.filter(i => i.type === type) : all;
  }

  /**
   * Deactivate an identity
   */
  deactivate(identityId: NexusId): boolean {
    const identity = this.identities.get(identityId);
    if (!identity) return false;
    identity.active = false;
    this.sessions.invalidateAll(identityId);
    return true;
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'identity',
      severity: 'info',
      timestamp: now(),
      subjectId: (data.identityId as string) || (data.orgId as string) || 'system',
      subjectType: 'identity',
      actorId: 'identity-manager',
      correlationId: generateId('cor'),
      data,
      metadata: { schemaVersion: '1.0.0', source: 'identity-manager', environment: 'development' },
    });
  }
}
