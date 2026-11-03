---
title: Security & Operations
description: Rate limiting, sandboxing, auth profiles, config management, metrics, and health monitoring.
---

Production-ready security, observability, and operational tooling for Kernova deployments.

## Rate Limiting

Protect your system from abuse and runaway costs with token-bucket rate limiting.

```typescript
// Per-user: 30 requests per minute
kernel.rateLimiter.addRule({
  id: 'user-limit',
  scope: 'identity',
  key: '*',
  maxRequests: 30,
  windowMs: 60_000,
  burstAllowance: 5,  // Allow short bursts of 35
});

// Per-provider: protect API quotas
kernel.rateLimiter.addRule({
  id: 'openai-quota',
  scope: 'provider',
  key: 'openai',
  maxRequests: 200,
  windowMs: 60_000,
});

// Global: system-wide safety net
kernel.rateLimiter.addRule({
  id: 'global-safety',
  scope: 'global',
  key: '*',
  maxRequests: 1000,
  windowMs: 60_000,
});
```

Rate limits are **automatically enforced** on every `kernel.submit()` call. When exceeded:
```
Error: Rate limit exceeded. Try again later.
```

### Manual Checks

```typescript
const check = kernel.rateLimiter.check('identity', 'user_abc');
// { allowed: true, remaining: 25, resetAt: 1720000060000 }

// Or if rate limited:
// { allowed: false, remaining: 0, resetAt: ..., retryAfterMs: 23000 }
```

---

## Sandbox Manager

Restrict what agents can do during tool execution — filesystem access, network, and tool permissions.

```typescript
// Create a restricted sandbox for untrusted agents
const ctx = kernel.sandbox.createContext('agent_untrusted', {
  allowedPaths: ['./workspace', './uploads'],
  deniedPaths: ['../', '/etc', 'C:\\Windows'],
  allowedTools: ['read_file', 'search', 'write_file'],
  deniedTools: ['exec', 'shell', 'rm', 'delete'],
  timeoutMs: 10_000,      // 10s max per tool call
  allowNetwork: false,     // No outbound requests
  allowWrite: true,        // Can create/modify files (within allowed paths)
});

// Before tool execution, check permissions:
kernel.sandbox.isPathAllowed(ctx.id, './workspace/report.md');  // true
kernel.sandbox.isPathAllowed(ctx.id, '../../etc/passwd');        // false ← BLOCKED
kernel.sandbox.isToolAllowed(ctx.id, 'search');                  // true
kernel.sandbox.isToolAllowed(ctx.id, 'exec');                    // false ← BLOCKED

// Clean up
kernel.sandbox.destroy(ctx.id);
```

### What Gets Blocked

- **Path traversal** — Any path resolving outside the workspace directory
- **System directories** — `/etc`, `/usr`, `C:\Windows`, etc.
- **Denied tools** — Tools explicitly listed in `deniedTools`
- **Unlisted tools** — If `allowedTools` is set, anything not in the list is blocked

---

## Auth Profile Manager

Manage multiple API keys per provider with automatic rotation and rate-limit recovery.

```typescript
// Add multiple keys for the same provider
kernel.authProfiles.add('openai', 'Primary', process.env.OPENAI_KEY_1!, 10);   // priority 10
kernel.authProfiles.add('openai', 'Backup', process.env.OPENAI_KEY_2!, 5);    // priority 5
kernel.authProfiles.add('openai', 'Free Tier', process.env.OPENAI_KEY_3!, 1); // priority 1

// Get a key (highest-priority available, round-robin)
const key = kernel.authProfiles.getKey('openai');
// Returns the Primary key first

// When a key hits a rate limit:
kernel.authProfiles.markRateLimited(profileId);
// Next getKey() call will return the Backup key
// Primary goes on 60s cooldown (doubles on consecutive failures)

// After successful use:
kernel.authProfiles.markSuccess(profileId);
// Resets failure counter
```

### Why This Matters

Without key rotation:
- One rate limit = entire system stops
- One expired key = downtime

With auth profiles:
- Rate limit on key A → instantly switch to key B
- Key A cools down → auto-returns to rotation
- All keys exhausted → errors propagate (circuit breaker)

---

## Config Manager

Layered configuration with environment variable support, hot reload, and change watching.

### Layer Precedence

```
defaults (lowest) → file config → env variables → runtime overrides (highest)
```

```typescript
// Read config
const provider = kernel.configManager.get('models.default.provider');    // 'openai'
const timeout = kernel.configManager.getOrDefault('tools.timeout', 30000); // 30000

// Override at runtime (highest priority)
kernel.configManager.set('models.default.provider', 'anthropic');

// Environment variables auto-loaded with KERNOVA_ prefix:
// KERNOVA_MODELS__DEFAULT__PROVIDER=openai → models.default.provider
```

