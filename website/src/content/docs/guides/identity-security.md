---
title: "Identity & Security"
description: User management, API keys, sessions, role-based permissions, sandbox isolation, and security auditing in Kernova.
---

Every request in Kernova has an owner. Before an intent reaches an agent, before a tool executes, before a single token is generated — the kernel asks three questions: **Who are you?** (Identity), **Should we believe you?** (Permissions), and **What can you touch?** (Sandbox). This guide covers the six modules that answer those questions and how they work together to keep your system secure.

The security stack is composed of:

- **IdentityManager** — Registers and authenticates users, agents, and services
- **ApiKeyManager** — Generates and validates scoped API keys
- **SessionManager** — Token-based sessions with TTL and invalidation
- **PermissionEngine** — Role-based access control with wildcard matching
- **SandboxManager** — Filesystem, tool, and network isolation for agent execution
- **SecurityAuditor** — Automated security scanning with actionable findings

---

## Overview

### Actors

Kernova recognizes four actor types:

| Type | Description | Default Role |
|------|-------------|--------------|
| `user` | Human operators interacting via Studio or API | `developer` |
| `agent` | AI agents executing intents | `agent` |
| `service` | External services authenticating via API key | `developer` |
| `system` | Internal kernel operations (always trusted) | `admin` |

Every actor gets a `RegisteredIdentity` with a unique ID, type, name, and optional organization membership.

### Authentication Flow

```
Request → API Key or Session Token
       → IdentityManager.authenticateWithKey() / authenticateWithSession()
       → PermissionEngine.check({ identityId, resource, action })
       → SandboxManager.createContext(agentId, policy)
       → Intent execution
```

### What the Kernel Enforces on Every `submit()`

When `kernel.submit()` is called, three checks run in sequence before the intent is processed:

1. **Permission check** — Does this identity have `intent:submit`?
2. **Budget check** — Has this identity exceeded their token/cost budget?
3. **Rate limit check** — Has this identity exceeded their request rate?

If any check fails, the intent is rejected immediately with a descriptive error.

---

## IdentityManager

The `IdentityManager` is the central coordinator for the entire identity system. It exposes the sub-managers (`apiKeys`, `permissions`, `sessions`) and provides high-level methods that combine their functionality.

### Registering Identities

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ ephemeral: true });
await kernel.start();

// Register a human user
const user = kernel.identity.registerIdentity({
  type: 'user',
  name: 'Alice Chen',
  email: 'alice@example.com',
  roles: ['developer'],
});

// Register an agent
const agent = kernel.identity.registerIdentity({
  type: 'agent',
  name: 'code-review-agent',
  roles: ['agent'],
});

// Register an external service
const service = kernel.identity.registerIdentity({
  type: 'service',
  name: 'CI Pipeline',
  roles: ['developer'],
});
```

### Retrieving Identities

```typescript
const identity = kernel.identity.getIdentity(user.id);
// { id: 'user_abc123', type: 'user', name: 'Alice Chen', active: true, ... }

// List all agents
const agents = kernel.identity.listIdentities('agent');
```

### Authentication

```typescript
// Authenticate with API key
const authResult = kernel.identity.authenticateWithKey('nxs_a1b2c3d4...');
if (authResult) {
  console.log(authResult.identity.name); // "Alice Chen"
  console.log(authResult.permissions);   // ["intent:submit", "memory:read", ...]
}

// Authenticate with session token
const sessionAuth = kernel.identity.authenticateWithSession(sessionToken);
if (sessionAuth) {
  // Session is valid and not expired
}
```

### Deactivating Identities

Deactivation disables the identity and invalidates all active sessions:

```typescript
kernel.identity.deactivate(user.id);
// All sessions for this user are now invalid
```

---

## API Keys

API keys provide programmatic access for services, CI pipelines, and integrations. Keys use the format `nxs_{random_32_hex}` and are stored as SHA-256 hashes — the plaintext is only returned once at creation.

### Creating a Key

```typescript
const { plaintext, key } = kernel.identity.createApiKey({
  name: 'CI Deploy Key',
  ownerId: service.id,
  permissions: ['intent:submit', 'agent:read'],
  ttlSeconds: 90 * 24 * 60 * 60, // 90 days
});

// Store this securely — it won't be shown again
console.log(plaintext); // "nxs_8f3a1b..."
console.log(key.prefix); // "nxs_8f3a1b2c" (safe to display)
```

### Validating a Key

```typescript
const validation = kernel.identity.apiKeys.validate(plaintext);

