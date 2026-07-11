/**
 * Kernova Proactive Trigger Engine
 *
 * Event-driven rule engine that monitors the EventBus for matching patterns
 * and fires actions (intent submissions) when conditions are met.
 *
 * Design decisions:
 * - Cooldown tracked in-memory via Map<NexusId, number> for fast lookup
 * - Condition functions are runtime-only (not serialized); persisted rules
 *   store a human-readable description instead
 * - Subscriptions managed per-rule to allow individual enable/disable
 * - Duplicate detection uses the store's unique index (pattern + condition_description)
 */

import type {
  NexusId,
  NexusEvent,
  TriggerRule,
  TriggerRuleInput,
  TriggerActionDef,
  TriggerCondition,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { TriggerStore } from './trigger-store.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';

export interface TriggerEngineConfig {
  dataDir: string;
  execute?: (action: TriggerActionDef) => Promise<void>;
}

/**
 * Regex for valid event patterns:
 * Dot-separated segments where each segment is either alphanumeric or a single `*`.
 */
const EVENT_PATTERN_REGEX = /^([a-zA-Z0-9]+|\*)(\.[a-zA-Z0-9]+|\.\*)*$/;

const MAX_PATTERN_LENGTH = 256;

export class ProactiveTriggerEngine {
  private readonly eventBus: EventBus;
  private readonly config: TriggerEngineConfig;
  private readonly store: TriggerStore;

  /** All registered rules keyed by rule ID */
  private rules: Map<NexusId, TriggerRule> = new Map();

  /** EventBus subscription IDs keyed by rule ID */
  private subscriptionIds: Map<NexusId, string> = new Map();

  /** Last-fired timestamps (ms since epoch) keyed by rule ID for cooldown tracking */
  private lastFiredTimestamps: Map<NexusId, number> = new Map();

  /** Runtime condition functions keyed by rule ID (not persisted) */
  private conditions: Map<NexusId, TriggerCondition> = new Map();

  constructor(eventBus: EventBus, config: TriggerEngineConfig) {
    this.eventBus = eventBus;
    this.config = config;
    this.store = new TriggerStore({ dataDir: config.dataDir });
  }

  /**
   * Start the trigger engine: load persisted rules and subscribe enabled ones.
   */
  async start(): Promise<void> {
    const persisted = this.store.loadAll();

    for (const rule of persisted) {
      this.rules.set(rule.id, rule);

      // Restore last-fired timestamp if available
      if (rule.lastFiredAt) {
        this.lastFiredTimestamps.set(rule.id, new Date(rule.lastFiredAt).getTime());
      }

      // Subscribe enabled rules to EventBus
      if (rule.enabled) {
        this.subscribeRule(rule);
      }
    }
  }

  /**
   * Stop the trigger engine: unsubscribe all rules.
   */
  async stop(): Promise<void> {
    for (const [ruleId, subId] of this.subscriptionIds) {
      this.eventBus.unsubscribe(subId);
    }
    this.subscriptionIds.clear();
    this.store.close();
  }

  /**
   * Register a new trigger rule.
   *
   * Validates the event pattern, checks for duplicates, persists, and
   * subscribes if enabled.
   */
  register(input: TriggerRuleInput): TriggerRule {
    // Validate event pattern syntax
    this.validateEventPattern(input.eventPattern);

    // Build rule
    const timestamp = now();
    const rule: TriggerRule = {
      id: generateId('trigger'),
      name: input.name,
      eventPattern: input.eventPattern,
      condition: input.conditionDescription,
      action: input.action,
      enabled: input.enabled !== false, // default true
      cooldownMs: input.cooldownMs ?? 1000,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Validate cooldown minimum
    if (rule.cooldownMs < 100) {
      throw new ValidationError('cooldownMs', 'Cooldown must be at least 100 milliseconds');
    }

    // Persist (the store's unique index will reject duplicates for
    // same pattern + condition_description combo where enabled = 1)
    try {
      this.store.save(rule);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint failed') || message.includes('idx_trigger_rules_unique_combo')) {
        throw new ValidationError(
          'eventPattern',
          `A rule with pattern "${input.eventPattern}" and condition "${input.conditionDescription ?? ''}" already exists`,
        );
      }
      throw err;
    }

    // Store in memory
    this.rules.set(rule.id, rule);

    // Store condition function if provided
    if (input.condition) {
      this.conditions.set(rule.id, input.condition);
    }

    // Subscribe if enabled
    if (rule.enabled) {
      this.subscribeRule(rule);
    }

    return rule;
  }

  /**
   * Remove a trigger rule.
   */
  remove(ruleId: NexusId): void {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return;
    }

    // Unsubscribe from EventBus
    const subId = this.subscriptionIds.get(ruleId);
    if (subId) {
      this.eventBus.unsubscribe(subId);
      this.subscriptionIds.delete(ruleId);
    }

    // Remove from store
    this.store.remove(ruleId);

    // Remove from memory
    this.rules.delete(ruleId);
    this.lastFiredTimestamps.delete(ruleId);
    this.conditions.delete(ruleId);

    // Emit trigger.removed event
    this.eventBus.publish({
      id: generateId('evt'),
      eventType: 'trigger.removed',
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId: ruleId,
      subjectType: 'trigger_rule',
      actorId: 'system',
      correlationId: generateId('cor'),
      data: { ruleId, name: rule.name },
      metadata: { schemaVersion: '1.0', source: 'trigger-engine', environment: 'runtime' },
    });
  }

  /**
   * Enable a trigger rule and subscribe to EventBus.
   */
  enable(ruleId: NexusId): void {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.enabled) {
      return;
    }

    rule.enabled = true;
    rule.updatedAt = now();
    this.store.updateEnabled(ruleId, true);

    this.subscribeRule(rule);
  }

  /**
   * Disable a trigger rule and unsubscribe from EventBus.
   */
  disable(ruleId: NexusId): void {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.enabled) {
      return;
    }

    rule.enabled = false;
    rule.updatedAt = now();
    this.store.updateEnabled(ruleId, false);

    const subId = this.subscriptionIds.get(ruleId);
    if (subId) {
      this.eventBus.unsubscribe(subId);
      this.subscriptionIds.delete(ruleId);
    }
  }

  /**
   * List all registered trigger rules.
   */
  list(): TriggerRule[] {
    return [...this.rules.values()];
  }

  // ─── Private Helpers ──────────────────────────────────────────

  /**
   * Validate event pattern syntax.
   */
  private validateEventPattern(pattern: string): void {
    if (!pattern || pattern.length === 0) {
      throw new ValidationError('eventPattern', 'Event pattern must not be empty');
    }

    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new ValidationError(
        'eventPattern',
        `Event pattern must not exceed ${MAX_PATTERN_LENGTH} characters`,
      );
    }

    if (!EVENT_PATTERN_REGEX.test(pattern)) {
      throw new ValidationError(
        'eventPattern',
        'Event pattern must be dot-separated segments of alphanumeric characters or "*"',
      );
    }
  }

  /**
   * Subscribe a rule to the EventBus and store the subscription ID.
   */
  private subscribeRule(rule: TriggerRule): void {
    const subId = this.eventBus.subscribe([rule.eventPattern], (event: NexusEvent) => {
      this.handleEvent(rule.id, event);
    });
    this.subscriptionIds.set(rule.id, subId);
  }

  /**
   * Handle an incoming event for a specific rule.
   * Flow: cooldown check → condition evaluation → fire action.
   */
  private handleEvent(ruleId: NexusId, event: NexusEvent): void {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.enabled) {
      return;
    }

    // Check cooldown
    const lastFired = this.lastFiredTimestamps.get(ruleId);
    if (lastFired !== undefined) {
      const elapsed = Date.now() - lastFired;
      if (elapsed < rule.cooldownMs) {
        return; // Still in cooldown, skip
      }
    }

    // Evaluate condition (if present)
    const condition = this.conditions.get(ruleId);
    if (condition) {
      let result: boolean;
      try {
        result = condition(event);
      } catch (err: unknown) {
        // Condition threw — emit error event and skip action
        this.eventBus.publish({
          id: generateId('evt'),
          eventType: 'trigger.condition.error',
          category: 'system',
          severity: 'warn',
          timestamp: now(),
          subjectId: ruleId,
          subjectType: 'trigger_rule',
          actorId: 'system',
          correlationId: event.correlationId,
          data: {
            ruleId,
            eventId: event.id,
            error: err instanceof Error ? err.message : String(err),
          },
          metadata: { schemaVersion: '1.0', source: 'trigger-engine', environment: 'runtime' },
        });
        return;
      }

      if (!result) {
        return; // Condition returned false, skip
      }
    }

    // Fire action
    this.fireAction(rule, event);
  }

  /**
   * Fire the rule's action: update cooldown, call execute callback, emit events.
   */
  private fireAction(rule: TriggerRule, event: NexusEvent): void {
    // Update cooldown timestamp
    const firedAt = Date.now();
    this.lastFiredTimestamps.set(rule.id, firedAt);

    // Persist last fired
    const firedTimestamp = now();
    rule.lastFiredAt = firedTimestamp;
    rule.updatedAt = firedTimestamp;
    this.store.updateLastFired(rule.id, firedTimestamp);

    // Execute action (async — fire and forget with error handling)
    if (this.config.execute) {
      this.config.execute(rule.action)
        .then(() => {
          // Emit trigger.fired on success
          this.eventBus.publish({
            id: generateId('evt'),
            eventType: 'trigger.fired',
            category: 'system',
            severity: 'info',
            timestamp: now(),
            subjectId: rule.id,
            subjectType: 'trigger_rule',
            actorId: 'system',
            correlationId: event.correlationId,
            data: {
              ruleId: rule.id,
              triggeringEventId: event.id,
              action: rule.action,
            },
            metadata: { schemaVersion: '1.0', source: 'trigger-engine', environment: 'runtime' },
          });
        })
        .catch((err: unknown) => {
          // Emit trigger.action.failed on error
          this.eventBus.publish({
            id: generateId('evt'),
            eventType: 'trigger.action.failed',
            category: 'system',
            severity: 'error',
            timestamp: now(),
            subjectId: rule.id,
            subjectType: 'trigger_rule',
            actorId: 'system',
            correlationId: event.correlationId,
            data: {
              ruleId: rule.id,
              triggeringEventId: event.id,
              error: err instanceof Error ? err.message : String(err),
            },
            metadata: { schemaVersion: '1.0', source: 'trigger-engine', environment: 'runtime' },
          });
        });
    } else {
      // No execute callback — just emit trigger.fired
      this.eventBus.publish({
        id: generateId('evt'),
        eventType: 'trigger.fired',
        category: 'system',
        severity: 'info',
        timestamp: now(),
        subjectId: rule.id,
        subjectType: 'trigger_rule',
        actorId: 'system',
        correlationId: event.correlationId,
        data: {
          ruleId: rule.id,
          triggeringEventId: event.id,
          action: rule.action,
        },
        metadata: { schemaVersion: '1.0', source: 'trigger-engine', environment: 'runtime' },
      });
    }
  }
}
