/**
 * Kernova Context Engine Manager
 *
 * Manages pluggable context engine instances.
 * Developers can register custom engines; the default is used
 * when none is specified.
 */

import type { NexusId, NexusEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { ModelRouter } from '../models/model-router.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import { generateId, now } from '../utils.js';
import type {
  ContextEnginePlugin,
  ContextMessage,
  AssembleResult,
  CompactResult,
} from './context-engine-plugin.js';
import { DefaultContextEngine } from './default-context-engine.js';

export class ContextEngineManager {
  private readonly eventBus: EventBus;
  private engines: Map<string, ContextEnginePlugin> = new Map();
  private defaultEngineId: string;

  constructor(
    eventBus: EventBus,
    modelRouter: ModelRouter,
    memory: MemoryEngine,
  ) {
    this.eventBus = eventBus;

    // Register built-in default engine
    const defaultEngine = new DefaultContextEngine(modelRouter, memory);
    this.engines.set(defaultEngine.info.id, defaultEngine);
    this.defaultEngineId = defaultEngine.info.id;
  }

  /**
   * Register a custom context engine plugin.
   */
  register(engine: ContextEnginePlugin): void {
    this.engines.set(engine.info.id, engine);
    this.emitEvent('context.engine.registered', engine.info.id, {
      name: engine.info.name,
      version: engine.info.version,
    });
  }

  /**
   * Set which engine is used by default.
   */
  setDefault(engineId: string): void {
    if (!this.engines.has(engineId)) {
      throw new Error(`Context engine '${engineId}' not registered`);
    }
    this.defaultEngineId = engineId;
  }

  /**
   * Get the active engine (default or specified).
   */
  getEngine(engineId?: string): ContextEnginePlugin {
    const id = engineId ?? this.defaultEngineId;
    const engine = this.engines.get(id);
    if (!engine) throw new Error(`Context engine '${id}' not found`);
    return engine;
  }

  /**
   * List all registered engines.
   */
  listEngines(): Array<{ id: string; name: string; version?: string }> {
    return Array.from(this.engines.values()).map(e => ({
      id: e.info.id,
      name: e.info.name,
      version: e.info.version,
    }));
  }

  /**
   * Assemble context using the active engine.
   */
  async assemble(
    sessionId: string,
    messages: ContextMessage[],
    tokenBudget: number,
    options?: { prompt?: string; engineId?: string },
  ): Promise<AssembleResult> {
    const engine = this.getEngine(options?.engineId);
    return engine.assemble({
      sessionId,
      messages,
      tokenBudget,
      prompt: options?.prompt,
    });
  }

  /**
   * Compact context using the active engine.
   */
  async compact(
    sessionId: string,
    messages: ContextMessage[],
    tokenBudget: number,
    options?: { force?: boolean; engineId?: string },
  ): Promise<CompactResult> {
    const engine = this.getEngine(options?.engineId);
    return engine.compact({
      sessionId,
      messages,
      tokenBudget,
      force: options?.force,
    });
  }

  /**
   * Dispose all engines.
   */
  async dispose(): Promise<void> {
    for (const engine of this.engines.values()) {
      if (engine.dispose) await engine.dispose();
    }
    this.engines.clear();
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'context_engine',
      actorId: 'context-engine-manager',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'context-engine-manager', environment: 'runtime' },
    });
  }
}
