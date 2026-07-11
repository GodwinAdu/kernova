# Observability & Operations

Production monitoring, metrics, health checks, security auditing, and operational tooling.

## Metrics Collector

Automatic performance metrics collection from the EventBus. Tracks intent throughput, latency percentiles, token usage, and error rates.

### Automatic Collection

Metrics are collected automatically when the kernel starts:

```typescript
const kernel = new NexusKernel({ environment: 'production' });
await kernel.start();
// Metrics are now being collected from all EventBus events

// Get a snapshot at any time
const metrics = kernel.metrics.snapshot();
console.log(metrics);
// {
//   timestamp: '2026-07-10T...',
//   uptime: 3600000,
//   intents: {
//     total: 1250,
//     succeeded: 1180,
//     failed: 70,
//     active: 3,
//     avgDurationMs: 2340,
//     p95DurationMs: 8500,
//   },
//   tokens: {
//     total: 450000,
//     last5min: 12000,
//   },
//   models: {
//     requestCount: 1250,
//     avgLatencyMs: 1200,
//     errorRate: 0.02,
//   },
//   agents: { registered: 5, activeInstances: 3 }
// }
```

### Custom Metrics

Record custom metrics for your application:

```typescript
kernel.metrics.record('custom.order.processed', 1, { region: 'us-east' });
kernel.metrics.record('custom.cache.hit_rate', 0.85);
```

### Exposing Metrics

Expose metrics via the gateway health endpoint or build a Prometheus-compatible exporter:

```typescript
// Simple JSON metrics endpoint (via gateway)
// GET /health already includes basic status

// For Prometheus, build a custom scrape endpoint:
import { createServer } from 'http';

createServer((req, res) => {
  if (req.url === '/metrics') {
    const snap = kernel.metrics.snapshot();
    const lines = [
      `kernova_intents_total ${snap.intents.total}`,
      `kernova_intents_succeeded ${snap.intents.succeeded}`,
      `kernova_intents_failed ${snap.intents.failed}`,
      `kernova_intent_duration_avg_ms ${snap.intents.avgDurationMs}`,
      `kernova_intent_duration_p95_ms ${snap.intents.p95DurationMs}`,
      `kernova_tokens_total ${snap.tokens.total}`,
      `kernova_model_requests_total ${snap.models.requestCount}`,
      `kernova_model_error_rate ${snap.models.errorRate}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(lines.join('\n'));
  }
}).listen(9090);
```

---

## Health Monitor

Configurable health check system with probe registration and state change alerting.

### Built-in Checks

The kernel registers two health checks automatically:
- `kernel` — Is the kernel running?
- `providers` — Are model providers available?

### Custom Health Checks

```typescript
// Add a database health check
kernel.health.addCheck({
  id: 'database',
  name: 'Database Connection',
  check: async () => {
    try {
      await db.query('SELECT 1');
      return { state: 'healthy', message: 'Connected' };
    } catch (error) {
      return { state: 'unhealthy', message: error.message };
    }
  },
});

// Add an external API check
kernel.health.addCheck({
  id: 'openai-api',
  name: 'OpenAI API',
  check: async () => {
    const start = Date.now();
    try {
      await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      return { state: 'healthy', latencyMs: Date.now() - start };
    } catch {
      return { state: 'degraded', message: 'API unreachable' };
    }
  },
});
```

### Running Health Checks

```typescript
// Manual check
const status = await kernel.health.check();
console.log(status.overall);   // 'healthy' | 'degraded' | 'unhealthy'
console.log(status.checks);    // Per-check details

// Periodic polling (e.g., every 30 seconds)
const monitor = new HealthMonitor(kernel.events, {
  intervalMs: 30_000,
  onStateChange: (oldState, newState) => {
    if (newState === 'unhealthy') {
      sendAlert(`System health degraded: ${oldState} → ${newState}`);
    }
  },
});
monitor.startPolling();

// Stop polling on shutdown
monitor.stopPolling();
```

### Health States

| State | Meaning |
|-------|---------|
| `healthy` | All checks pass |
| `degraded` | Some checks report degraded performance |
| `unhealthy` | One or more critical checks fail |
| `unknown` | No checks have run yet |

---

## Security Auditor

Run automated security scans against your agent configuration to detect misconfigurations before they become vulnerabilities.

### Running an Audit

```typescript
const result = kernel.securityAuditor.audit(kernel);

console.log(`Security Score: ${result.score}/100`);
console.log(`Passed: ${result.passed}, Failed: ${result.failed}`);

for (const finding of result.findings) {
  console.log(`[${finding.severity.toUpperCase()}] ${finding.message}`);
  console.log(`  → ${finding.recommendation}`);
}
```

Example output:
```
Security Score: 60/100
Passed: 3, Failed: 2

[HIGH] Gateway allows anonymous access in production
  → Set auth.allowAnonymous=false and configure bearer tokens

[MEDIUM] Using default rate limits — no custom rules configured
  → Add per-identity and per-provider rate limit rules
