/**
 * Kernova Background Loop Module
 *
 * Continuously polls monitor functions at configurable intervals and submits
 * intents when conditions are detected. Uses setTimeout chaining (not setInterval)
 * to avoid drift. Persists loop metadata to SQLite; monitor functions are
 * re-registered by the application on startup.
 */

import type { NexusEvent, NexusId, BackgroundLoopDef, BackgroundLoopInput, LoopState, MonitorFunction, ScheduleTarget } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { LoopStore } from './loop-store.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';

export interface BackgroundLoopConfig {
  dataDir: string;
  /** Optional callback to execute when a monitor returns actionable result */
  execute?: (target: ScheduleTarget, result: unknown) => Promise<void>;
}

export class BackgroundLoopModule {
  private readonly eventBus: EventBus;
  private readonly config: BackgroundLoopConfig;
  private store: LoopStore | null = null;

  /** Loop definitions indexed by ID */
  private loops: Map<NexusId, BackgroundLoopDef> = new Map();

  /** Active setTimeout handles */
  private timers: Map<NexusId, NodeJS.Timeout> = new Map();

  /** Monitor functions (not persisted) */
  private monitors: Map<NexusId, MonitorFunction> = new Map();

  /** Previous monitor return value for context threading */
  private contexts: Map<NexusId, unknown> = new Map();

  /** Schedule targets for intent submission */
  private targets: Map<NexusId, ScheduleTarget> = new Map();

  constructor(eventBus: EventBus, config: BackgroundLoopConfig) {
    this.eventBus = eventBus;
    this.config = config;
  }

  /**
   * Start the module: open store, load persisted loops, resume active ones
   * that have a registered monitor function.
   */
  async start(): Promise<void> {
    this.store = new LoopStore({ dataDir: this.config.dataDir });

    const persisted = this.store.loadAll();
    for (const loop of persisted) {
      this.loops.set(loop.id, loop);

      // Only start polling if active AND a monitor was re-registered
      if (loop.state === 'active' && this.monitors.has(loop.id)) {
        this.startPolling(loop.id);
      }
    }
  }

