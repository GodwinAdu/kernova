---
title: "NP-006: Identity Protocol"
description: Authentication, authorization, and access control.
---

# NP-006: Identity Protocol

**Version:** 0.1.0 | **Status:** Draft

## Authentication

- **API Keys** — `nxs_{64_hex}`, SHA-256 hashed, scoped
- **Sessions** — Token-based, TTL, tied to identity

## Permission Format

```
resource:action
memory:read | intent:submit | tool:execute:* | *
```

## Roles

| Role | Access |
|------|--------|
| admin | `*` |
| developer | Standard dev access |
| agent | Memory + tools |
| viewer | Read-only |

## Organizations

Group identities. Scope resources. Assign roles per org.
