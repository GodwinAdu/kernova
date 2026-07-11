---
title: "Daemon Mode"
description: Run Kernova as a persistent background service — signal handling, heartbeat, agent config loading, hot-reload, and graceful shutdown.
---

Most applications need Kernova to start, stay running, and shut down cleanly — surviving deploys, handling restarts, and loading agent configurations from disk without downtime. Daemon mode wraps the kernel in a production-ready lifecycle manager that handles all of this automatically.

The `DaemonRunner` (from `packages/core/src/daemon/index.ts`) is a thin wrapper over `KernovaKernel` that adds:

- **Signal handling** — Catches SIGINT and SIGTERM for graceful shutdown
- **Heartbeat emission** — Periodic health pulse with uptime and active intent counts
- **Agent config loading** — Reads agent definitions from YAML/JSON files on disk
- **Hot-reload** — Watches config files for changes and re-registers agents without restart
- **Graceful shutdown** — Waits for active intents to complete before stopping the kernel

---

## When to Use Daemon Mode

Use daemon mode when:

- Running Kernova as a long-lived background service (servers, workers, cron hosts)
- Deploying with systemd, Docker, PM2, or any process manager that sends signals
- Managing agents via config files that ops teams can edit without code changes
- You need zero-downtime agent updates via hot-reload

For short-lived scripts, tests, or serverless functions, use the kernel directly without the daemon wrapper.

---

## Quick Start

### Programmatic

```typescript
import { KernovaKernel } from '@kernova/core';
import { DaemonRunner } from '@kernova/core/daemon';

const kernel = new KernovaKernel({
  ephemeral: false,
  dataDir: '/var/lib/kernova/data',
  environment: 'production',
});
await kernel.start();

const daemon = new DaemonRunner(kernel, {
  configPath: './agents/',
  watch: true,
  heartbeatIntervalMs: 30000,
  shutdownTimeoutMs: 15000,
});

// start() returns a promise that resolves when the daemon stops
await daemon.start();
// Process keeps running until SIGINT/SIGTERM or daemon.stop() is called
```

### CLI

```bash
# Start daemon with default settings
kernova daemon

# Start with a specific config directory and hot-reload enabled
kernova daemon --config ./agents/ --watch

# Override shutdown timeout and heartbeat interval
kernova daemon --config ./agents/ --watch --shutdown-timeout 15000 --heartbeat 30000

# Specify data directory and port
kernova daemon --config ./agents/ --data-dir /var/lib/kernova --port 8080
```

---

## DaemonConfig Reference

```typescript
interface DaemonConfig {
  /** Path to agent config file or directory */
  configPath?: string;

  /** Enable hot-reload of config files (default: false) */
  watch?: boolean;

  /** Port for webhook/gateway listeners */
  port?: number;

  /** Data directory override */
  dataDir?: string;

  /** Graceful shutdown timeout in milliseconds (default: 30000) */
  shutdownTimeoutMs?: number;

  /** Heartbeat interval in milliseconds (default: 60000) */
  heartbeatIntervalMs?: number;
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `configPath` | `undefined` | File or directory path to load agent configs from |
| `watch` | `false` | Watch config files and re-register agents on change |
| `port` | `undefined` | Port for webhook listeners (channels, gateways) |
| `dataDir` | `undefined` | Override the kernel's data directory |
| `shutdownTimeoutMs` | `30000` | Max time to wait for active intents during shutdown |
| `heartbeatIntervalMs` | `60000` | Interval between heartbeat event emissions |

---

## Agent Config Loading

The daemon loads agent definitions from YAML or JSON config files at startup. This allows ops teams to manage agents without touching application code.

### Single File

```typescript
const daemon = new DaemonRunner(kernel, {
  configPath: './agents/support-bot.agent.yaml',
});
```

### Directory (Multiple Agents)

```typescript
const daemon = new DaemonRunner(kernel, {
  configPath: './agents/',  // Discovers all .agent.yaml / .agent.json files
});
```

The daemon uses `discoverAgentConfigFiles()` to find all valid agent config files in the path. It supports the `extends` field for config inheritance — a base config can define shared tools and instructions that specialized agents extend.

### Loading Behavior

1. Each config file is parsed with `loadAgentConfigWithExtends()` (resolves inheritance)
2. A `defineAgent()` call creates the agent definition and executor
3. The agent is registered with the kernel's `agentRegistry`
4. Schedules and triggers from the config are registered with the kernel's scheduler and trigger system
5. Each agent gets a stable ID (`config-agent-{name}`) for hot-reload re-registration

### Error Handling

If a config file fails to parse, the daemon:

- Emits a `daemon.config.error` event with the file path and error message
- Skips that file and continues loading the rest
- Does **not** crash or stop other agents from loading

```typescript
kernel.events.subscribe('daemon.config.error', (event) => {
  console.error(`Failed to load ${event.data.filePath}: ${event.data.error}`);
});
```

### Inspecting Loaded Configs

```typescript
const configs = daemon.getLoadedConfigs();
// Map<string, AgentConfigFile> — keyed by absolute file path