if (validation.valid) {
  console.log(validation.key!.ownerId);     // Who owns this key
  console.log(validation.key!.permissions); // What it can do
  console.log(validation.key!.lastUsedAt);  // Tracking
} else {
  console.log(validation.reason); // "Key not found" | "Key is revoked" | "Key has expired"
}
```

### Revoking a Key

```typescript
kernel.identity.apiKeys.revoke(key.id);
// Subsequent validate() calls return { valid: false, reason: "Key is revoked" }
```

### Scoping Permissions

Keys should always be scoped to the minimum permissions needed:

```typescript
// Read-only monitoring key
kernel.identity.createApiKey({
  name: 'Dashboard Monitor',
  ownerId: service.id,
  permissions: ['intent:read', 'event:read', 'agent:read'],
});

// Agent execution key (no admin access)
kernel.identity.createApiKey({
  name: 'Agent Runner',
  ownerId: service.id,
  permissions: ['intent:submit', 'agent:execute', 'memory:read'],
});
```

---

## Sessions

Sessions are used for interactive access — the Studio dashboard, browser-based clients, and short-lived API consumers. Each session is a random 32-byte token with a configurable TTL.

### Creating a Session

```typescript
const session = kernel.identity.createSession({
  identityId: user.id,
  permissions: ['intent:submit', 'memory:read', 'studio:access'],
  ttlSeconds: 3600, // 1 hour
});

console.log(session.token);     // Random hex token
console.log(session.expiresAt); // ISO timestamp
```

### Validating a Session

```typescript
const valid = kernel.identity.sessions.validate(session.token);

if (valid) {
  // Session is active and not expired
  // lastActivityAt is automatically updated
  console.log(valid.identityId);
  console.log(valid.permissions);
} else {
  // Token invalid, expired, or revoked
}
```

### TTL and Expiration

Sessions expire automatically after their TTL. The default is 24 hours, configurable at the kernel level:

```typescript
const kernel = new KernovaKernel({
  identity: {
    sessionTtlSeconds: 7200, // 2 hours default
  },
});
```

### Invalidation

```typescript
// Invalidate a single session (logout)
kernel.identity.sessions.invalidate(session.token);

// Invalidate all sessions for an identity (security incident)
const count = kernel.identity.sessions.invalidateAll(user.id);
console.log(`Invalidated ${count} sessions`);

// Clean up expired sessions (maintenance)
const removed = kernel.identity.sessions.cleanup();
```

---

## Permissions (RBAC)

The `PermissionEngine` implements role-based access control with a permission format of `resource:action`. Wildcards are supported for flexible matching.

### Built-in Roles

| Role | Permissions | Use Case |
|------|-------------|----------|
| `admin` | `*` (all) | System administrators |
| `developer` | `intent:submit`, `memory:read/write`, `agent:execute/read`, `tool:execute:*`, `workflow:read/execute`, `studio:access` | Standard developers |
| `viewer` | `intent:read`, `memory:read`, `agent:read`, `event:read`, `studio:access` | Read-only dashboards |
| `agent` | `memory:read/write`, `tool:execute:*`, `event:emit` | AI agent execution |

### Checking Permissions

```typescript
const result = kernel.identity.checkPermission({
  identityId: user.id,
  resource: 'intent',
  action: 'submit',
});

if (result.granted) {
  console.log(`Allowed via: ${result.matchedRule}`); // "intent:submit"
} else {
  console.log(`Denied: ${result.reason}`);
}
```

### Requiring Permissions (Throws on Deny)

```typescript
// Throws Error("Permission denied: ...") if not granted
kernel.identity.requirePermission({
  identityId: agent.id,
  resource: 'memory',
  action: 'write',
});
```

### Assigning and Removing Roles

```typescript
// Promote to admin
kernel.identity.permissions.assignRole(user.id, 'admin');

// Demote back
kernel.identity.permissions.removeRole(user.id, 'admin');

// Get current roles
const roles = kernel.identity.permissions.getRoles(user.id);
// [{ id: 'developer', name: 'Developer', permissions: [...] }]
```

### Custom Roles

```typescript
kernel.identity.permissions.defineRole({
  id: 'ops',
  name: 'Operations',
  permissions: [
    'intent:read',
    'agent:read',
    'event:read',
    'workflow:execute',
    'studio:access',
  ],
  description: 'Operations team — can trigger workflows and view state',
});

