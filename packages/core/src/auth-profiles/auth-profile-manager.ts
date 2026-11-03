/**
 * Kernova Auth Profile Manager
 *
 * Manages multiple API key profiles per provider with:
 * - Round-robin rotation across profiles
 * - Cooldown tracking after rate limits
 * - Auto-expiry for cooldown windows
 * - Profile priority (prefer higher-priority keys)
 * - Duplicate detection
 * - Reverse lookup (key → profile)
 *
 * Inspired by OpenClaw's auth-profiles system.
 */

import type { KernovaId, KernovaEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface AuthProfile {
  id: KernovaId;
  provider: string;
  label: string;
  apiKey: string;
  priority: number;              // Higher = preferred
  enabled: boolean;
  cooldownUntil?: number;        // Epoch ms when cooldown expires
  lastUsedAt?: number;
  usageCount: number;
  failureCount: number;
  createdAt: string;
}

export interface AuthProfileManagerConfig {
  /** Default cooldown duration after a rate limit hit (ms) */
  defaultCooldownMs?: number;    // default: 60_000
  /** Maximum cooldown (exponential backoff cap) */
  maxCooldownMs?: number;        // default: 300_000
}

/** Result from getKey() — includes profileId for marking success/failure */
export interface KeyResult {
  key: string;
  profileId: KernovaId;
  provider: string;
  label: string;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_COOLDOWN_MS = 300_000;

export class AuthProfileManager {
  private readonly eventBus: EventBus;
  private readonly defaultCooldownMs: number;
  private readonly maxCooldownMs: number;
  private profiles: Map<KernovaId, AuthProfile> = new Map();
  /** Round-robin index per provider */
  private rotationIndex: Map<string, number> = new Map();

  constructor(eventBus: EventBus, config?: AuthProfileManagerConfig) {
    this.eventBus = eventBus;
    this.defaultCooldownMs = config?.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxCooldownMs = config?.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
  }

  /**
   * Add an API key profile for a provider.
   * Validates for duplicates (same provider + same key).
   */
  add(provider: string, label: string, apiKey: string, priority?: number): AuthProfile {
    // Validate: no duplicate key for the same provider
    for (const existing of this.profiles.values()) {
      if (existing.provider === provider && existing.apiKey === apiKey) {
        throw new Error(`A profile with this API key already exists for provider "${provider}" (label: "${existing.label}")`);
      }
    }

    const profile: AuthProfile = {
      id: generateId('auth'),
      provider,
      label,
      apiKey,
      priority: priority ?? 0,
      enabled: true,
      usageCount: 0,
      failureCount: 0,
      createdAt: now(),
    };
    this.profiles.set(profile.id, profile);

    this.emitEvent('auth.profile.added', profile.id, {
      provider,
      label,
      priority: profile.priority,
    });

    return profile;
  }

  /**
   * Get the next available key for a provider (round-robin with cooldown skip).
   * Returns both the key and the profileId so callers can report success/failure.
   */
  getKey(provider: string): KeyResult | null {
    const available = this.getAvailableProfiles(provider);
    if (available.length === 0) return null;

    // Sort by priority (descending), then round-robin within same priority
    available.sort((a, b) => b.priority - a.priority);

    const idx = this.rotationIndex.get(provider) ?? 0;
    const profile = available[idx % available.length];
    this.rotationIndex.set(provider, (idx + 1) % available.length);

    // Track usage
    profile.lastUsedAt = Date.now();
    profile.usageCount++;

    return {
      key: profile.apiKey,
      profileId: profile.id,
      provider: profile.provider,
      label: profile.label,
    };
  }

  /**
   * Find a profile by its API key (reverse lookup).
   * Useful when a downstream call fails and you need to mark the profile.
   */
  findByKey(apiKey: string, provider?: string): AuthProfile | undefined {
    for (const profile of this.profiles.values()) {
      if (profile.apiKey === apiKey && (!provider || profile.provider === provider)) {
        return profile;
      }
    }
    return undefined;
  }

  /**
   * Get a profile by ID.
   */
  get(profileId: KernovaId): AuthProfile | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * Mark a profile as rate-limited (applies cooldown).
   */
  markRateLimited(profileId: KernovaId): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    profile.failureCount++;
    const backoff = Math.min(
      this.defaultCooldownMs * Math.pow(2, profile.failureCount - 1),
      this.maxCooldownMs,
    );
    profile.cooldownUntil = Date.now() + backoff;

    this.emitEvent('auth.profile.cooldown', profileId, {
      provider: profile.provider,
      label: profile.label,
      cooldownMs: backoff,
      failureCount: profile.failureCount,
    });
  }

  /**
   * Mark a successful usage (resets failure count).
   */
  markSuccess(profileId: KernovaId): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;
    profile.failureCount = 0;
    profile.cooldownUntil = undefined;
  }

  /**
   * Get available (non-cooldown, enabled) profiles for a provider.
   */
  getAvailableProfiles(provider: string): AuthProfile[] {
    const currentTime = Date.now();
    return Array.from(this.profiles.values()).filter(p =>
      p.provider === provider &&
      p.enabled &&
      (!p.cooldownUntil || currentTime >= p.cooldownUntil)
    );
  }

  /**
   * List all profiles, optionally filtered by provider.
   */
  listProfiles(provider?: string): AuthProfile[] {
    const all = Array.from(this.profiles.values());
    return provider ? all.filter(p => p.provider === provider) : all;
  }

  /**
   * Remove a profile.
   */
  remove(profileId: KernovaId): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) return false;

    this.profiles.delete(profileId);

    this.emitEvent('auth.profile.removed', profileId, {
      provider: profile.provider,
      label: profile.label,
    });

    return true;
  }

  /**
   * Enable/disable a profile.
   */
  setEnabled(profileId: KernovaId, enabled: boolean): void {
    const profile = this.profiles.get(profileId);
    if (profile) {
      profile.enabled = enabled;
      this.emitEvent(enabled ? 'auth.profile.enabled' : 'auth.profile.disabled', profileId, {
        provider: profile.provider,
        label: profile.label,
      });
    }
  }

  /**
   * Reset cooldown for a specific profile.
   */
  resetCooldown(profileId: KernovaId): void {
    const profile = this.profiles.get(profileId);
    if (profile) {
      profile.cooldownUntil = undefined;
      profile.failureCount = 0;
    }
  }

  /**
   * Get total profile count.
   */
  count(provider?: string): number {
    if (!provider) return this.profiles.size;
    return Array.from(this.profiles.values()).filter(p => p.provider === provider).length;
  }

  private emitEvent(eventType: string, subjectId: KernovaId, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('cooldown') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'auth_profile',
      actorId: 'auth-profile-manager',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'auth-profile-manager', environment: 'runtime' },
    });
  }
}
