---
title: Identity & Auth
description: Understand how authentication, authorization, and access control work in Nexus.
---

# Identity & Auth

In production, you can't let anyone submit intents, access memory, or manage agents without control. Nexus has **identity and authorization built in from day one** — not bolted on later.

## The Problem

Most AI frameworks have zero security model. In development that's fine, but in production:
- Who submitted this intent? (accountability)
- Should this user be allowed to access organizational memory? (authorization)
- How do I give my frontend limited access without exposing everything? (scoping)
- How do I revoke access if a key leaks? (security)

## How Nexus Handles It

Every actor in the system — whether human, AI agent, or external service — has an **identity** with **roles** and **permissions**.

```
Identity (who are you?)
   → Roles (what group do you belong to?)
      → Permissions (what specific actions can you take?)
```

## Identities

Register users, agents, and services:

```typescript
// Register a human user
const alice = kernel.identity.registerIdentity({
  type: 'user',
  name: 'Alice',
  email: 'alice@company.com',
  roles: ['developer'],
});

// Register an AI agent identity
const assistant = kernel.identity.registerIdentity({
  type: 'agent',
  name: 'assistant',
  // Gets 'agent' role by default (memory + tools only)
});

// Register an external service
const webhook = kernel.identity.registerIdentity({
  type: 'service',
  name: 'slack-webhook',
  roles: ['viewer'], // Read-only access
});
```

## Authentication

### API Keys (for programmatic access)

Generate keys scoped to specific permissions:

```typescript
const { plaintext, key } = kernel.identity.createApiKey({
  name: 'production-frontend',
  ownerId: alice.id,
  permissions: ['intent:submit', 'memory:read'],
  ttlSeconds: 86400 * 30, // Expires in 30 days
});

// plaintext = "nxs_a1b2c3d4..." (shown ONCE, never stored)
// Use in Authorization header: "Bearer nxs_a1b2c3d4..."
```

**Key security:**
- Keys are prefixed with `nxs_` for easy identification
- Stored as SHA-256 hashes — plaintext is never saved
- Can be revoked instantly: `kernel.identity.apiKeys.revoke(key.id)`
- Optional TTL for automatic expiration

### Sessions (for web dashboard)

For the Studio UI or your own web frontend:

```typescript
const session = kernel.identity.createSession({
  identityId: alice.id,
  permissions: ['studio:access', 'intent:read', 'event:read', 'memory:read'],
  ttlSeconds: 86400, // 24 hours
});

// session.token = "abc123..." (use as Bearer token)
```

### Authenticating a request

```typescript
// From an API key
const auth = kernel.identity.authenticateWithKey('nxs_a1b2c3d4...');
if (auth) {
  console.log(`Authenticated as: ${auth.identity.name}`);
  console.log(`Permissions: ${auth.permissions}`);
}

// From a session token
const auth = kernel.identity.authenticateWithSession('abc123...');
```

## Authorization (Permissions)

### Permission format

Permissions follow the pattern `resource:action`:

```
memory:read          — Can read memories
memory:write         — Can store memories
intent:submit        — Can submit intents
intent:read          — Can view intent results
agent:execute        — Can trigger agent execution
agent:manage         — Can register/remove agents
tool:execute:*       — Can execute any tool
tool:execute:search  — Can only execute the 'search' tool
workflow:approve     — Can approve workflow steps
studio:access        — Can access the web dashboard
event:read           — Can query events
*                    — Superuser (everything)
```

### Built-in roles

| Role | Permissions | Typical use |
|------|-------------|-------------|
| `admin` | `*` (everything) | System administrators |
| `developer` | intents, memory, agents, tools, workflows, events, studio | Engineers building with Nexus |
| `agent` | memory read/write, tool execute, event emit | AI agents during execution |
| `viewer` | read-only (intents, memory, agents, events, studio) | Dashboards, monitoring |

### Checking permissions

```typescript
// Check (returns result, doesn't throw)
const result = kernel.identity.checkPermission({
  identityId: alice.id,
  resource: 'memory',
  action: 'write',
});
// { granted: true, matchedRule: 'memory:write' }

// Require (throws if denied)
kernel.identity.requirePermission({
  identityId: webhook.id,
  resource: 'memory',
  action: 'write',
});
// → throws: "Permission denied: Identity 'slack-webhook' lacks permission 'memory:write'"
```

### Custom permissions

Grant specific permissions directly:

```typescript
kernel.identity.permissions.grantPermission(webhook.id, 'intent:submit');
kernel.identity.permissions.revokePermission(webhook.id, 'intent:submit');
```

## Enforcement

Permissions are **automatically enforced** by the kernel:

```typescript
// When submit() is called with an owner:
await kernel.submit({ goal: 'Do something', owner: webhook.id });
// → Kernel checks: does webhook.id have 'intent:submit'?
// → If not: throws "Permission denied"
```

Budget limits are also enforced per-identity — see the [Budget guide](/guides/budgets/).

## Organizations

Group identities together for team access:

```typescript
const org = kernel.identity.createOrganization({
  name: 'Nexus Labs',
  slug: 'nexus-labs',
  ownerId: alice.id, // Alice gets 'admin' role
});

// Add team members
kernel.identity.addOrgMember(org.id, bob.id, 'developer');
kernel.identity.addOrgMember(org.id, assistant.id, 'agent');

// List members
const team = kernel.identity.getOrgMembers(org.id);
```

## Studio Auth

In development, Studio (http://localhost:4200) is open by default. In production, enable auth:

```typescript
// In production.ts (generated by nexus deploy)
new StudioServer(kernel, {
  requireAuth: true, // All /api/* routes require Bearer token
});
```

Access with: `Authorization: Bearer nxs_your_key`

The `/health` endpoint is always public (for load balancer probes).

## Event Auditing

All identity actions emit events:
- `identity.registered` — New identity created
- `identity.permission.denied` — Access was blocked
- `identity.role.assigned` — Role changed
- `organization.created` — New org

Query these for audit logs:
```typescript
const denials = kernel.events.query({ type: 'identity.permission.denied', limit: 100 });
```

## Best Practices

1. **Use API keys for services, sessions for humans** — Different TTLs and revocation patterns
2. **Scope keys tightly** — Give each key only the permissions it needs
3. **Set TTL on keys** — Leaked keys auto-expire
4. **Audit permission denials** — Monitor `permission.denied` events for abuse attempts
5. **Use organizations** — Group related identities for easier management
