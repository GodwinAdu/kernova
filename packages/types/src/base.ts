/**
 * Kernova Base Types
 * 
 * Every object in Kernova follows the Universal Object Model.
 * These are the foundational types that everything else builds on.
 * 
 * The Kernova Laws:
 * 1. Everything has an identity
 * 2. Everything has permissions
 * 3. Everything emits events
 * 4. Everything has history
 * 5. Everything is observable
 * 6. Everything is replaceable
 * 7. Everything is versioned
 * 8. Everything is documented
 * 9. Everything is testable
 * 10. Everything is secure
 */

/** Unique identifier for any Kernova object */
export type KernovaId = string;

/** @deprecated Use KernovaId instead. Will be removed in the next major version. */
export type NexusId = KernovaId;

/** ISO 8601 timestamp */
export type Timestamp = string;

/** Semantic version string */
export type Version = string;

/** Status that any object can be in */
export type LifecycleStatus =
  | 'created'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'archived'
  | 'deleted';

/** Priority levels */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/** Confidence score from 0 to 1 */
export type Confidence = number;

/**
 * The Universal Object Model
 * Every object in Kernova extends this base.
 * This is what makes the system consistent and auditable.
 */
export interface KernovaObject {
  /** Globally unique identifier */
  id: KernovaId;

  /** Object type discriminator */
  type: string;

  /** Semantic version of this object */
  version: Version;

  /** Who owns this object */
  owner: KernovaId;

  /** Current lifecycle status */
  status: LifecycleStatus;

  /** When this object was created */
  createdAt: Timestamp;

  /** When this object was last modified */
  updatedAt: Timestamp;

  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
}

/** @deprecated Use KernovaObject instead. Will be removed in the next major version. */
export type NexusObject = KernovaObject;

/**
 * Time-aware extension
 * Objects that have temporal significance
 */
export interface Temporal {
  /** When this becomes active */
  scheduledAt?: Timestamp;

  /** When this expires */
  expiresAt?: Timestamp;

  /** When this was archived */
  archivedAt?: Timestamp;
}

/**
 * Evidence trail
 * Supports Decision #68 — every decision has evidence
 */
export interface Evidence {
  /** Source documents or references */
  sources: EvidenceSource[];

  /** Confidence in this evidence */
  confidence: Confidence;

  /** Summary of reasoning */
  reasoning?: string;
}

export interface EvidenceSource {
  /** Type of source */
  type: 'document' | 'memory' | 'event' | 'policy' | 'external';

  /** Reference ID or URL */
  ref: string;

  /** Human-readable label */
  label: string;

  /** When this source was consulted */
  consultedAt: Timestamp;
}
