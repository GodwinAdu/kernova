/**
 * Kernova Permission Engine
 * 
 * Pillar 2: Trust — "Should we believe you?"
 * 
 * Checks whether an identity (user, agent, service) has permission
 * to perform a specific action on a specific resource.
 * 
 * Permission format: "resource:action" or "resource:*" for wildcard.
 * Examples:
 *   "memory:read"
 *   "memory:write"
 *   "intent:submit"
 *   "agent:execute"
 *   "tool:execute:math:calculate"
 *   "*" (superuser — all permissions)
 */

import type { KernovaId } from '@kernova/types';
import { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface PermissionCheck {
  /** The identity requesting access */
  identityId: KernovaId;

  /** The resource being accessed */
  resource: string;

  /** The action being performed */
  action: string;
}

export interface PermissionResult {
  /** Whether access is granted */
  granted: boolean;

  /** Why it was denied (if denied) */
  reason?: string;

  /** Which permission rule matched */
  matchedRule?: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  description?: string;
}

export class PermissionEngine {
  private roles: Map<string, Role> = new Map();
  private identityRoles: Map<KernovaId, string[]> = new Map(); // identity → role IDs
  private identityPermissions: Map<KernovaId, string[]> = new Map(); // direct permissions
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;

    // Register built-in roles
    this.defineRole({
      id: 'admin',
      name: 'Administrator',
      permissions: ['*'],
      description: 'Full access to all resources',
    });

    this.defineRole({
      id: 'developer',
      name: 'Developer',
      permissions: [
        'intent:submit', 'intent:read',
        'memory:read', 'memory:write',
        'agent:execute', 'agent:read',
        'tool:execute:*',
        'workflow:read', 'workflow:execute',
        'event:read',
        'studio:access',
      ],
      description: 'Standard developer access',
    });

    this.defineRole({
      id: 'agent',
      name: 'Agent',
      permissions: [
        'memory:read', 'memory:write',
        'tool:execute:*',
        'event:emit',
      ],
      description: 'Permissions for AI agents',
    });

    this.defineRole({
      id: 'viewer',
      name: 'Viewer',
      permissions: [
        'intent:read',
        'memory:read',
        'agent:read',
        'event:read',
        'studio:access',
      ],
      description: 'Read-only access',
    });
  }

  /**
   * Check if an identity has permission to perform an action.
   */
  check(request: PermissionCheck): PermissionResult {
    const { identityId, resource, action } = request;
    const requiredPermission = `${resource}:${action}`;

    // Get all effective permissions for this identity
    const effectivePermissions = this.getEffectivePermissions(identityId);

    // Check if any permission grants access
    for (const perm of effectivePermissions) {
      if (this.permissionMatches(perm, requiredPermission)) {
        return { granted: true, matchedRule: perm };
      }
    }

    // Denied — emit event
    this.emitEvent('permission.denied', {
      identityId,
      resource,
      action,
      required: requiredPermission,
    });

    return {
      granted: false,
      reason: `Identity "${identityId}" lacks permission "${requiredPermission}"`,
    };
  }

  /**
   * Require a permission — throws if denied.
   */
  require(request: PermissionCheck): void {
    const result = this.check(request);
    if (!result.granted) {
      throw new Error(`Permission denied: ${result.reason}`);
    }
  }

  /**
   * Define a role
   */
  defineRole(role: Role): void {
    this.roles.set(role.id, role);
  }

  /**
   * Assign a role to an identity
   */
  assignRole(identityId: KernovaId, roleId: string): void {
    if (!this.roles.has(roleId)) {
      throw new Error(`Role "${roleId}" not found`);
    }

    const existing = this.identityRoles.get(identityId) || [];
    if (!existing.includes(roleId)) {
      existing.push(roleId);
      this.identityRoles.set(identityId, existing);
    }

    this.emitEvent('role.assigned', { identityId, roleId });
  }

  /**
   * Remove a role from an identity
   */
  removeRole(identityId: KernovaId, roleId: string): void {
    const existing = this.identityRoles.get(identityId) || [];
    this.identityRoles.set(identityId, existing.filter(r => r !== roleId));
  }

  /**
   * Grant a direct permission to an identity (bypasses roles)
   */
  grantPermission(identityId: KernovaId, permission: string): void {
    const existing = this.identityPermissions.get(identityId) || [];
    if (!existing.includes(permission)) {
      existing.push(permission);
      this.identityPermissions.set(identityId, existing);
    }
  }

  /**
   * Revoke a direct permission from an identity
   */
  revokePermission(identityId: KernovaId, permission: string): void {
    const existing = this.identityPermissions.get(identityId) || [];
    this.identityPermissions.set(identityId, existing.filter(p => p !== permission));
  }

  /**
   * Get all effective permissions for an identity (roles + direct)
   */
  getEffectivePermissions(identityId: KernovaId): string[] {
    const permissions = new Set<string>();

    // Direct permissions
    const direct = this.identityPermissions.get(identityId) || [];
    for (const p of direct) permissions.add(p);

    // Role-based permissions
    const roleIds = this.identityRoles.get(identityId) || [];
    for (const roleId of roleIds) {
      const role = this.roles.get(roleId);
      if (role) {
        for (const p of role.permissions) permissions.add(p);
      }
    }

    return Array.from(permissions);
  }

  /**
   * Get all defined roles
   */
  listRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get roles for an identity
   */
  getRoles(identityId: KernovaId): Role[] {
    const roleIds = this.identityRoles.get(identityId) || [];
    return roleIds
      .map(id => this.roles.get(id))
      .filter((r): r is Role => r !== undefined);
  }

  /**
   * Check if a permission pattern matches a required permission.
   * Supports wildcards: "*" matches everything, "tool:*" matches "tool:execute:x"
   */
  private permissionMatches(granted: string, required: string): boolean {
    // Superuser
    if (granted === '*') return true;

    // Exact match
    if (granted === required) return true;

    // Wildcard matching: "tool:execute:*" matches "tool:execute:math:calculate"
    if (granted.endsWith(':*')) {
      const prefix = granted.slice(0, -1); // Remove the trailing *
      return required.startsWith(prefix);
    }

    // Segment wildcard: "tool:*" matches "tool:execute" and "tool:execute:x"
    const grantedParts = granted.split(':');
    const requiredParts = required.split(':');

    for (let i = 0; i < grantedParts.length; i++) {
      if (grantedParts[i] === '*') return true; // Wildcard matches rest
      if (grantedParts[i] !== requiredParts[i]) return false;
    }

    return grantedParts.length === requiredParts.length;
  }

  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType: `identity.${eventType}`,
      category: 'identity',
      severity: eventType.includes('denied') ? 'warn' : 'info',
      timestamp: now(),
      subjectId: (data.identityId as string) || 'system',
      subjectType: 'identity',
      actorId: 'permission-engine',
      correlationId: generateId('cor'),
      data,
      metadata: { schemaVersion: '1.0.0', source: 'permission-engine', environment: 'development' },
    });
  }
}
