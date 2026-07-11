---
title: "Auth Profiles"
description: Manage multiple API keys per provider with automatic rotation, rate-limit cooldown, and priority-based selection.
---

# Auth Profiles

Auth Profiles let you register **multiple API keys per provider** and rotate between them automatically. When a key hits a rate limit, it's put on exponential-backoff cooldown while the system seamlessly switches to the next available key.

## Why You Need This

- **Rate limit resilience** — One key gets throttled? The next one picks up instantly
- **Cost distribution** — Spread usage across team members' keys or billing accounts
- **Priority tiers** — Prefer production keys, fall back to shared keys automatically
- **Zero-downtime rotation** — Swap keys without restarting the kernel

## When to Use Auth Profiles

| Scenario | Single Key (env var) | Auth Profiles |
|----------|---------------------|---------------|
| Local development | ✅ | Overkill |
| Single-user app | ✅ | Optional |
| Team with shared keys | ❌ | ✅ |
| High-throughput production | ❌ | ✅ |
| Multi-tenant platform | ❌ | ✅ |

If you're running a single key per provider, just use environment variables. Auth Profiles are for **multi-key scenarios** where rotation and resilience matter.

## Quick Start

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'production' });
await kernel.start();

// Add multiple OpenAI keys
kernel.authProfiles.add('openai', 'team-key-1', 'sk-abc...', 10);  // priority 10 (preferred)
kernel.authProfiles.add('openai', 'team-key-2', 'sk-def...', 5);   // priority 5 (fallback)
kernel.authProfiles.add('openai', 'team-key-3', 'sk-ghi...', 5);   // priority 5 (fallback)