### Hot Reload

```typescript
import { readFileSync, watchFile } from 'fs';

// Watch config file for changes
watchFile('./kernova.config.json', () => {
  const config = JSON.parse(readFileSync('./kernova.config.json', 'utf-8'));
  kernel.configManager.reload(config);
  // Emits config.changed events for each modified path
});
```

### Watching for Changes

```typescript
// React when a specific config changes
const unwatch = kernel.configManager.watch('models.default.provider', (newProvider) => {
  console.log(`Provider changed to: ${newProvider}`);
});

// Stop watching
unwatch();
```

---

## Metrics Collector

Automatic performance tracking from all kernel events.

```typescript
// Metrics are collected automatically. Get a snapshot anytime:
const m = kernel.metrics.snapshot();

console.log(`Intents: ${m.intents.total} total, ${m.intents.active} active`);
console.log(`Success rate: ${(m.intents.succeeded / m.intents.total * 100).toFixed(1)}%`);
console.log(`Avg latency: ${m.intents.avgDurationMs}ms, p95: ${m.intents.p95DurationMs}ms`);
console.log(`Tokens: ${m.tokens.total} total, ${m.tokens.last5min} last 5 min`);
console.log(`Model errors: ${(m.models.errorRate * 100).toFixed(1)}%`);
```

### Expose as Prometheus Metrics

```typescript
import { createServer } from 'http';

createServer((req, res) => {
  if (req.url === '/metrics') {
    const s = kernel.metrics.snapshot();
    res.end([
      `kernova_intents_total ${s.intents.total}`,
      `kernova_intents_active ${s.intents.active}`,
      `kernova_intent_duration_p95_ms ${s.intents.p95DurationMs}`,
      `kernova_tokens_total ${s.tokens.total}`,
      `kernova_model_error_rate ${s.models.errorRate}`,
    ].join('\n'));
  }
}).listen(9090);
```

---

## Health Monitor

Probe-based health checking with state change detection.

```typescript
// Add custom health probes
kernel.health.addCheck({
  id: 'database',
  name: 'Database',
  check: async () => {
    const start = Date.now();
    try {
      await db.query('SELECT 1');
      return { state: 'healthy', latencyMs: Date.now() - start };
    } catch (e) {
      return { state: 'unhealthy', message: e.message };
    }
  },
});

// Run all checks
const status = await kernel.health.check();
console.log(`Overall: ${status.overall}`); // 'healthy' | 'degraded' | 'unhealthy'
for (const c of status.checks) {
  console.log(`  ${c.name}: ${c.state} (${c.latencyMs}ms)`);
}
```

---

## Security Auditor

Automated security scanning to catch misconfigurations.

```typescript
const audit = kernel.securityAuditor.audit(kernel);

console.log(`Security Score: ${audit.score}/100`);
for (const finding of audit.findings) {
  console.log(`[${finding.severity}] ${finding.message}`);
  console.log(`  Fix: ${finding.recommendation}`);
}
```

### Built-in Checks

| Check | What It Catches |
|-------|----------------|
| Anonymous access in production | Gateway has no auth configured |
| Missing rate limits | No custom rate limit rules |
| No model provider | Agents can't generate responses |
| Debug mode in production | Trajectory may leak data |
| No agents registered | System can't handle intents |

### Add Custom Checks

```typescript
kernel.securityAuditor.addCheck({
  id: 'env-secrets',
  name: 'Secrets in Environment',
  description: 'Checks that API keys are properly scoped',
  category: 'secrets',
  check: (kernel) => {
    // Your custom logic
    return null; // null = passed
  },
});
```

---

## Complete Production Setup

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'production', dataDir: '/data/kernova' });
await kernel.start();

// 1. Register agents
kernel.agentRegistry.register(assistantAgent.definition, assistantAgent.executor);

// 2. Security: rate limits + auth
kernel.rateLimiter.addRule({ id: 'user', scope: 'identity', key: '*', maxRequests: 30, windowMs: 60_000 });
kernel.authProfiles.add('openai', 'Primary', process.env.OPENAI_KEY_1!, 10);
kernel.authProfiles.add('openai', 'Backup', process.env.OPENAI_KEY_2!, 5);

// 3. Start gateway with auth
await kernel.gateway.start(); // Token from KERNOVA_API_KEY or KernelConfig.gateway.auth.tokens

// 4. Health monitoring
kernel.health.addCheck({ id: 'db', name: 'DB', check: checkDatabase });

// 5. Security audit
const audit = kernel.securityAuditor.audit(kernel);
if (audit.score < 70) console.warn(`⚠️  Security score: ${audit.score}/100`);

// 6. Graceful shutdown
process.on('SIGTERM', async () => {
  await kernel.stop();
  process.exit(0);
});
```
