# NP-006: Identity Protocol

**Version:** 0.1.0  
**Status:** Draft

## Abstract

Defines authentication, authorization, and identity management for the Nexus Protocol.

## Identity Object

```json
{
  "id": "user_uuid",
  "type": "user | agent | service | system",
  "name": "Alice",
  "email": "alice@example.com",
  "organizationId": "org_uuid | null",
  "roles": ["developer"],
  "active": true,
  "createdAt": "ISO8601"
}
```

## Authentication Methods

### API Keys

- Format: `nxs_{64_hex_chars}`
- Storage: SHA-256 hash only (never plaintext)
- Scoped to permissions
- Optional TTL/expiry

```
Authorization: Bearer nxs_abc123...
```

### Sessions

- Token-based (32 random hex bytes)
- Configurable TTL (default: 24 hours)
- Tied to an identity and permission set

## Authorization

### Permission Format

```
resource:action

Examples:
  memory:read
  memory:write
  intent:submit
  agent:execute
  tool:execute:math:calculate
  workflow:approve
  studio:access
  *  (superuser)
```

### Built-in Roles

| Role | Permissions |
|---|---|
| `admin` | `*` (all) |
| `developer` | intent:*, memory:*, agent:execute, tool:*, workflow:*, event:read, studio:access |
| `agent` | memory:read, memory:write, tool:execute:*, event:emit |
| `viewer` | intent:read, memory:read, agent:read, event:read, studio:access |

### Permission Check

```
POST /auth/check
{ "identityId": "...", "resource": "memory", "action": "write" }

→ 200 OK
{ "granted": true, "matchedRule": "memory:write" }
```

## Organizations

```json
{
  "id": "org_uuid",
  "name": "Nexus Labs",
  "slug": "nexus-labs",
  "ownerId": "user_uuid",
  "members": ["user_uuid", "user_uuid"]
}
```

## Budget & Governance

- Global token budgets
- Per-identity daily/hourly limits
- Rate limiting (requests per minute)
- Cost estimation and caps
- All enforcement emits `governance.budget.exceeded` events
