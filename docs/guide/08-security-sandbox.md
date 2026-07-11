# Security & Sandbox

Kernova provides layered security for agent tool execution: sandboxed filesystem access, tool allow/deny policies, rate limiting, and auth profile management.

## Sandbox Manager

The Sandbox Manager restricts what agents can access during tool execution. It enforces workspace-only filesystem access and per-agent tool permissions.

### Basic Usage

```typescript
const kernel = new NexusKernel({ environment: 'production', dataDir: './data' });
await kernel.start();

// Create a sandbox context for an agent
const sandbox = kernel.sandbox.createContext('agent_123', {
  allowedPaths: ['.', './uploads'],
  deniedPaths: ['../secrets', '/etc'],
  allowedTools: ['read', 'write', 'search'],
  deniedTools: ['exec', 'shell'],
  timeoutMs: 10_000,
  allowNetwork: true,
  allowWrite: true,
});

// Check before executing
if (kernel.sandbox.isPathAllowed(sandbox.id, './data/report.md')) {
  // Safe to read/write
}

if (kernel.sandbox.isPathAllowed(sandbox.id, '../../etc/passwd')) {
  // Returns false — path traversal blocked
}

if (kernel.sandbox.isToolAllowed(sandbox.id, 'exec')) {
  // Returns false — tool denied
}

// Clean up when done
kernel.sandbox.destroy(sandbox.id);
```

### Sandbox Policies

A `SandboxPolicy` defines what an agent can and cannot do:

```typescript
interface SandboxPolicy {
  allowedPaths?: string[];    // Filesystem paths the agent can access
  deniedPaths?: string[];     // Paths that are always blocked
  allowedTools?: string[];    // Only these tools are available
  deniedTools?: string[];     // These tools are blocked (takes priority)
  timeoutMs?: number;         // Max execution time per tool call
  allowNetwork?: boolean;     // Can the agent make network requests?
  allowWrite?: boolean;       // Can the agent write files?
}
```

The default policy blocks path traversal outside the workspace directory and denies access to system directories.

### Path Traversal Protection

The sandbox resolves all paths relative to the workspace and blocks any attempt to escape:

```typescript
// These are blocked:
sandbox.isPathAllowed(id, '../../../etc/passwd');     // false
sandbox.isPathAllowed(id, '/usr/local/bin/rm');       // false
sandbox.isPathAllowed(id, 'C:\\Windows\\System32');   // false

// These are allowed (within workspace):
sandbox.isPathAllowed(id, './src/index.ts');          // true
sandbox.isPathAllowed(id, 'docs/README.md');          // true
```

---

## Rate Limiter

Protect your system from abuse with token-bucket rate limiting. Limits can be set per identity, per provider, or globally.

### Configuration

```typescript
const kernel = new NexusKernel({ environment: 'production' });
await kernel.start();

// Add rate limit rules
kernel.rateLimiter.addRule({
  id: 'user-limit',
  scope: 'identity',
  key: '*',              // Applies to all users
  maxRequests: 60,       // 60 requests
  windowMs: 60_000,      // per minute
  burstAllowance: 10,    // Allow 10 extra for bursts
});

kernel.rateLimiter.addRule({
  id: 'openai-limit',
  scope: 'provider',
  key: 'openai',
  maxRequests: 100,
  windowMs: 60_000,
});

kernel.rateLimiter.addRule({
  id: 'global-limit',
  scope: 'global',
  key: '*',
  maxRequests: 1000,
  windowMs: 60_000,
});
```

### How It Works

Rate limiting is **automatically enforced** in `kernel.submit()`. When an identity exceeds their limit, the intent is rejected with an error:

```typescript
try {
  await kernel.submit({ goal: 'Do something' });
} catch (error) {
  // "Rate limit exceeded. Try again later."
}
```

### Manual Checks

You can also check limits manually for custom flows:

```typescript
const check = kernel.rateLimiter.check('identity', 'user_123');
if (!check.allowed) {
  console.log(`Rate limited. Retry in ${check.retryAfterMs}ms`);
}

// Manually consume a token
const allowed = kernel.rateLimiter.consume('provider', 'openai');

// Check stats
const stats = kernel.rateLimiter.getStats('identity', 'user_123');
// { requestCount: 45, remaining: 25, windowMs: 60000 }

// Reset limits (e.g., after a quota increase)
kernel.rateLimiter.reset('identity', 'user_123');
```

---

## Auth Profile Manager

Manage multiple API keys per provider with automatic rotation and cooldown tracking. Essential for production deployments where you need key redundancy and rate-limit resilience.

### Adding Profiles

```typescript
// Add multiple keys for OpenAI
kernel.authProfiles.add('openai', 'Primary Key', process.env.OPENAI_KEY_1!, 10);
kernel.authProfiles.add('openai', 'Backup Key', process.env.OPENAI_KEY_2!, 5);
kernel.authProfiles.add('openai', 'Low-priority Key', process.env.OPENAI_KEY_3!, 1);

// Add keys for Anthropic
kernel.authProfiles.add('anthropic', 'Main', process.env.ANTHROPIC_KEY!, 10);
```