kernel.identity.permissions.assignRole(user.id, 'ops');
```

### Direct Permissions (Bypass Roles)

For fine-grained one-off grants:

```typescript
// Grant a specific permission without a full role
kernel.identity.permissions.grantPermission(service.id, 'webhook:manage');

// Revoke it
kernel.identity.permissions.revokePermission(service.id, 'webhook:manage');
```

### Wildcard Matching

The permission engine supports multi-level wildcards:

```typescript
// "tool:execute:*" matches "tool:execute:math:calculate"
// "tool:*" matches "tool:execute" and "tool:read"
// "*" matches everything (superuser)
```

---

## Organizations

Organizations group identities under a shared namespace with role-based membership.

### Creating an Organization

```typescript
const org = kernel.identity.createOrganization({
  name: 'Acme Corp',
  slug: 'acme-corp',
  ownerId: user.id, // Owner gets admin role automatically
});
```

### Adding Members

```typescript
// Add with default role (developer)
kernel.identity.addOrgMember(org.id, anotherUser.id);

// Add with specific role
kernel.identity.addOrgMember(org.id, viewer.id, 'viewer');
```

### Querying Members

```typescript
const members = kernel.identity.getOrgMembers(org.id);
// Returns all RegisteredIdentity objects for the org

const orgInfo = kernel.identity.getOrganization(org.id);
// { id, name, slug, ownerId, createdAt, settings }
```

### Identity–Organization Binding

When a user registers with an `organizationId`, they're automatically added to that org's member set. Their `identity.organizationId` field is also updated when added via `addOrgMember`.

---

## Sandbox Isolation

The `SandboxManager` creates isolated execution contexts for agent tool calls. Every tool execution happens within a sandbox that restricts filesystem access, tool availability, network access, and execution time.

### Default Policy

Out of the box, sandboxes enforce:

| Constraint | Default |
|-----------|---------|
| Allowed paths | Current workspace (`.`) |
| Denied paths | `..`, `/etc`, `/usr`, `C:\Windows`, `C:\Program Files` |
| Timeout | 30 seconds |
| Network | Allowed |
| Filesystem writes | Allowed |

### Creating a Sandbox Context

```typescript
// Create a sandbox with default policy
const ctx = kernel.sandbox.createContext(agent.id);

// Create a restricted sandbox
const restrictedCtx = kernel.sandbox.createContext(agent.id, {
  allowedPaths: ['./src', './data'],
  deniedPaths: ['./secrets', './.env'],
  allowedTools: ['file-read', 'http-fetch', 'math-calculate'],
  deniedTools: ['shell-exec'],
  timeoutMs: 10_000,
  allowNetwork: false,
  allowWrite: false,
});
```

### Path Restriction Checks

```typescript
kernel.sandbox.isPathAllowed(ctx.id, './src/index.ts');  // true
kernel.sandbox.isPathAllowed(ctx.id, '../../etc/passwd'); // false — traversal denied
kernel.sandbox.isPathAllowed(ctx.id, '/etc/shadow');      // false — denied path
```

Path checks resolve relative to the workspace directory. Any attempt to traverse outside the workspace is automatically blocked and emits a `sandbox.path.denied` event.

### Tool Allow/Deny

```typescript
kernel.sandbox.isToolAllowed(restrictedCtx.id, 'file-read');  // true
kernel.sandbox.isToolAllowed(restrictedCtx.id, 'shell-exec'); // false — explicitly denied
kernel.sandbox.isToolAllowed(restrictedCtx.id, 'db-query');   // false — not in allowedTools
```

The deny list always takes precedence over the allow list.

### Timeout Enforcement

```typescript
const timeout = kernel.sandbox.getTimeout(ctx.id); // 30000 (ms)
// Tool execution engine wraps calls with this timeout
```

### Cleanup

```typescript
// Destroy when execution completes
kernel.sandbox.destroy(ctx.id);