// Get the next available key (round-robin within same priority, highest priority first)
const result = kernel.authProfiles.getKey('openai');
if (result) {
  console.log(`Using key: ${result.label} (${result.profileId})`);
  // Use result.key for the API call
  // On success: kernel.authProfiles.markSuccess(result.profileId);
  // On rate limit: kernel.authProfiles.markRateLimited(result.profileId);
}
```

That's the core loop: **get a key → make your call → report the outcome**. The system handles rotation, cooldown, and priority sorting for you.

## API Reference

### `add(provider, label, apiKey, priority?)`

Register a new API key profile.

```typescript
const profile = kernel.authProfiles.add('openai', 'prod-key-1', 'sk-abc123...', 10);
// Returns the created AuthProfile object
```

- **provider** — Provider identifier (e.g., `'openai'`, `'anthropic'`, `'gemini'`)
- **label** — Human-readable name for this key
- **apiKey** — The actual API key string
- **priority** — Higher number = preferred. Default: `0`
- **Throws** if a duplicate key is registered for the same provider

---

### `getKey(provider)`

Get the next available key using round-robin + priority selection.

```typescript
const result = kernel.authProfiles.getKey('openai');
// Returns: { key, profileId, provider, label } | null
```

Returns `null` if no keys are available (all in cooldown or disabled).

---

### `markSuccess(profileId)`

Report a successful API call. Resets the failure counter and clears any cooldown.

```typescript
kernel.authProfiles.markSuccess(result.profileId);
```

---

### `markRateLimited(profileId)`

Report a rate limit (HTTP 429) or failure. Applies exponential-backoff cooldown.

```typescript
kernel.authProfiles.markRateLimited(result.profileId);
// First call: 60s cooldown
// Second call: 120s cooldown
// Third call: 240s cooldown (capped at maxCooldownMs)
```

---

### `findByKey(apiKey, provider?)`

Reverse lookup — find a profile by its key string. Optionally scope to a specific provider.

```typescript
const profile = kernel.authProfiles.findByKey('sk-abc123...');
const scoped = kernel.authProfiles.findByKey('sk-abc123...', 'openai');
```

---

### `get(profileId)`

Get a profile by its unique ID.

```typescript
const profile = kernel.authProfiles.get('profile-uuid-here');
```

---

### `getAvailableProfiles(provider)`

List all profiles that are enabled and **not** currently in cooldown.

```typescript
const available = kernel.authProfiles.getAvailableProfiles('openai');
console.log(`${available.length} keys ready to use`);
```

---

### `listProfiles(provider?)`

List all profiles, optionally filtered by provider. Includes disabled and cooldown profiles.

```typescript
const all = kernel.authProfiles.listProfiles();           // All providers
const openai = kernel.authProfiles.listProfiles('openai'); // OpenAI only
```

---

### `remove(profileId)`

Permanently delete a profile. Returns `true` if found and removed.

```typescript
const removed = kernel.authProfiles.remove('profile-uuid-here'); // true | false
```

---

### `setEnabled(profileId, enabled)`

Toggle a profile on or off without removing it. Disabled profiles are skipped during key selection.

```typescript
kernel.authProfiles.setEnabled(profileId, false); // Take offline for maintenance
kernel.authProfiles.setEnabled(profileId, true);  // Bring back online
```

---

### `resetCooldown(profileId)`

Manually clear a profile's cooldown and reset its failure counter. Useful for administrative overrides.

```typescript
kernel.authProfiles.resetCooldown(profileId);
```

---

### `count(provider?)`

Count registered profiles, optionally scoped to a provider.

```typescript
const total = kernel.authProfiles.count();           // All providers
const openai = kernel.authProfiles.count('openai');  // OpenAI only
```

---

### Full Method Summary

| Method | Returns | Description |
|--------|---------|-------------|
| `add(provider, label, apiKey, priority?)` | `AuthProfile` | Register a new API key. Throws on duplicate. |
| `getKey(provider)` | `KeyResult \| null` | Next available key via round-robin + priority. |
| `findByKey(apiKey, provider?)` | `AuthProfile \| undefined` | Reverse lookup by key string. |
| `get(profileId)` | `AuthProfile \| undefined` | Get profile by ID. |
| `markRateLimited(profileId)` | `void` | Apply exponential-backoff cooldown. |
| `markSuccess(profileId)` | `void` | Reset failure count and clear cooldown. |
| `getAvailableProfiles(provider)` | `AuthProfile[]` | List non-cooldown, enabled profiles. |
| `listProfiles(provider?)` | `AuthProfile[]` | List all profiles (optionally by provider). |
| `remove(profileId)` | `boolean` | Delete a profile. |
| `setEnabled(profileId, enabled)` | `void` | Toggle profile on/off without removing. |
| `resetCooldown(profileId)` | `void` | Manually clear cooldown and reset failures. |
| `count(provider?)` | `number` | Count profiles (optionally by provider). |

## Interfaces

### AuthProfile

The full profile object stored in the manager.

```typescript
interface AuthProfile {
  id: string;
  provider: string;           // e.g., 'openai', 'anthropic', 'gemini'
  label: string;              // Human-readable name (e.g., 'team-prod-key-1')
  apiKey: string;             // The actual API key
  priority: number;           // Higher = preferred (default: 0)
  enabled: boolean;           // Whether this profile is active
  cooldownUntil?: number;     // Epoch ms when cooldown expires
  lastUsedAt?: number;        // Epoch ms of last use
  usageCount: number;         // Total uses
  failureCount: number;       // Consecutive failures (resets on success)
  createdAt: string;          // ISO timestamp
}
```

### KeyResult

Returned by `getKey()` — contains everything you need to make an API call and report back.

```typescript
interface KeyResult {
  key: string;          // The API key to use
  profileId: string;    // Profile ID for marking success/failure
  provider: string;     // Provider name
  label: string;        // Human-readable label
}
```

### AuthProfileManagerConfig

Configuration options passed to the manager.

```typescript
interface AuthProfileManagerConfig {
  defaultCooldownMs?: number;  // Base cooldown duration (default: 60,000 = 1 minute)
  maxCooldownMs?: number;      // Maximum cooldown cap (default: 300,000 = 5 minutes)
}
```

## Key Rotation Logic

When you call `getKey(provider)`, the selection algorithm runs:

1. **Filter by provider** — Only profiles matching the requested provider
2. **Filter enabled** — Skip profiles where `enabled === false`
3. **Filter cooldown** — Skip profiles where `Date.now() < cooldownUntil`
4. **Sort by priority** — Highest priority number first
5. **Round-robin within tier** — Among profiles with the same priority, rotate usage evenly

This means your highest-priority keys are always preferred, but if they're all in cooldown, lower-priority fallbacks pick up automatically.

```
Priority 10: [team-key-1] ← used first (preferred)
Priority 5:  [team-key-2, team-key-3] ← round-robin between these as fallback
Priority 1:  [shared-key] ← last resort
```

## Rate Limit Handling

### Exponential Backoff

When `markRateLimited()` is called, cooldown duration increases exponentially:

| Consecutive Failures | Cooldown Duration | Formula |
|---------------------|-------------------|---------|
| 1st failure | 60 seconds | `2^0 × 60,000ms` |
| 2nd failure | 120 seconds | `2^1 × 60,000ms` |
| 3rd failure | 240 seconds | `2^2 × 60,000ms` |
| 4th failure | 300 seconds (capped) | `2^3 × 60,000ms` → capped at `maxCooldownMs` |
| 5th+ failure | 300 seconds (capped) | Stays at cap until `markSuccess()` |

Calling `markSuccess()` resets `failureCount` to `0`, so the next failure starts fresh at 60 seconds.

### Practical Usage Pattern

```typescript
async function callOpenAI(prompt: string): Promise<any> {
  const keyResult = kernel.authProfiles.getKey('openai');
  if (!keyResult) {
    throw new Error('No available OpenAI keys — all are in cooldown');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyResult.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (response.status === 429) {
      // Rate limited — put this key on cooldown
      kernel.authProfiles.markRateLimited(keyResult.profileId);
      // Retry with a different key
      return callOpenAI(prompt);
    }

    // Success — reset failure counter
    kernel.authProfiles.markSuccess(keyResult.profileId);
    return await response.json();
  } catch (error) {
    kernel.authProfiles.markRateLimited(keyResult.profileId);
    throw error;
  }
}
```

:::caution
The recursive retry above has no depth limit. In production, add a max-retry counter or use `getAvailableProfiles()` to check remaining capacity before retrying.
:::

## Multi-Provider Setup

Manage keys across all your providers independently:

```typescript
// OpenAI keys (3 team members)
kernel.authProfiles.add('openai', 'alice-key', process.env.OPENAI_KEY_ALICE!, 10);
kernel.authProfiles.add('openai', 'bob-key', process.env.OPENAI_KEY_BOB!, 5);
kernel.authProfiles.add('openai', 'shared-key', process.env.OPENAI_KEY_SHARED!, 1);

