# ADR-009: Identity & Auth System

## Status
Accepted

## Date
July 8, 2026

## Context

Kernova needs authentication and authorization to protect resources. Without it, any client can access any memory, execute any tool, and submit intents without accountability.

## Decision

Implement a layered identity system:

1. **API Keys** — For programmatic access (SDK calls, CLI, external services)
   - Format: `nxs_{random_64_hex}`
   - Stored as SHA-256 hashes (never plaintext)
   - Scoped to specific permissions
   - Optional TTL/expiry

2. **Sessions** — For web dashboard (Studio) access
   - Token-based with configurable TTL
   - Tied to an identity
   - Can be invalidated

3. **Roles** — Predefined permission bundles
   - admin: full access (`*`)
   - developer: standard development access
   - agent: AI agent access (memory, tools, events)
   - viewer: read-only

4. **Permissions** — Fine-grained access control
   - Format: `resource:action` (e.g., `memory:read`)
   - Supports wildcards (`tool:*`, `*`)
   - Checked at every operation boundary

5. **Organizations** — Group identities and scope resources

## Consequences

### Easier
- Secure multi-tenant deployments
- Agent sandboxing (agents can't access everything)
- Audit trail (who did what)
- Team collaboration with scoped access

### Harder
- Every operation needs auth context
- Key management complexity
- Testing requires auth setup
