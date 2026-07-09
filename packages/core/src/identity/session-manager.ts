/**
 * Kernova Session Manager
 * 
 * Manages authenticated sessions for the Studio dashboard and API access.
 * Sessions are token-based with configurable TTL.
 */

import { randomBytes } from 'node:crypto';
import type { NexusId } from '@kernova/types';
import { generateId, now } from '../utils.js';

export interface Session {
  /** Session token */
  token: string;

  /** Session ID */
  id: NexusId;

  /** Who owns this session */
  identityId: NexusId;

  /** Permissions for this session */
  permissions: string[];

  /** When the session was created */
  createdAt: string;

  /** When the session expires */
  expiresAt: string;

  /** Last activity time */
  lastActivityAt: string;

  /** Whether the session is active */
  active: boolean;
}

export interface CreateSessionOptions {
  identityId: NexusId;
  permissions: string[];
  /** TTL in seconds (default: 24 hours) */
  ttlSeconds?: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map(); // token → session
  private defaultTtlSeconds: number;

  constructor(defaultTtlSeconds = 86400) { // 24 hours
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  /**
   * Create a new session
   */
  create(options: CreateSessionOptions): Session {
    const ttl = options.ttlSeconds || this.defaultTtlSeconds;
    const token = randomBytes(32).toString('hex');

    const session: Session = {
      token,
      id: generateId('sess'),
      identityId: options.identityId,
      permissions: options.permissions,
      createdAt: now(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      lastActivityAt: now(),
      active: true,
    };

    this.sessions.set(token, session);
    return session;
  }

  /**
   * Validate a session token
   */
  validate(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (!session.active) return null;

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      session.active = false;
      return null;
    }

    // Update activity
    session.lastActivityAt = now();
    return session;
  }

  /**
   * Invalidate a session
   */
  invalidate(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) return false;
    session.active = false;
    return true;
  }

  /**
   * Invalidate all sessions for an identity
   */
  invalidateAll(identityId: NexusId): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.identityId === identityId && session.active) {
        session.active = false;
        count++;
      }
    }
    return count;
  }

  /**
   * Get active sessions for an identity
   */
  getActiveSessions(identityId: NexusId): Session[] {
    return Array.from(this.sessions.values())
      .filter(s => s.identityId === identityId && s.active && new Date(s.expiresAt) > new Date());
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    let removed = 0;
    const now = new Date();
    for (const [token, session] of this.sessions.entries()) {
      if (!session.active || new Date(session.expiresAt) < now) {
        this.sessions.delete(token);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get total active session count
   */
  get activeCount(): number {
    return Array.from(this.sessions.values())
      .filter(s => s.active && new Date(s.expiresAt) > new Date()).length;
  }
}