```

### Built-in Checks

| Check | Severity | What It Detects |
|-------|----------|-----------------|
| `auth-anonymous` | High | Anonymous access enabled in production |
| `rate-limits-missing` | Medium | No custom rate limit rules |
| `no-agents-registered` | Low | No agents available to handle intents |
| `no-model-provider` | Critical | No model providers configured |
| `debug-in-production` | Medium | Trajectory recording on in production |

### Custom Checks

```typescript
kernel.securityAuditor.addCheck({
  id: 'custom-secret-exposure',
  name: 'API Keys in Config',
  description: 'Checks if API keys are hardcoded in config',
  category: 'secrets',
  check: (kernel) => {
    const config = kernel.configManager.getAll();
    const configStr = JSON.stringify(config);
    if (/sk-[a-zA-Z0-9]{20,}/.test(configStr)) {
      return {
        checkId: 'custom-secret-exposure',
        severity: 'critical',
        message: 'API key found in configuration — use environment variables instead',
        recommendation: 'Move secrets to environment variables or a secrets manager',
      };
    }
    return null;
  },
});
```

### Continuous Auditing

Run audits on a schedule:

```typescript
// Run audit every hour
kernel.scheduler.register({
  name: 'security-audit',
  cronExpression: '0 * * * *',
  target: {
    type: 'intent',
    goal: 'Run security audit and report findings',
  },
});
```

---

## Plugin Marketplace

Discover, install, and manage plugins from a registry.

### Searching Plugins

```typescript
const results = await kernel.marketplace.search('database');
// Returns plugins matching "database" in name, description, or keywords

for (const plugin of results) {
  console.log(`${plugin.name} v${plugin.version} - ${plugin.description}`);
  console.log(`  Installed: ${plugin.installed}`);
}
```

### Installing Plugins

```typescript
// Install a plugin
const installed = await kernel.marketplace.install('kernova-plugin-postgres', '1.2.0');
console.log(`Installed ${installed.name} v${installed.version}`);

// List installed plugins
const plugins = kernel.marketplace.listInstalled();
```

### Updating & Uninstalling

```typescript
// Update to latest
await kernel.marketplace.update('kernova-plugin-postgres');

// Uninstall
await kernel.marketplace.uninstall('kernova-plugin-postgres');
```

### Adding to Registry (Development)

For local development, add plugin listings directly:

```typescript
kernel.marketplace.addToRegistry({
  id: 'my-custom-plugin',
  name: 'My Custom Plugin',
  description: 'Does something amazing',
  version: '0.1.0',
  author: 'me',
  keywords: ['custom', 'tools'],
  installed: false,
});
```

---

## Hot Reloader

Watch files for changes and trigger live reloads without restarting.

### Configuration File Watching

```typescript
import { HotReloader } from '@kernova/core';

const reloader = new HotReloader(kernel.events, {
  watchPaths: ['./config', './agents'],
  debounceMs: 500,
});

// React to config file changes
reloader.on('*.json', async (filePath) => {
  const config = JSON.parse(await readFile(filePath, 'utf-8'));
  kernel.configManager.reload(config);
  console.log(`Config reloaded from ${filePath}`);
});

// React to agent file changes
reloader.on('*.ts', async (filePath) => {
  console.log(`Agent file changed: ${filePath}`);
  // Re-import and re-register agent
});

reloader.start();
// Now changes to ./config/*.json will auto-reload

// Stop when shutting down
reloader.stop();
```

### Patterns

| Pattern | Matches |
|---------|---------|
| `*.json` | Any JSON file |
| `*.ts` | Any TypeScript file |
| `config.*` | Files starting with "config" |
| `*` | Everything |
| `agents.ts` | Exact filename |

---

## Complete Operational Setup Example

```typescript
import { NexusKernel, defineAgent, HotReloader } from '@kernova/core';

const kernel = new NexusKernel({
  environment: 'production',
  dataDir: './data',
});
await kernel.start();

// Register agents
const agent = defineAgent({ name: 'assistant', ... });
kernel.agentRegistry.register(agent.definition, agent.executor);

// Configure rate limits
kernel.rateLimiter.addRule({
  id: 'user', scope: 'identity', key: '*',
  maxRequests: 30, windowMs: 60_000,
});

// Start the gateway
await kernel.gateway.start();

// Set up health monitoring
kernel.health.addCheck({ id: 'db', name: 'DB', check: checkDb });
kernel.health.startPolling();

// Run security audit
const audit = kernel.securityAuditor.audit(kernel);
if (audit.score < 80) {
  console.warn(`Security score: ${audit.score}/100 — review findings`);
}

// Watch for config changes
const reloader = new HotReloader(kernel.events, { watchPaths: ['./config'] });
reloader.on('*.json', async (f) => {
  kernel.configManager.reload(JSON.parse(await readFile(f, 'utf-8')));
});
reloader.start();

// Log metrics periodically
setInterval(() => {
  const m = kernel.metrics.snapshot();
  console.log(`[Metrics] Intents: ${m.intents.total} | Tokens: ${m.tokens.total} | p95: ${m.intents.p95DurationMs}ms`);
}, 60_000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  reloader.stop();
  await kernel.stop();
  process.exit(0);
});
```
