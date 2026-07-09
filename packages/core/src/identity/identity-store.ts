/**
 * Kernova Identity Store (SQLite)
 * 
 * Persists identities, API keys, and sessions to the shared kernova.db.
 * This ensures auth state survives process restarts.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NexusId } from '@kernova/types';
import type { ApiKey } from './api-keys.js';

export interface IdentityStoreConfig {
  path?: string;
}

export class IdentityStore {
  private db: Database.Database;

  constructor(config: IdentityStoreConfig = {}) {
    const dbPath = config.path || './kernova-data/kernova.db';
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  /** Store an API key (hash only — never plaintext) */
  storeKey(key: ApiKey): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO api_keys (id, name, hash, prefix, owner_id, organization_id, permissions, expires_at, created_at, last_used_at, active)
      VALUES (@id, @name, @hash, @prefix, @owner_id, @organization_id, @permissions, @expires_at, @created_at, @last_used_at, @active)
    `).run({
      id: key.id,
      name: key.name,
      hash: key.hash,
      prefix: key.prefix,
      owner_id: key.ownerId,
      organization_id: key.organizationId || null,
      permissions: JSON.stringify(key.permissions),
      expires_at: key.expiresAt || null,
      created_at: key.createdAt,
      last_used_at: key.lastUsedAt || null,
      active: key.active ? 1 : 0,
    });
  }

  /** Get API key by hash */
  getKeyByHash(hash: string): ApiKey | null {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE hash = ? AND active = 1').get(hash) as KeyRow | undefined;
    if (!row) return null;
    return this.rowToKey(row);
  }

  /** List keys by owner */
  listKeysByOwner(ownerId: NexusId): ApiKey[] {
    const rows = this.db.prepare('SELECT * FROM api_keys WHERE owner_id = ?').all(ownerId) as KeyRow[];
    return rows.map(r => this.rowToKey(r));
  }

  /** Revoke a key */
  revokeKey(keyId: NexusId): void {
    this.db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(keyId);
  }

  /** Store an identity */
  storeIdentity(identity: { id: string; type: string; name: string; email?: string; organizationId?: string; active: boolean; createdAt: string }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO identities (id, type, name, email, organization_id, active, created_at)
      VALUES (@id, @type, @name, @email, @organization_id, @active, @created_at)
    `).run({
      id: identity.id,
      type: identity.type,
      name: identity.name,
      email: identity.email || null,
      organization_id: identity.organizationId || null,
      active: identity.active ? 1 : 0,
      created_at: identity.createdAt,
    });
  }

  /** Get identity by ID */
  getIdentity(id: NexusId): { id: string; type: string; name: string; email?: string; organizationId?: string; active: boolean; createdAt: string } | null {
    const row = this.db.prepare('SELECT * FROM identities WHERE id = ?').get(id) as IdentityRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      email: row.email || undefined,
      organizationId: row.organization_id || undefined,
      active: row.active === 1,
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        organization_id TEXT,
        permissions TEXT NOT NULL DEFAULT '[]',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_keys_hash ON api_keys(hash);
      CREATE INDEX IF NOT EXISTS idx_keys_owner ON api_keys(owner_id);

      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        organization_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_identities_type ON identities(type);
    `);
  }

  private rowToKey(row: KeyRow): ApiKey {
    return {
      id: row.id,
      name: row.name,
      hash: row.hash,
      prefix: row.prefix,
      ownerId: row.owner_id,
      organizationId: row.organization_id || undefined,
      permissions: JSON.parse(row.permissions),
      expiresAt: row.expires_at || undefined,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || undefined,
      active: row.active === 1,
    };
  }
}

interface KeyRow {
  id: string; name: string; hash: string; prefix: string;
  owner_id: string; organization_id: string | null;
  permissions: string; expires_at: string | null;
  created_at: string; last_used_at: string | null; active: number;
}

interface IdentityRow {
  id: string; type: string; name: string; email: string | null;
  organization_id: string | null; active: number; created_at: string;
}
