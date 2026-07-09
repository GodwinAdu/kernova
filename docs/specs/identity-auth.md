# Spec: Identity & Authentication System

## Summary

Implement Pillars 1 (Identity) and 2 (Trust) — user authentication, API key management, role-based permissions, agent permission enforcement, and organization support.

## Problem

Currently everything runs as "system" with no access control. Any agent can access any memory, any tool, any resource. This is unacceptable for production use.

## Design

### Components

```
┌─────────────────────────────────────────────┐
│              Identity System                  │
├─────────────────────────────────────────────┤
│  API Key Manager     → Generate, validate    │
│  Session Manager     → Create, verify, expire│
│  Permission Engine   → Check access rules    │
│  Role Manager        → Assign, resolve       │
│  Organization Manager → Teams, membership    │
└─────────────────────────────────────────────┘
```

### Authentication Methods

1. **API Keys** — For programmatic access (SDK, CLI, external services)
2. **Sessions** — For Studio/web dashboard access
3. **Internal** — For agent-to-agent and system calls

### Permission Model

```
Identity (user/agent/service)
   → has Roles (admin, developer, agent, viewer)
      → has Permissions (resource:action)
         → checked before every operation
```

### Permission Format

```
resource:action
memory:read
memory:write
intent:submit
agent:execute
tool:*
workflow:approve
```

### API Keys

- Generated with prefix: `nxs_` (Nexus secret)
- Hashed with SHA-256 before storage
- Scoped to permissions (can't exceed creator's permissions)
- Expirable (optional TTL)

### Enforcement Points

- Intent submission → check `intent:submit`
- Memory read/write → check `memory:read` / `memory:write`
- Tool execution → check `tool:execute:{toolId}`
- Agent creation → check `agent:manage`
- Workflow approval → check `workflow:approve`
- Studio access → check `studio:access`

## Success Criteria

- [ ] API keys can be generated and validated
- [ ] Permissions are checked before operations
- [ ] Agents have scoped permissions
- [ ] Organizations group users and resources
- [ ] Studio requires authentication
- [ ] All auth events are logged