  /**
   * Stop all active timers and close the store.
   */
  async stop(): Promise<void> {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  /**
   * Register a new background loop.
   * Validates interval bounds and duplicate ID. Persists, then starts polling.
   */
  register(input: BackgroundLoopInput): BackgroundLoopDef {
    // Validate interval bounds
    if (input.intervalMs < 1000) {
      throw new ValidationError('intervalMs', 'Polling interval must be at least 1000 milliseconds');
    }
    if (input.intervalMs > 86_400_000) {
      throw new ValidationError('intervalMs', 'Polling interval must not exceed 86,400,000 milliseconds (24 hours)');
    }

    // Determine ID
    const id = input.id ?? generateId('loop');

    // Duplicate check
    if (this.loops.has(id)) {
      throw new ValidationError('id', `Background loop with id '${id}' already exists`);
    }

    const timestamp = now();
    const def: BackgroundLoopDef = {
      id,
      name: input.name,
      intervalMs: input.intervalMs,
      state: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Persist
    if (this.store) {
      this.store.save(def);
    }

    // Store in memory
    this.loops.set(id, def);
    this.monitors.set(id, input.monitor);
    this.contexts.set(id, null);

    if (input.target) {
      this.targets.set(id, input.target);
    }

    // Start polling
    this.startPolling(id);

    return def;
  }

  /**
   * Pause an active loop. Clears the timer, updates state to 'paused'.
   */
  pause(loopId: NexusId): void {
    const loop = this.loops.get(loopId);
    if (!loop) {
      throw new ValidationError('loopId', `Background loop '${loopId}' not found`);
    }

    // Clear active timer
    const timer = this.timers.get(loopId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(loopId);
    }

    // Update state
    loop.state = 'paused';
    loop.updatedAt = now();
    if (this.store) {
      this.store.updateState(loopId, 'paused');
    }

    // Emit event
    this.emitEvent('loop.paused', loopId, { loopId, name: loop.name });
  }

  /**
   * Resume a paused loop. Resets context to null, starts polling.
   */
  resume(loopId: NexusId): void {
    const loop = this.loops.get(loopId);
    if (!loop) {
      throw new ValidationError('loopId', `Background loop '${loopId}' not found`);
    }

    // Update state
    loop.state = 'active';
    loop.updatedAt = now();
    if (this.store) {
      this.store.updateState(loopId, 'active');
    }

    // Reset context on resume
    this.contexts.set(loopId, null);

    // Start polling
    this.startPolling(loopId);

    // Emit event
    this.emitEvent('loop.resumed', loopId, { loopId, name: loop.name });
  }

  /**
   * Remove a loop entirely. Clears timer, removes from store and all maps.
   */
  remove(loopId: NexusId): void {
    const loop = this.loops.get(loopId);
    if (!loop) {
      throw new ValidationError('loopId', `Background loop '${loopId}' not found`);
    }

    // Clear timer
    const timer = this.timers.get(loopId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(loopId);
    }

    // Remove from store
    if (this.store) {
      this.store.remove(loopId);
    }

    // Remove from all maps
    this.loops.delete(loopId);
    this.monitors.delete(loopId);
    this.contexts.delete(loopId);
    this.targets.delete(loopId);

    // Emit event
    this.emitEvent('loop.removed', loopId, { loopId, name: loop.name });
  }

  /**
   * List all registered loops (active and paused).
   */
  list(): BackgroundLoopDef[] {
    return Array.from(this.loops.values());
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Start the setTimeout polling chain for a given loop.
   */
  private startPolling(loopId: NexusId): void {
    const loop = this.loops.get(loopId);
    if (!loop) return;

    const timer = setTimeout(() => this.tick(loopId), loop.intervalMs);
    this.timers.set(loopId, timer);
  }

  /**
   * Execute one polling tick: invoke monitor, handle result, schedule next.
   */
  private async tick(loopId: NexusId): Promise<void> {
    const loop = this.loops.get(loopId);
    if (!loop || loop.state !== 'active') return;

    const monitor = this.monitors.get(loopId);
    if (!monitor) return;

    const previousContext = this.contexts.get(loopId) ?? null;

    try {
      const result = await monitor(previousContext);

      // Store result as context for next invocation
      this.contexts.set(loopId, result);

      // If result is non-null/non-undefined, treat as actionable
      if (result !== null && result !== undefined) {
        await this.handleActionableResult(loopId, loop, result);
      }
    } catch (error) {
      // On monitor error: log, emit loop.error, continue next cycle
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[BackgroundLoop] Monitor error for '${loop.name}' (${loopId}):`, errorMessage);

      this.emitEvent('loop.error', loopId, {
        loopId,
        name: loop.name,
        error: errorMessage,
      });
    }

    // Schedule next tick (only if loop is still active and not removed)
    if (this.loops.has(loopId) && this.loops.get(loopId)!.state === 'active') {
      this.startPolling(loopId);
    }
  }

  /**
   * Handle an actionable monitor result: submit intent, emit events.
   */
  private async handleActionableResult(loopId: NexusId, loop: BackgroundLoopDef, result: unknown): Promise<void> {
    const target = this.targets.get(loopId);

    // Emit loop.action.triggered
    this.emitEvent('loop.action.triggered', loopId, {
      loopId,
      name: loop.name,
      result,
      target: target ?? null,
    });

    // If execute callback is provided, call it
    if (this.config.execute && target) {
      try {
        await this.config.execute(target, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.emitEvent('loop.action.failed', loopId, {
          loopId,
          name: loop.name,
          error: errorMessage,
          result,
        });
      }
    }
  }

  /**
   * Emit a typed event on the EventBus.
   */
  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    const event: NexusEvent = {
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('error') || eventType.includes('failed') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'background_loop',
      actorId: 'system',
      correlationId: subjectId,
      data,
      metadata: {
        schemaVersion: '1.0',
        source: 'background-loop',
        environment: process.env.NODE_ENV || 'development',
      },
    };

    this.eventBus.publish(event);
  }
}