for (const [filePath, config] of configs) {
  console.log(`${config.name} loaded from ${filePath}`);
}
```

---

## Hot-Reload

When `watch: true`, the daemon monitors config files for changes and automatically re-registers agents without restarting the process.

### What Gets Watched

- **Individual config files** — Each discovered `.agent.yaml` / `.agent.json` file
- **Parent directory** — Detects new files added or existing files deleted

### Debouncing

File change events are debounced per-file with a 100ms window. Rapid saves (e.g., editor auto-save) trigger only a single reload.

### Change Scenarios

| Scenario | Behavior |
|----------|----------|
| File modified | Re-parse, re-register agent with same stable ID |
| File deleted | Unregister agent from kernel, emit `daemon.agent.unregistered` |
| New file added | Detect via directory watcher, parse and register new agent |
| Parse error on change | Keep old agent definition active, emit `daemon.config.error` |
| Agent renamed in file | Unregister old name, register under new name |

### Parse Error Safety

Hot-reload is safe by default. If a modified config file has a syntax error or invalid structure, the daemon keeps the **previous working definition** active and emits an error event. Your agents never go down because of a typo in a config edit.

```typescript
// Typo in YAML won't crash the running agent
kernel.events.subscribe('daemon.config.error', (event) => {
  console.warn(`Config error in ${event.data.filePath}: ${event.data.error}`);
  console.warn(`Keeping old definition: ${event.data.keepingOld}`);
});
```

### File Deletion Handling

When a config file is deleted, the corresponding agent is unregistered from the kernel immediately:

```typescript
kernel.events.subscribe('daemon.agent.unregistered', (event) => {
  console.log(`Agent "${event.data.name}" removed (reason: ${event.data.reason})`);
});
```

---

## Heartbeat Events

The daemon emits periodic heartbeat events on the kernel's EventBus. Use these for health monitoring, alerting, and dashboard metrics.

### Event Shape

```typescript
// Event type: 'daemon.heartbeat'
{
  uptime: number;           // Process uptime in seconds (process.uptime())
  activeIntents: number;    // Currently executing intents
  registeredAgents: number; // Total registered agent count
  running: boolean;         // Kernel running status
}
```

### Subscribing to Heartbeats

```typescript
kernel.events.subscribe('daemon.heartbeat', (event) => {
  const { uptime, activeIntents, registeredAgents } = event.data;
  
  // Push to monitoring system
  metrics.gauge('kernova.uptime', uptime);
  metrics.gauge('kernova.active_intents', activeIntents);
  metrics.gauge('kernova.registered_agents', registeredAgents);
  
  // Alert if too many concurrent intents
  if (activeIntents > 50) {
    alerting.warn('High intent concurrency', { activeIntents });
  }
});
```

### Interval Configuration

```typescript
// High-frequency for development / debugging
const daemon = new DaemonRunner(kernel, { heartbeatIntervalMs: 5000 });

// Low-frequency for production (default: 60s)
const daemon = new DaemonRunner(kernel, { heartbeatIntervalMs: 60000 });
```

The heartbeat timer is `unref()`'d — it won't prevent Node.js from exiting if the daemon has already stopped.

---

## Graceful Shutdown

When the daemon receives a stop signal, it doesn't kill the process immediately. Instead, it follows a controlled shutdown sequence that gives active work time to complete.

### Shutdown Flow

```
Signal received (SIGINT / SIGTERM)
    │
    ├─→ Emit 'daemon.stopping' event
    │
    ├─→ Stop heartbeat timer
    │
    ├─→ Stop file watchers (if hot-reload enabled)
    │
    ├─→ Remove signal handlers
    │
    ├─→ Wait for active intents to drain (poll every 250ms)
    │     └─ Up to shutdownTimeoutMs (default: 30s)
    │
    ├─→ If timeout reached: emit 'daemon.shutdown.timeout', force continue
    │
    ├─→ kernel.stop()
    │
    ├─→ Emit 'daemon.stopped' event
    │
    └─→ Resolve start() promise → process exits
