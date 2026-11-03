/**
 * Identity & Auth Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IdentityManager } from '../identity/identity-manager.js';
import { EventBus } from '../events/event-bus.js';

describe('IdentityManager', () => {
  let manager: IdentityManager;
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
    // In memory: without this, every run added rows to ./kernova-data/kernova.db in the repo
    manager = new IdentityManager(eventBus, { ephemeral: true });
  });

  afterEach(async () => {
    manager.close();
    await eventBus.stop();
  });

  describe('Identity Registration', () => {
    it('should register a user identity', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Alice', email: 'alice@test.com' });
      expect(user.id).toBeDefined();
      expect(user.name).toBe('Alice');
      expect(user.type).toBe('user');
      expect(user.active).toBe(true);
    });

    it('should register an agent identity', () => {
      const agent = manager.registerIdentity({ type: 'agent', name: 'assistant' });
      expect(agent.type).toBe('agent');
    });

    it('should assign default role based on type', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Bob' });
      const roles = manager.permissions.getRoles(user.id);
      expect(roles.map(r => r.id)).toContain('developer');
    });

    it('should assign custom roles', () => {
      const admin = manager.registerIdentity({ type: 'user', name: 'Admin', roles: ['admin'] });
      const roles = manager.permissions.getRoles(admin.id);
      expect(roles.map(r => r.id)).toContain('admin');
    });

    it('should deactivate identities', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Temp' });
      expect(manager.getIdentity(user.id)?.active).toBe(true);
      manager.deactivate(user.id);
      expect(manager.getIdentity(user.id)?.active).toBe(false);
    });
  });

  describe('API Keys', () => {
    it('should create and validate API keys', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Dev' });
      const { plaintext, key } = manager.createApiKey({
        name: 'test-key',
        ownerId: user.id,
        permissions: ['memory:read', 'intent:submit'],
      });

      expect(plaintext).toMatch(/^nxs_/);
      expect(key.name).toBe('test-key');
      expect(key.active).toBe(true);

      const validation = manager.apiKeys.validate(plaintext);
      expect(validation.valid).toBe(true);
      expect(validation.key?.ownerId).toBe(user.id);
    });

    it('should reject invalid API keys', () => {
      const validation = manager.apiKeys.validate('nxs_invalid_key_12345');
      expect(validation.valid).toBe(false);
    });

    it('should reject revoked API keys', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Dev' });
      const { plaintext, key } = manager.createApiKey({
        name: 'revocable', ownerId: user.id, permissions: ['*'],
      });

      manager.apiKeys.revoke(key.id);
      expect(manager.apiKeys.validate(plaintext).valid).toBe(false);
    });

    it('should authenticate with API key', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Auth Test' });
      const { plaintext } = manager.createApiKey({
        name: 'auth-key', ownerId: user.id, permissions: ['memory:read'],
      });

      const result = manager.authenticateWithKey(plaintext);
      expect(result).not.toBeNull();
      expect(result!.identity.name).toBe('Auth Test');
      expect(result!.permissions).toContain('memory:read');
    });
  });

  describe('Sessions', () => {
    it('should create and validate sessions', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Session User' });
      const session = manager.createSession({
        identityId: user.id,
        permissions: ['studio:access'],
      });

      expect(session.token).toBeDefined();
      expect(session.active).toBe(true);

      const auth = manager.authenticateWithSession(session.token);
      expect(auth).not.toBeNull();
      expect(auth!.identity.name).toBe('Session User');
    });

    it('should invalidate sessions', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Temp' });
      const session = manager.createSession({ identityId: user.id, permissions: [] });

      manager.sessions.invalidate(session.token);
      expect(manager.authenticateWithSession(session.token)).toBeNull();
    });
  });

  describe('Permissions', () => {
    it('should grant access for matching permissions', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Perm Test' });
      // Developer role includes 'memory:read'
      const result = manager.checkPermission({ identityId: user.id, resource: 'memory', action: 'read' });
      expect(result.granted).toBe(true);
    });

    it('should deny access for missing permissions', () => {
      const viewer = manager.registerIdentity({ type: 'user', name: 'Viewer' });
      // Remove default role and assign viewer
      manager.permissions.removeRole(viewer.id, 'developer');
      manager.permissions.assignRole(viewer.id, 'viewer');

      const result = manager.checkPermission({ identityId: viewer.id, resource: 'memory', action: 'write' });
      expect(result.granted).toBe(false);
    });

    it('should support wildcard permissions', () => {
      const admin = manager.registerIdentity({ type: 'user', name: 'Admin', roles: ['admin'] });
      // Admin has '*' which matches everything
      const result = manager.checkPermission({ identityId: admin.id, resource: 'anything', action: 'whatever' });
      expect(result.granted).toBe(true);
    });

    it('should throw on requirePermission when denied', () => {
      const agent = manager.registerIdentity({ type: 'agent', name: 'limited-agent' });
      manager.permissions.removeRole(agent.id, 'agent');
      // No permissions at all
      expect(() => manager.requirePermission({
        identityId: agent.id, resource: 'secret', action: 'read',
      })).toThrow('Permission denied');
    });

    it('should support direct permission grants', () => {
      const user = manager.registerIdentity({ type: 'user', name: 'Direct' });
      manager.permissions.removeRole(user.id, 'developer');
      manager.permissions.grantPermission(user.id, 'special:action');

      const result = manager.checkPermission({ identityId: user.id, resource: 'special', action: 'action' });
      expect(result.granted).toBe(true);
    });
  });

  describe('Organizations', () => {
    it('should create organizations', () => {
      const owner = manager.registerIdentity({ type: 'user', name: 'Founder' });
      const org = manager.createOrganization({ name: 'Kernova Labs', slug: 'kernova-labs', ownerId: owner.id });

      expect(org.id).toBeDefined();
      expect(org.name).toBe('Kernova Labs');
      expect(org.ownerId).toBe(owner.id);
    });

    it('should add members to organizations', () => {
      const owner = manager.registerIdentity({ type: 'user', name: 'Owner' });
      const org = manager.createOrganization({ name: 'Team', slug: 'team', ownerId: owner.id });
      const member = manager.registerIdentity({ type: 'user', name: 'Member' });

      manager.addOrgMember(org.id, member.id);
      const members = manager.getOrgMembers(org.id);
      expect(members).toHaveLength(2); // owner + member
      expect(members.map(m => m.name)).toContain('Member');
    });
  });
});