// List active sandboxes
const active = kernel.sandbox.list();
```

---

## How the Kernel Enforces Identity

The `submit()` method on `KernovaKernel` is the single entry point for all intent execution. Here's the enforcement sequence:

```typescript
async submit(intent: { goal: string; owner?: string; ... }): Promise<Intent> {
  const owner = intent.owner || 'system';

  // 1. Permission check
  if (owner !== 'system') {
    const permCheck = this.identity.checkPermission({
      identityId: owner,
      resource: 'intent',
      action: 'submit',
    });
    if (!permCheck.granted) {
      throw new Error(`Permission denied: ${permCheck.reason}`);
    }
  }

  // 2. Budget check
  const budgetCheck = this.budget.check(owner);
  if (!budgetCheck.allowed) {
    throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
  }

  // 3. Rate limit check
  if (!this.rateLimiter.consume('identity', owner)) {
    throw new Error('Rate limit exceeded. Try again later.');
  }

  // ... intent creation and execution
}
```

The `system` actor bypasses permission checks (it's always trusted), but budget and rate limits still apply to prevent runaway loops.

During execution, tools are further gated by the sandbox — even if an identity has `tool:execute:*` permission, the sandbox can still deny specific tool calls or file paths.

---

## Security Auditor

The `SecurityAuditor` runs automated checks against your running kernel and produces a scored report with actionable findings.

### Running an Audit

```typescript
const result = kernel.securityAuditor.audit(kernel);

console.log(`Security Score: ${result.score}/100`);
console.log(`Passed: ${result.passed}, Failed: ${result.failed}`);

for (const finding of result.findings) {
  console.log(`[${finding.severity}] ${finding.message}`);
  console.log(`  → ${finding.recommendation}`);
}
```

### Built-in Checks

| Check | Category | Severity | What It Catches |
|-------|----------|----------|-----------------|
| `auth-anonymous` | permissions | high | Anonymous gateway access in production |
| `rate-limits-missing` | rate-limits | medium | Default rate limits with no custom rules |
| `no-agents-registered` | config | low | No agents available to handle intents |
| `no-model-provider` | config | critical | No LLM provider configured |
| `debug-in-production` | config | medium | Trajectory recording on in production |

### Custom Checks

```typescript
kernel.securityAuditor.addCheck({
  id: 'api-keys-no-expiry',
  name: 'API Keys Without Expiry',
  description: 'Checks for API keys that never expire',
  category: 'permissions',
  check: (k) => {
    const keys = k.identity.apiKeys.listActive();
    const noExpiry = keys.filter(key => !key.expiresAt);
    if (noExpiry.length > 0) {
      return {
        checkId: 'api-keys-no-expiry',
        severity: 'medium',
        message: `${noExpiry.length} API key(s) have no expiration date`,
        recommendation: 'Set ttlSeconds when creating keys to ensure rotation',
        details: { keys: noExpiry.map(k => k.prefix) },
      };
    }
    return null;
  },
});
```

### Listing Registered Checks

```typescript
const checks = kernel.securityAuditor.listChecks();
// [{ id: 'auth-anonymous', name: '...', category: 'permissions' }, ...]
```

---

## Best Practices

**Least privilege by default.** Give identities the minimum role they need. Use `viewer` for dashboards, `agent` for AI actors, and reserve `admin` for operators who manage the system.

**Always scope API keys.** Never create a key with `['*']` permissions. Enumerate the exact permissions the key needs and set a TTL.

**Rotate keys regularly.** Set `ttlSeconds` on all API keys. Use the `lastUsedAt` field to identify stale keys and revoke them.

**Use sessions for interactive access, keys for programmatic access.** Sessions have short TTLs and auto-expire. Keys are for long-lived service-to-service auth.

**Restrict sandbox policies per agent.** Don't rely on the default policy for production agents. Explicitly set `allowedTools`, `deniedPaths`, and `timeoutMs` for each agent context.

**Run audits in CI.** Add `kernel.securityAuditor.audit()` to your test suite. Fail the build if the score drops below your threshold or if any `critical` finding appears.

**Invalidate sessions on security events.** If you detect suspicious activity, call `sessions.invalidateAll(identityId)` and `deactivate(identityId)` to lock the account.

**Use organizations for multi-tenant isolation.** Each org gets its own member set and role assignments. Identities can only access resources within their org boundary.

**Monitor permission denials.** Subscribe to `identity.permission.denied` events on the EventBus to detect unauthorized access attempts and potential misconfiguration.

```typescript
kernel.events.subscribe((event) => {
  if (event.eventType === 'identity.permission.denied') {
    console.warn(`[SECURITY] Denied: ${event.data.identityId} → ${event.data.required}`);
  }
});
```