```

### Timeout Behavior

If active intents don't complete within `shutdownTimeoutMs`, the daemon emits a `daemon.shutdown.timeout` event and proceeds with `kernel.stop()` anyway. This prevents hung intents from blocking deployment.

```typescript
kernel.events.subscribe('daemon.shutdown.timeout', (event) => {
  console.warn(
    `Shutdown timeout: ${event.data.activeIntents} intents still active after ${event.data.timeoutMs}ms`
  );
});
```

### Programmatic Stop

You can stop the daemon programmatically without waiting for a signal:

```typescript
// Graceful stop from application code
await daemon.stop();

// Check state
console.log(daemon.isRunning()); // false
```

---

## Events Reference

The daemon emits the following events on the kernel's EventBus. All events have `category: 'system'`, `severity: 'info'`, and `subjectId: 'daemon'`.

| Event Type | Data | When |
|------------|------|------|
| `daemon.started` | `{ heartbeatIntervalMs, shutdownTimeoutMs }` | Daemon has started successfully |
| `daemon.stopping` | `{ shutdownTimeoutMs }` | Shutdown sequence initiated |
| `daemon.stopped` | `{}` | Daemon fully stopped, kernel stopped |
| `daemon.heartbeat` | `{ uptime, activeIntents, registeredAgents, running }` | Periodic health pulse |
| `daemon.shutdown.timeout` | `{ activeIntents, timeoutMs }` | Graceful shutdown exceeded timeout |
| `daemon.config.error` | `{ filePath, error, keepingOld? }` | Config file failed to parse |
| `daemon.config.reloaded` | `{ filePath, agentName }` | Config file hot-reloaded successfully |
| `daemon.configs.loaded` | `{ count, files }` | Initial config loading completed |
| `daemon.agent.registered` | `{ name, filePath, tools, scheduleCount, triggerCount }` | Agent registered from config |
| `daemon.agent.unregistered` | `{ name, filePath, reason }` | Agent removed (file deleted) |
| `daemon.watch.started` | `{ files, configPath }` | File watching started |

### Subscribing to All Daemon Events

```typescript
// Broad subscription for logging
kernel.events.subscribe('daemon.*', (event) => {
  console.log(`[daemon] ${event.eventType}`, event.data);
});

// Specific subscriptions for alerting
kernel.events.subscribe('daemon.config.error', (event) => {
  ops.alert(`Config error: ${event.data.filePath}`, event.data.error);
});

kernel.events.subscribe('daemon.shutdown.timeout', (event) => {
  ops.warn(`Forced shutdown with ${event.data.activeIntents} active intents`);
});
```

---

## Production Deployment Patterns

### systemd

```ini
# /etc/systemd/system/kernova.service
[Unit]
Description=Kernova Daemon
After=network.target

[Service]
Type=simple
User=kernova
WorkingDirectory=/opt/kernova
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5

# Give Kernova time for graceful shutdown (match shutdownTimeoutMs + buffer)
TimeoutStopSec=35

# Signal handling
KillSignal=SIGTERM
KillMode=mixed

# Environment
Environment=NODE_ENV=production
Environment=KERNOVA_DATA_DIR=/var/lib/kernova/data

[Install]
WantedBy=multi-user.target
```

```typescript
// dist/server.ts
import { KernovaKernel } from '@kernova/core';
import { DaemonRunner } from '@kernova/core/daemon';

const kernel = new KernovaKernel({
  ephemeral: false,
  dataDir: process.env.KERNOVA_DATA_DIR || '/var/lib/kernova/data',
  environment: 'production',
});
await kernel.start();

const daemon = new DaemonRunner(kernel, {
  configPath: '/etc/kernova/agents/',
  watch: true,
  shutdownTimeoutMs: 30000,
});

await daemon.start();
```

### Docker

```dockerfile
FROM node:20-slim AS runtime

WORKDIR /app
COPY dist/ ./dist/
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Agent configs mounted at runtime
VOLUME /etc/kernova/agents
VOLUME /var/lib/kernova/data

# Use exec form so signals reach the Node process directly
CMD ["node", "dist/server.js"]

# Health check using heartbeat
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1))"
```

```yaml
# docker-compose.yml
services:
  kernova:
    build: .
    volumes:
      - ./agents:/etc/kernova/agents:ro
      - kernova-data:/var/lib/kernova/data
    environment:
      - NODE_ENV=production
      - KERNOVA_DATA_DIR=/var/lib/kernova/data
    stop_grace_period: 35s  # Match shutdownTimeoutMs + buffer
    restart: unless-stopped