// Anthropic keys (2 keys)
kernel.authProfiles.add('anthropic', 'prod-key', process.env.ANTHROPIC_KEY_PROD!, 10);
kernel.authProfiles.add('anthropic', 'backup-key', process.env.ANTHROPIC_KEY_BACKUP!, 5);

// Google Gemini (1 key — still benefits from tracking)
kernel.authProfiles.add('gemini', 'main-key', process.env.GEMINI_API_KEY!, 10);

// Check availability per provider
const openaiCount = kernel.authProfiles.count('openai');                        // 3
const anthropicAvailable = kernel.authProfiles.getAvailableProfiles('anthropic'); // 2 (unless one is in cooldown)
```

Each provider's key pool is managed independently — an OpenAI cooldown doesn't affect your Anthropic keys.

## Events

The auth profile manager emits events through the kernel's event system. Use these for monitoring and alerting.

| Event | Emitted When | Payload |
|-------|-------------|---------|
| `auth.profile.added` | Profile registered | `{ provider, label, priority }` |
| `auth.profile.removed` | Profile deleted | `{ provider, label }` |
| `auth.profile.cooldown` | Rate limit detected | `{ provider, label, cooldownMs, failureCount }` |
| `auth.profile.enabled` | Profile re-enabled | `{ provider, label }` |
| `auth.profile.disabled` | Profile disabled | `{ provider, label }` |

### Listening to Events

```typescript
kernel.on('auth.profile.cooldown', (data) => {
  console.warn(
    `⚠️ Key "${data.label}" (${data.provider}) hit rate limit. ` +
    `Cooldown: ${data.cooldownMs / 1000}s (failure #${data.failureCount})`
  );
});

kernel.on('auth.profile.added', (data) => {
  console.log(`✅ New ${data.provider} key registered: ${data.label} (priority ${data.priority})`);
});
```

## Best Practices

1. **Use descriptive labels** — Include team member names, environment, or purpose: `'alice-prod'`, `'shared-dev'`, `'billing-account-2'`

2. **Set priority by rate limit tier** — Keys with higher rate limits should get higher priority numbers so they're used first

3. **Monitor cooldown events** — If `auth.profile.cooldown` fires frequently, you need more keys or should reduce throughput

4. **Prefer `setEnabled(false)` over `remove()`** — Disabling preserves the profile for re-activation. Only remove when a key is permanently revoked

5. **Keep redundancy per provider** — At least 2 profiles per critical provider ensures one is always available during cooldown

6. **Report outcomes consistently** — Always call `markSuccess()` or `markRateLimited()` after every API call. Missing reports break the rotation logic

7. **Load keys at startup** — Register all profiles immediately after `kernel.start()` so they're available before the first request

```typescript
async function setupAuthProfiles(kernel: KernovaKernel) {
  const keys = [
    { provider: 'openai', label: 'primary', key: process.env.OPENAI_KEY_1!, priority: 10 },
    { provider: 'openai', label: 'secondary', key: process.env.OPENAI_KEY_2!, priority: 5 },
    { provider: 'anthropic', label: 'main', key: process.env.ANTHROPIC_KEY!, priority: 10 },
  ];

  for (const { provider, label, key, priority } of keys) {
    if (key) {
      kernel.authProfiles.add(provider, label, key, priority);
    }
  }

  console.log(`Loaded ${kernel.authProfiles.count()} auth profiles`);
}
```

## Limitations & Notes

- **In-memory only** — Profiles are not persisted to SQLite. They must be re-added after every kernel restart. If you need persistence, store keys in your own database and load them at startup.

- **Not auto-wired to ModelRouter** — The auth profiles module is standalone. You can integrate it with custom provider calls, but the built-in ModelRouter does not yet pull keys from it automatically.

- **No encryption at rest** — API keys are stored as plain strings in memory. Ensure your hosting environment is secured and avoid logging profile objects.

- **Cooldown is wall-clock based** — If the kernel restarts, all cooldowns are cleared (since they're in memory). This is generally fine — if a key was rate-limited before restart, it likely has capacity again.

- **Single-key scenarios** — If you only have one key per provider, use the standard environment variable approach (`OPENAI_API_KEY`, etc.). Auth profiles add value at 2+ keys.
