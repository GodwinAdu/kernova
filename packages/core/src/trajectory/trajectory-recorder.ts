/**
 * Kernova Trajectory Recorder
 *
 * Records execution traces for debugging and observability:
 * - Every intent, agent selection, tool call, model request
 * - Structured JSONL-compatible event stream
 * - Per-trace grouping with metadata
 * - Secret redaction
 * - Size-bounded (max events, max age)
 *
 * Inspired by OpenClaw's trajectory/ system.
 */

import type {
  KernovaId,
  KernovaEvent,
  TrajectoryEvent,
  TrajectoryTrace,
  TrajectoryEventType,
  TrajectoryConfig,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface TrajectoryRecorderConfig {
  enabled: boolean;
  maxEvents: number;
  maxAgeMs: number;
  redactSecrets: boolean;
}

const DEFAULT_CONFIG: TrajectoryRecorderConfig = {
  enabled: false,
  maxEvents: 1000,
  maxAgeMs: 3_600_000,
  redactSecrets: true,
};

/** Patterns that indicate sensitive data in keys */
const SECRET_PATTERNS = /key|token|secret|password|auth|credential|apikey/i;

export class TrajectoryRecorder {
  private readonly eventBus: EventBus;
  private readonly config: TrajectoryRecorderConfig;

  /** Active traces by trace ID */
  private traces: Map<KernovaId, TrajectoryTrace> = new Map();

  /** Sequence counter per trace */
  private sequences: Map<KernovaId, number> = new Map();

  /** Subscription ID for event bus */
  private subscriptionId?: string;

  constructor(eventBus: EventBus, config?: Partial<TrajectoryConfig>) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start recording. Subscribes to all events on the EventBus.
   */
  start(): void {
    if (!this.config.enabled) return;

    this.subscriptionId = this.eventBus.subscribe(['*'], (event: KernovaEvent) => {
      this.recordFromEvent(event);
    });
  }

  /**
   * Stop recording. Unsubscribes from the EventBus.
   */
  stop(): void {
    if (this.subscriptionId) {
      this.eventBus.unsubscribe(this.subscriptionId);
      this.subscriptionId = undefined;
    }
  }

  /**
   * Begin a new trace (typically when an intent is submitted).
   */
  beginTrace(metadata?: Record<string, unknown>): TrajectoryTrace {
    this.pruneOldTraces();

    const trace: TrajectoryTrace = {
      id: generateId('trace'),
      startedAt: now(),
      events: [],
      metadata: {
        intentGoal: metadata?.goal as string | undefined,
        agentName: metadata?.agentName as string | undefined,
      },
    };

    this.traces.set(trace.id, trace);
    this.sequences.set(trace.id, 0);
    return trace;
  }

  /**
   * Record an event into a trace.
   */
  record(
    traceId: KernovaId,
    type: TrajectoryEventType,
    data?: Record<string, unknown>,
  ): TrajectoryEvent | null {
    if (!this.config.enabled) return null;

    const trace = this.traces.get(traceId);
    if (!trace) return null;

    // Enforce max events
    if (trace.events.length >= this.config.maxEvents) return null;

    const seq = (this.sequences.get(traceId) ?? 0) + 1;
    this.sequences.set(traceId, seq);

    const event: TrajectoryEvent = {
      id: generateId('tevt'),
      traceId,
      type,
      timestamp: now(),
      seq,
      data: this.config.redactSecrets ? this.redact(data) : data,
    };

    trace.events.push(event);
    return event;
  }

  /**
   * End a trace (mark as complete with final metadata).
   */
  endTrace(traceId: KernovaId, metadata?: Record<string, unknown>): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    trace.endedAt = now();
    if (metadata) {
      trace.metadata = { ...trace.metadata, ...metadata };
    }
    trace.metadata.durationMs = Date.now() - new Date(trace.startedAt).getTime();
  }

  /**
   * Get a trace by ID.
   */
  getTrace(traceId: KernovaId): TrajectoryTrace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * List all traces (most recent first).
   */
  listTraces(): TrajectoryTrace[] {
    return Array.from(this.traces.values()).reverse();
  }

  /**
   * Export a trace as JSONL string (one event per line).
   */
  exportJsonl(traceId: KernovaId): string | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;
    return trace.events.map(e => JSON.stringify(e)).join('\n');
  }

  /**
   * Clear all traces.
   */
  clear(): void {
    this.traces.clear();
    this.sequences.clear();
  }

  /**
   * Get whether recording is enabled.
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Record an EventBus event into the most recent active trace.
   */
  private recordFromEvent(event: KernovaEvent): void {
    const type = this.mapEventType(event.eventType);
    if (!type) return;

    // Find active trace by correlation
    const activeTrace = this.findActiveTrace(event.correlationId);
    if (!activeTrace) return;

    this.record(activeTrace.id, type, {
      eventType: event.eventType,
      subjectId: event.subjectId,
      actorId: event.actorId,
      ...event.data,
    });
  }

  private findActiveTrace(correlationId?: string): TrajectoryTrace | undefined {
    // Find the most recently created trace that hasn't ended
    for (const trace of Array.from(this.traces.values()).reverse()) {
      if (!trace.endedAt) return trace;
    }
    return undefined;
  }

  private mapEventType(eventType: string): TrajectoryEventType | null {
    if (eventType.startsWith('intent.')) return eventType as TrajectoryEventType;
    if (eventType.startsWith('agent.')) return eventType.replace('agent.', 'agent.') as TrajectoryEventType;
    if (eventType.startsWith('model.')) return eventType as TrajectoryEventType;
    if (eventType === 'tool.called' || eventType === 'tool.result') return eventType as TrajectoryEventType;
    if (eventType.startsWith('memory.')) return eventType as TrajectoryEventType;
    return 'event.emitted';
  }

  /**
   * Redact values in data that look like secrets.
   */
  private redact(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return data;
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SECRET_PATTERNS.test(key)) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        redacted[key] = this.redact(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  /**
   * Remove traces older than maxAgeMs.
   */
  private pruneOldTraces(): void {
    const cutoff = Date.now() - this.config.maxAgeMs;
    for (const [id, trace] of this.traces) {
      if (new Date(trace.startedAt).getTime() < cutoff) {
        this.traces.delete(id);
        this.sequences.delete(id);
      }
    }
  }
}
