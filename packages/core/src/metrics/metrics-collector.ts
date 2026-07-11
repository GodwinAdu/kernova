/**
 * Kernova Metrics Collector
 *
 * Gathers runtime performance metrics for observability:
 * - Intent throughput (requests/sec)
 * - Latency percentiles (p50, p95, p99)
 * - Token usage over time
 * - Error rates
 * - Agent utilization
 * - Model provider latency
 *
 * Subscribes to EventBus for automatic collection.
 */

import type { NexusId, NexusEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface MetricEntry {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptime: number;
  intents: {
    total: number;
    succeeded: number;
    failed: number;
    active: number;
    avgDurationMs: number;
    p95DurationMs: number;
  };
  tokens: {
    total: number;
    last5min: number;
  };
  models: {
    requestCount: number;
    avgLatencyMs: number;
    errorRate: number;
  };
  agents: {
    registered: number;
    activeInstances: number;
  };
}

export interface MetricsConfig {
  /** How often to compute rolling metrics (ms) */
  rollupIntervalMs?: number;     // default: 60_000
  /** How many data points to retain */
  maxDataPoints?: number;        // default: 1000
}

export class MetricsCollector {
  private readonly eventBus: EventBus;
  private readonly config: Required<MetricsConfig>;
  private readonly startTime = Date.now();

  private intentDurations: number[] = [];
  private tokenCounts: Array<{ tokens: number; at: number }> = [];
  private modelLatencies: number[] = [];
  private counters = {
    intentsTotal: 0,
    intentsSucceeded: 0,
    intentsFailed: 0,
    intentsActive: 0,
    tokensTotal: 0,
    modelRequests: 0,
    modelErrors: 0,
  };

  private subscriptionId?: string;

  constructor(eventBus: EventBus, config?: MetricsConfig) {
    this.eventBus = eventBus;
    this.config = {
      rollupIntervalMs: config?.rollupIntervalMs ?? 60_000,
      maxDataPoints: config?.maxDataPoints ?? 1000,
    };
  }

  /**
   * Start collecting metrics from the EventBus.
   */
  start(): void {
    this.subscriptionId = this.eventBus.subscribe(['*'], (event: NexusEvent) => {
      this.processEvent(event);
    });
  }

  /**
   * Stop collecting metrics.
   */
  stop(): void {
    if (this.subscriptionId) {
      this.eventBus.unsubscribe(this.subscriptionId);
      this.subscriptionId = undefined;
    }
  }

  /**
   * Get a snapshot of current metrics.
   */
  snapshot(): MetricsSnapshot {
    const now5min = Date.now() - 300_000;
    const recentTokens = this.tokenCounts
      .filter(t => t.at > now5min)
      .reduce((sum, t) => sum + t.tokens, 0);

    return {
      timestamp: now(),
      uptime: Date.now() - this.startTime,
      intents: {
        total: this.counters.intentsTotal,
        succeeded: this.counters.intentsSucceeded,
        failed: this.counters.intentsFailed,
        active: this.counters.intentsActive,
        avgDurationMs: this.avg(this.intentDurations),
        p95DurationMs: this.percentile(this.intentDurations, 95),
      },
      tokens: {
        total: this.counters.tokensTotal,
        last5min: recentTokens,
      },
      models: {
        requestCount: this.counters.modelRequests,
        avgLatencyMs: this.avg(this.modelLatencies),
        errorRate: this.counters.modelRequests > 0
          ? this.counters.modelErrors / this.counters.modelRequests
          : 0,
      },
      agents: {
        registered: 0, // Would need kernel reference
        activeInstances: 0,
      },
    };
  }

  /**
   * Record a custom metric.
   */
  record(name: string, value: number, tags?: Record<string, string>): void {
    // Custom metrics could be exported to external systems
    this.emitEvent('metrics.recorded', name, { name, value, tags });
  }

  /**
   * Get raw counter values.
   */
  getCounters(): typeof this.counters {
    return { ...this.counters };
  }

  /**
   * Reset all metrics (e.g., for testing).
   */
  reset(): void {
    this.intentDurations = [];
    this.tokenCounts = [];
    this.modelLatencies = [];
    this.counters = {
      intentsTotal: 0,
      intentsSucceeded: 0,
      intentsFailed: 0,
      intentsActive: 0,
      tokensTotal: 0,
      modelRequests: 0,
      modelErrors: 0,
    };
  }

  // ─── Private ───────────────────────────────────────────────

  private processEvent(event: NexusEvent): void {
    switch (event.eventType) {
      case 'intent.created':
        this.counters.intentsTotal++;
        this.counters.intentsActive++;
        break;
      case 'intent.completed':
        this.counters.intentsSucceeded++;
        this.counters.intentsActive = Math.max(0, this.counters.intentsActive - 1);
        if (event.data?.durationMs) {
          this.addDataPoint(this.intentDurations, event.data.durationMs as number);
        }
        break;
      case 'intent.failed':
        this.counters.intentsFailed++;
        this.counters.intentsActive = Math.max(0, this.counters.intentsActive - 1);
        break;
      case 'model.completed':
        this.counters.modelRequests++;
        if (event.data?.tokens) {
          const tokens = event.data.tokens as number;
          this.counters.tokensTotal += tokens;
          this.tokenCounts.push({ tokens, at: Date.now() });
          if (this.tokenCounts.length > this.config.maxDataPoints) {
            this.tokenCounts.shift();
          }
        }
        if (event.data?.latencyMs) {
          this.addDataPoint(this.modelLatencies, event.data.latencyMs as number);
        }
        break;
      case 'model.fallback':
        this.counters.modelErrors++;
        break;
    }
  }

  private addDataPoint(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > this.config.maxDataPoints) {
      arr.shift();
    }
  }

  private avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'metrics',
      actorId: 'metrics-collector',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'metrics-collector', environment: 'runtime' },
    });
  }
}
