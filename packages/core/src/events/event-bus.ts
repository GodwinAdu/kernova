/**
 * Nexus Event Bus
 * 
 * The nervous system of the runtime.
 * Every state change, every action, every decision flows through here.
 * 
 * Dual-mode operation:
 * - In-memory: Fast pub/sub for real-time subscribers
 * - Persistent: SQLite storage for history, timeline, and replay
 * 
 * When persistence is enabled (default in development), every published event
 * is automatically written to SQLite. The in-memory history serves as a
 * hot cache for recent events.
 */

import type { NexusEvent, NexusId } from '@nexus/types';
import { EventStore, type EventStoreConfig, type EventQuery, type EventStoreStats } from './event-store.js';
import { generateId } from '../utils.js';

type EventHandler = (event: NexusEvent) => void | Promise<void>;

interface Subscription {
  id: string;
  patterns: string[];
  handler: EventHandler;
}

export interface EventBusConfig {
  /** Enable persistent storage (default: true) */
  persistent?: boolean;

  /** SQLite configuration */
  store?: EventStoreConfig;

  /** Maximum in-memory history size (hot cache) */
  maxHistorySize?: number;
}

export class EventBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private history: NexusEvent[] = [];
  private maxHistorySize: number;
  private store: EventStore | null = null;
  private persistent: boolean;
  private storeConfig: EventStoreConfig;
  private running = false;

  constructor(config: EventBusConfig = {}) {
    this.persistent = config.persistent !== false; // Default: enabled
    this.storeConfig = config.store || {};
    this.maxHistorySize = config.maxHistorySize || 1000;
  }

  async start(): Promise<void> {
    if (this.persistent) {
      this.store = new EventStore(this.storeConfig);
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  /**
   * Publish an event to all matching subscribers and persist to storage.
   */
  publish(event: NexusEvent): void {
    // Store in hot cache (in-memory)
    this.history.push(event);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    // Persist to SQLite (async batched)
    if (this.store) {
      this.store.append(event);
    }

    // Dispatch to matching subscribers
    for (const sub of this.subscriptions.values()) {
      if (this.matches(event, sub.patterns)) {
        try {
          const result = sub.handler(event);
          if (result instanceof Promise) {
            result.catch(err => {
              console.error(`[EventBus] Handler error for ${event.eventType}:`, err);
            });
          }
        } catch (err) {
          console.error(`[EventBus] Handler error for ${event.eventType}:`, err);
        }
      }
    }
  }

  /**
   * Subscribe to events matching patterns.
   * Patterns support wildcards: "intent.*", "*.created", "*"
   */
  subscribe(patterns: string[], handler: EventHandler): string {
    const id = generateId('sub');
    this.subscriptions.set(id, { id, patterns, handler });
    return id;
  }

  /**
   * Unsubscribe
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get event timeline for a specific object.
   * Uses persistent store if available, falls back to in-memory.
   */
  getTimeline(subjectId: NexusId, limit = 100): NexusEvent[] {
    if (this.store) {
      return this.store.getTimeline(subjectId, limit);
    }
    return this.history
      .filter(e => e.subjectId === subjectId)
      .slice(-limit);
  }

  /**
   * Get events by correlation ID (trace a full request flow).
   */
  getCorrelated(correlationId: NexusId, limit = 100): NexusEvent[] {
    if (this.store) {
      return this.store.getCorrelated(correlationId, limit);
    }
    return this.history
      .filter(e => e.correlationId === correlationId)
      .slice(-limit);
  }

  /**
   * Query events with rich filtering.
   * Only available with persistent storage enabled.
   */
  query(params: EventQuery): NexusEvent[] {
    if (this.store) {
      return this.store.query(params);
    }

    // Fallback: basic in-memory filtering
    let results = [...this.history];

    if (params.type) {
      results = results.filter(e => this.matchesPattern(e.eventType, params.type!));
    }
    if (params.category) {
      results = results.filter(e => e.category === params.category);
    }
    if (params.subjectId) {
      results = results.filter(e => e.subjectId === params.subjectId);
    }
    if (params.actorId) {
      results = results.filter(e => e.actorId === params.actorId);
    }

    if (params.order === 'asc') {
      results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } else {
      results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    return results.slice(params.offset || 0, (params.offset || 0) + (params.limit || 100));
  }

  /**
   * Count events matching criteria
   */
  count(params?: Omit<EventQuery, 'limit' | 'offset' | 'order'>): number {
    if (this.store) {
      return this.store.count(params);
    }
    return this.history.length;
  }

  /**
   * Get event store statistics
   */
  getStats(): EventStoreStats | null {
    if (this.store) {
      return this.store.getStats();
    }
    return null;
  }

  /**
   * Get all events matching a type pattern (from hot cache)
   */
  getEvents(eventType: string, limit = 100): NexusEvent[] {
    return this.history
      .filter(e => this.matchesPattern(e.eventType, eventType))
      .slice(-limit);
  }

  /**
   * Get total event count (from store if available)
   */
  get eventCount(): number {
    if (this.store) {
      return this.store.count();
    }
    return this.history.length;
  }

  /**
   * Whether persistent storage is active
   */
  get isPersistent(): boolean {
    return this.store !== null;
  }

  /**
   * Flush pending writes to disk (useful before shutdown)
   */
  flush(): void {
    if (this.store) {
      this.store.flush();
    }
  }

  /**
   * Apply retention policy — delete events older than N days.
   */
  applyRetention(retentionDays: number): number {
    if (this.store) {
      return this.store.applyRetention(retentionDays);
    }
    return 0;
  }

  /**
   * Check if an event matches any of the patterns
   */
  private matches(event: NexusEvent, patterns: string[]): boolean {
    return patterns.some(pattern => this.matchesPattern(event.eventType, pattern));
  }

  /**
   * Pattern matching with wildcards
   * "intent.*" matches "intent.created", "intent.completed"
   * "*.created" matches "intent.created", "agent.created"
   * "*" matches everything
   */
  private matchesPattern(eventType: string, pattern: string): boolean {
    if (pattern === '*') return true;

    const patternParts = pattern.split('.');
    const typeParts = eventType.split('.');

    if (patternParts.length !== typeParts.length) return false;

    return patternParts.every((part, i) => {
      return part === '*' || part === typeParts[i];
    });
  }
}