volumes:
  kernova-data:
```

### PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kernova-daemon',
    script: './dist/server.js',
    instances: 1,            // Single instance — daemon manages its own state
    exec_mode: 'fork',
    kill_timeout: 35000,     // Match shutdownTimeoutMs + buffer
    wait_ready: true,        // Wait for process.send('ready')
    listen_timeout: 10000,
    env_production: {
      NODE_ENV: 'production',
      KERNOVA_DATA_DIR: '/var/lib/kernova/data',
    },
  }],
};
```

```typescript
// dist/server.ts (PM2 variant)
import { KernovaKernel } from '@kernova/core';
import { DaemonRunner } from '@kernova/core/daemon';

const kernel = new KernovaKernel({
  ephemeral: false,
  dataDir: process.env.KERNOVA_DATA_DIR,
  environment: 'production',
});
await kernel.start();

const daemon = new DaemonRunner(kernel, {
  configPath: './agents/',
  watch: true,
  shutdownTimeoutMs: 30000,
});

daemon.start();

// Signal PM2 that we're ready
if (process.send) {
  process.send('ready');
}
```

---

## Best Practices

### Shutdown Timeout

- Set `shutdownTimeoutMs` based on your longest expected intent execution time
- Add a buffer to your process manager's stop timeout (e.g., `shutdownTimeoutMs + 5000`)
- If intents regularly timeout, investigate why they're slow rather than increasing the timeout

### Hot-Reload

- Keep agent config files in version control — deploy changes via git pull + file system update
- Test config changes in staging before deploying to production
- Monitor `daemon.config.error` events — they indicate broken configs that didn't take effect
- Parse errors are safe (old definition stays active), but they still need fixing

### Heartbeat

- Use heartbeat events to drive external health checks and monitoring dashboards
- A missing heartbeat (no event within 2× the interval) indicates the daemon is stuck or crashed
- Keep the interval reasonable — 30–60s for production, shorter for debugging

### Config File Organization

```
agents/
├── base.agent.yaml          # Shared tools and base instructions
├── support-bot.agent.yaml   # Extends base, adds support-specific config
├── deploy-agent.agent.yaml  # Extends base, adds deployment tools
└── scheduler.agent.yaml     # Cron-based agent with schedules
```

### Signal Handling

- Never call `process.exit()` directly — let the daemon handle shutdown cleanly
- The daemon removes its own signal handlers during shutdown to avoid double-invocation
- If you need custom shutdown logic, subscribe to `daemon.stopping` rather than adding your own signal handlers

### Monitoring Checklist

```typescript
// Essential event subscriptions for production
kernel.events.subscribe('daemon.started', () => ops.info('Daemon started'));
kernel.events.subscribe('daemon.stopped', () => ops.info('Daemon stopped'));
kernel.events.subscribe('daemon.config.error', (e) => ops.error('Config error', e.data));
kernel.events.subscribe('daemon.shutdown.timeout', (e) => ops.warn('Shutdown timeout', e.data));

kernel.events.subscribe('daemon.heartbeat', (e) => {
  metrics.gauge('kernova.uptime_seconds', e.data.uptime);
  metrics.gauge('kernova.active_intents', e.data.activeIntents);
  metrics.gauge('kernova.agents_count', e.data.registeredAgents);
});
```

### Anti-Patterns

- ❌ Setting `shutdownTimeoutMs: 0` — intents get killed immediately, data loss risk
- ❌ Running multiple daemon instances with the same `dataDir` — SQLite lock contention
- ❌ Using `watch: true` with network-mounted config directories — unreliable fs events
- ❌ Ignoring `daemon.config.error` events — broken configs go unnoticed
- ❌ Very short heartbeat intervals (< 5s) — unnecessary event bus noise

---

## Methods Reference

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Start the daemon; resolves when daemon stops |
| `stop()` | `Promise<void>` | Initiate graceful shutdown |
| `isRunning()` | `boolean` | Whether the daemon is currently active |
| `getLoadedConfigs()` | `Map<string, AgentConfigFile>` | Snapshot of loaded agent configs by file path |

---

## Next Steps

- [Building Agents](/guides/agents) — Define agents that the daemon loads from config files
- [Context & Memory](/guides/context-memory) — How loaded agents receive context automatically
- [Configuration](/guides/configuration) — Full kernel and daemon configuration reference
- [Channels & Adapters](/guides/channels) — Connect daemon-hosted agents to external services
