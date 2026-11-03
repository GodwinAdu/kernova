/**
 * Kernova Event System
 * 
 * Kernova is Event Native.
 * Every object has a timeline. Every state change emits an event.
 * Events are the source of truth for what happened and when.
 */

import type {
  KernovaObject,
  KernovaId,
  Timestamp,
} from './base.js';

/** Categories of events */
export type EventCategory =
  | 'intent'      // Intent lifecycle events
  | 'agent'       // Agent lifecycle events
  | 'workflow'    // Workflow execution events
  | 'memory'      // Memory operations
  | 'identity'    // Auth/identity events
  | 'system'      // Platform-level events
  | 'tool'        // Tool execution events
  | 'model'       // Model interaction events
  | 'governance'  // Policy/audit events
  | 'test';       // Test/development events

/** Event severity for observability */
export type EventSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/**
 * Base Event
 * 
 * Every event in Kernova follows this structure.
 * Events are immutable once created.
 */
export interface KernovaEvent {
  /** Unique event ID */
  id: KernovaId;

  /** Event type (domain.action format) */
  eventType: string;

  /** Event category */
  category: EventCategory;

  /** Severity level */
  severity: EventSeverity;

  /** When it happened */
  timestamp: Timestamp;

  /** What object this event is about */
  subjectId: KernovaId;

  /** What type of object */
  subjectType: string;

  /** Who/what caused this event */
  actorId: KernovaId;

  /** Correlation ID for tracing related events */
  correlationId: KernovaId;

  /** Causation ID (which event caused this one) */
  causationId?: KernovaId;

  /** Event payload */
  data: Record<string, unknown>;

  /** Metadata */
  metadata: EventMetadata;
}

/** @deprecated Use KernovaEvent instead. Will be removed in the next major version. */
export type NexusEvent = KernovaEvent;

export interface EventMetadata {
  /** Schema version of this event */
  schemaVersion: string;

  /** Source service/module */
  source: string;

  /** Environment */
  environment: string;

  /** Trace context for distributed tracing */
  traceId?: string;

  /** Span ID */
  spanId?: string;
}

/**
 * Event Subscription
 * How consumers subscribe to events
 */
export interface EventSubscription extends KernovaObject {
  type: 'event_subscription';

  /** What event types to subscribe to (supports wildcards) */
  patterns: string[];

  /** Filter conditions */
  filter?: EventFilter;

  /** Where to deliver events */
  target: EventTarget;

  /** Delivery guarantees */
  delivery: 'at-most-once' | 'at-least-once' | 'exactly-once';
}

export interface EventFilter {
  /** Only events from these categories */
  categories?: EventCategory[];

  /** Only events about these object types */
  subjectTypes?: string[];

  /** Only events from these actors */
  actorIds?: KernovaId[];

  /** Custom filter expression */
  expression?: string;
}

export interface EventTarget {
  /** Target type */
  type: 'agent' | 'webhook' | 'workflow' | 'queue' | 'function';

  /** Target reference */
  ref: string;

  /** Configuration */
  config?: Record<string, unknown>;
}

/**
 * Timeline
 * The ordered sequence of events for any object
 */
export interface Timeline {
  /** The object this timeline belongs to */
  subjectId: KernovaId;

  /** Ordered events */
  events: KernovaEvent[];

  /** Total event count */
  total: number;
}
