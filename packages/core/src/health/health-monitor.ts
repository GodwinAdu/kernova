/**
 * Kernova Health Monitor
 *
 * System health checks with configurable probes:
 * - Kernel running state
 * - Model provider connectivity
 * - Memory engine state
 * - EventBus health
 * - Custom health checks
 * - Periodic health polling with alerting
 */

import type { KernovaId, KernovaEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheck {
  id: string;
  name: string;
  check: () => Promise<HealthCheckResult> | HealthCheckResult;
}

export interface HealthCheckResult {
  state: HealthState;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface HealthStatus {
  overall: HealthState;
  timestamp: string;
  checks: Array<{
    id: string;
    name: string;
    state: HealthState;
    message?: string;
    latencyMs?: number;
  }>;
  uptime: number;
}

export interface HealthMonitorConfig {
  /** Interval for periodic health checks (ms). 0 = disabled */
  intervalMs?: number;           // default: 0 (manual only)
  /** Callback when health state changes */
  onStateChange?: (oldState: HealthState, newState: HealthState) => void;
}

export class HealthMonitor {
  private readonly eventBus: EventBus;
  private readonly config: HealthMonitorConfig;
  private readonly startTime = Date.now();
  private checks: Map<string, HealthCheck> = new Map();
  private lastState: HealthState = 'unknown';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(eventBus: EventBus, config?: HealthMonitorConfig) {
    this.eventBus = eventBus;
    this.config = config ?? {};
  }

  /**
   * Register a health check probe.
   */
  addCheck(check: HealthCheck): void {
    this.checks.set(check.id, check);
  }

  /**
   * Remove a health check.
   */
  removeCheck(id: string): void {
    this.checks.delete(id);
  }

  /**
   * Run all health checks and return overall status.
   */
  async check(): Promise<HealthStatus> {
    const results: HealthStatus['checks'] = [];

    for (const [id, hc] of this.checks) {
      const start = Date.now();
      try {
        const result = await hc.check();
        results.push({
          id,
          name: hc.name,
          state: result.state,
          message: result.message,
          latencyMs: result.latencyMs ?? (Date.now() - start),
        });
      } catch (error) {
        results.push({
          id,
          name: hc.name,
          state: 'unhealthy',
          message: error instanceof Error ? error.message : 'Check failed',
          latencyMs: Date.now() - start,
        });
      }
    }

    // Determine overall state
    const overall = this.computeOverall(results.map(r => r.state));

    // Detect state change
    if (overall !== this.lastState) {
      const oldState = this.lastState;
      this.lastState = overall;
      this.config.onStateChange?.(oldState, overall);
      this.emitEvent('health.state.changed', 'health', {
        oldState,
        newState: overall,
      });
    }

    return {
      overall,
      timestamp: now(),
      checks: results,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Start periodic health checking.
   */
  startPolling(): void {
    const interval = this.config.intervalMs;
    if (!interval || interval <= 0) return;

    this.pollTimer = setInterval(() => {
      this.check().catch(() => {});
    }, interval);
  }

  /**
   * Stop periodic health checking.
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Get the last known health state.
   */
  get state(): HealthState {
    return this.lastState;
  }

  // ─── Private ───────────────────────────────────────────────

  private computeOverall(states: HealthState[]): HealthState {
    if (states.length === 0) return 'unknown';
    if (states.some(s => s === 'unhealthy')) return 'unhealthy';
    if (states.some(s => s === 'degraded')) return 'degraded';
    if (states.every(s => s === 'healthy')) return 'healthy';
    return 'degraded';
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: data.newState === 'unhealthy' ? 'error' : data.newState === 'degraded' ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'health',
      actorId: 'health-monitor',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'health-monitor', environment: 'runtime' },
    });
  }
}
