/**
 * Kernova API Key Manager
 * 
 * Generates, validates, and manages API keys for programmatic access.
 * 
 * Key format: nxs_{random_32_hex}
 * Storage: SHA-256 hash (never store plaintext)
 * Scoping: Keys inherit permissions from their creator
 */

import { createHash, randomBytes } from 'node:crypto';
import type { NexusId } from '@kernova/types';
import { generateId, now } from '../utils.js';

/** Prefix for all Kernova API keys */
const KEY_PREFIX = 'nxs_';

export interface ApiKey {
  /** Key ID (for reference without exposing the key) */
  id: NexusId;

  /** Human-readable label */
  name: string;

  /** SHA-256 hash of the key (never store plaintext) */
  hash: string;

  /** Key prefix (first 8 chars for identification) */
  prefix: string;

  /** Who created this key */
  ownerId: NexusId;

  /** Organization scope (if any) */
  organizationId?: NexusId;

  /** Permissions granted to this key */
  permissions: string[];

  /** When the key expires (undefined = never) */
  expiresAt?: string;

  /** When the key was created */
  createdAt: string;

  /** When the key was last used */
  lastUsedAt?: string;

  /** Whether the key is active */
  active: boolean;
}

export interface CreateKeyOptions {
  /** Human-readable name for the key */
  name: string;

  /** Who owns this key */
  ownerId: NexusId;

  /** Organization scope */
  organizationId?: NexusId;

  /** Permissions (subset of owner's permissions) */
  permissions: string[];

  /** TTL in seconds (optional) */
  ttlSeconds?: number;
}

export interface ApiKeyValidation {
  valid: boolean;
  key?: ApiKey;
  reason?: string;
}

export class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map(); // hash → key

  /**
   * Generate a new API key.
   * Returns the plaintext key (only shown once) and the stored key metadata.
   */
  create(options: CreateKeyOptions): { plaintext: string; key: ApiKey } {
    // Generate random key
    const secret = randomBytes(32).toString('hex');
    const plaintext = `${KEY_PREFIX}${secret}`;
    const hash = this.hashKey(plaintext);
    const prefix = plaintext.slice(0, 12); // "nxs_" + 8 chars

    const key: ApiKey = {
      id: generateId('key'),
      name: options.name,
      hash,
      prefix,
      ownerId: options.ownerId,
      organizationId: options.organizationId,
      permissions: options.permissions,
      expiresAt: options.ttlSeconds
        ? new Date(Date.now() + options.ttlSeconds * 1000).toISOString()
        : undefined,
      createdAt: now(),
      active: true,
    };

    this.keys.set(hash, key);

    return { plaintext, key };
  }

  /**
   * Validate an API key. Returns the key metadata if valid.
   */
  validate(plaintext: string): ApiKeyValidation {
    // Check format
    if (!plaintext.startsWith(KEY_PREFIX)) {
      return { valid: false, reason: 'Invalid key format' };
    }

    // Hash and lookup
    const hash = this.hashKey(plaintext);
    const key = this.keys.get(hash);

    if (!key) {
      return { valid: false, reason: 'Key not found' };
    }

    if (!key.active) {
      return { valid: false, reason: 'Key is revoked' };
    }

    // Check expiry
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      return { valid: false, reason: 'Key has expired' };
    }

    // Update last used
    key.lastUsedAt = now();

    return { valid: true, key };
  }

  /**
   * Revoke an API key
   */
  revoke(keyId: NexusId): boolean {
    for (const key of this.keys.values()) {
      if (key.id === keyId) {
        key.active = false;
        return true;
      }
    }
    return false;
  }

  /**
   * List all keys for an owner (without hashes)
   */
  listByOwner(ownerId: NexusId): ApiKey[] {
    return Array.from(this.keys.values())
      .filter(k => k.ownerId === ownerId);
  }

  /**
   * List all active keys
   */
  listActive(): ApiKey[] {
    return Array.from(this.keys.values())
      .filter(k => k.active);
  }

  /**
   * Hash a plaintext key with SHA-256
   */
  private hashKey(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }
}
