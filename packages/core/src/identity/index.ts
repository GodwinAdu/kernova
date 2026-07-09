/**
 * Nexus Identity System
 * 
 * Pillar 1: Identity — "Who are you?"
 * Pillar 2: Trust — "Should we believe you?"
 * 
 * Provides authentication, authorization, API keys, sessions,
 * roles, permissions, and organization management.
 */

export { IdentityManager } from './identity-manager.js';
export type { RegisteredIdentity, Organization, ActorType, IdentityManagerConfig } from './identity-manager.js';
export { ApiKeyManager } from './api-keys.js';
export type { ApiKey, CreateKeyOptions, ApiKeyValidation } from './api-keys.js';
export { PermissionEngine } from './permission-engine.js';
export type { PermissionCheck, PermissionResult, Role } from './permission-engine.js';
export { SessionManager } from './session-manager.js';
export type { Session, CreateSessionOptions } from './session-manager.js';
export { IdentityStore } from './identity-store.js';
export type { IdentityStoreConfig } from './identity-store.js';