### Getting Keys (Round-Robin with Priority)

```typescript
// Returns the highest-priority available key, rotating round-robin
const key = kernel.authProfiles.getKey('openai');
// First call: Primary Key
// Second call: Primary Key (still highest priority)
// After rate limit on primary: Backup Key
```

### Rate Limit Handling

When a provider returns a rate limit error, mark the profile:

```typescript
try {
  await callOpenAI(key);
} catch (error) {
  if (isRateLimitError(error)) {
    // Apply exponential backoff cooldown
    kernel.authProfiles.markRateLimited(profileId);
    // Profile will be skipped for 60s (doubling on consecutive failures)
    
    // Get next available key
    const fallbackKey = kernel.authProfiles.getKey('openai');
  }
}

// After successful usage, reset failure counter
kernel.authProfiles.markSuccess(profileId);
```

### Integration with Model Fallback

Combine auth profiles with the fallback manager for maximum resilience:

```typescript
// Get current available key
const key = kernel.authProfiles.getKey('openai');

const result = await kernel.fallback.complete(request, {
  candidates: [
    { provider: 'openai', model: 'gpt-4o' },       // Uses profile rotation
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'ollama', model: 'llama3' },        // Local fallback
  ],
  cooldownMs: 30_000,
});
```

### Profile Management

```typescript
// List all profiles
const profiles = kernel.authProfiles.listProfiles('openai');

// Check what's available (not on cooldown)
const available = kernel.authProfiles.getAvailableProfiles('openai');

// Disable a compromised key
kernel.authProfiles.setEnabled(profileId, false);

// Remove a key
kernel.authProfiles.remove(profileId);

// Reset cooldown manually
kernel.authProfiles.resetCooldown(profileId);
```

---

## Config Manager

Layered configuration system with hot reload and change watching. Config values resolve through four layers (later layers override earlier):

```
defaults < file < environment < runtime
```

### Basic Usage

```typescript
// Set defaults at startup
const kernel = new NexusKernel({ environment: 'production' });

// Access the config manager
const config = kernel.configManager;

// Get a value (resolves through all layers)
const provider = config.get<string>('models.default.provider');
const timeout = config.getOrDefault('tools.timeout', 30000);

// Set a runtime override (highest priority)
config.set('models.default.provider', 'anthropic');
```

### Environment Variables

Config values are auto-loaded from environment variables with the `KERNOVA_` prefix. Double underscores become dots:

```bash
KERNOVA_MODELS__DEFAULT__PROVIDER=openai
KERNOVA_TOOLS__TIMEOUT=60000
KERNOVA_DEBUG=true
```

These map to:
- `models.default.provider` → `"openai"`
- `tools.timeout` → `"60000"`
- `debug` → `"true"`

### Hot Reload

Reload configuration from a file without restarting:

```typescript
import { readFileSync } from 'fs';

// Watch for config file changes
fs.watchFile('./kernova.config.json', () => {
  const newConfig = JSON.parse(readFileSync('./kernova.config.json', 'utf-8'));
  kernel.configManager.reload(newConfig);
  // Emits 'config.reloaded' event + per-path 'config.changed' events
});
```

### Watching for Changes

React to config changes in real-time:

```typescript
// Watch a specific path
const unwatch = kernel.configManager.watch('models.default.provider', (newValue) => {
  console.log(`Provider changed to: ${newValue}`);
  // Re-initialize model connections, etc.
});

// Later: stop watching
unwatch();
```

### Getting All Config

```typescript
// Get the fully merged config object
const allConfig = kernel.configManager.getAll();
console.log(allConfig);
// {
//   environment: 'production',
//   dataDir: './data',
//   models: { default: { provider: 'openai' } },
//   ...
// }
```

---

## Security Best Practices

1. **Never run in production with `allowAnonymous: true`** — always require auth tokens
2. **Use environment variables for secrets** — never hardcode API keys
3. **Set rate limits per identity** — prevent any single user from exhausting quotas
4. **Enable sandbox for untrusted agents** — restrict filesystem and network access
5. **Rotate API keys** — use multiple profiles with the Auth Profile Manager
6. **Monitor rate limit events** — subscribe to `ratelimit.exceeded` on the EventBus
7. **Set tool policies** — use the Tool Policy Engine to restrict dangerous tools per agent

```typescript
// Example: production security setup
kernel.rateLimiter.addRule({
  id: 'strict-user-limit',
  scope: 'identity', key: '*',
  maxRequests: 30, windowMs: 60_000,
});

kernel.sandbox.createContext(agentId, {
  deniedTools: ['exec', 'shell', 'rm'],
  allowWrite: false,
  allowNetwork: false,
  timeoutMs: 5_000,
});
```
