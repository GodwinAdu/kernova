/**
 * Unit Tests for ProactiveTriggerEngine — Cooldown Enforcement
 *
 * Validates: Requirement 11.3 — per-rule cooldown period enforcement
 *
 * Verifies:
 * - Rules cannot fire more than once within their cooldownMs window
 * - Cooldown is per-rule (independent between rules)
 * - lastFiredAt is persisted in SQLite and restored on restart
 * - After cooldown expires, the rule can fire again
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProactiveTriggerEngine } from './trigger-engine.js';
import { EventBus } from '../events/event-bus.js';

// ─── Helpers ─────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kernova-cooldown-test-'));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeEvent(eventType: string, id?: string) {
  return {
    id: id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    eventType,
    category: 'test' as const,
    severity: 'info' as const,
    timestamp: new Date().toISOString(),
    subjectId: 'test-subject',
    subjectType: 'test',
    actorId: 'test-actor',
    correlationId: `cor-${Date.now()}`,
    data: {},
    metadata: { schemaVersion: '1.0', source: 'test', environment: 'test' },
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('ProactiveTriggerEngine — Cooldown Enforcement', () => {
  let testDir: string;
  let eventBus: EventBus;

  beforeEach(async () => {
    testDir = createTempDir();
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
  });

  afterEach(async () => {
    await eventBus.stop();
    cleanupDir(testDir);
  });

  it('blocks a second firing within the cooldown window', async () => {
    const firings: number[] = [];

    const engine = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async () => {
        firings.push(Date.now());
      },
    });
    await engine.start();

    engine.register({
      name: 'cooldown-block-test',
      eventPattern: 'order.created',
      action: { goal: 'process order' },
      cooldownMs: 500,
    });

    // First event — should fire
    eventBus.publish(makeEvent('order.created'));
    await sleep(30);
    expect(firings.length).toBe(1);

    // Second event within cooldown window — should be blocked
    eventBus.publish(makeEvent('order.created'));
    await sleep(30);
    expect(firings.length).toBe(1);

    // Third event still within cooldown — still blocked
    eventBus.publish(makeEvent('order.created'));
    await sleep(30);
    expect(firings.length).toBe(1);

    await engine.stop();
  });

  it('allows firing again after cooldown expires', async () => {
    const firings: number[] = [];
    const cooldownMs = 150;

    const engine = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async () => {
        firings.push(Date.now());
      },
    });
    await engine.start();

    engine.register({
      name: 'cooldown-expire-test',
      eventPattern: 'task.completed',
      action: { goal: 'celebrate' },
      cooldownMs,
    });

    // First fire
    eventBus.publish(makeEvent('task.completed'));
    await sleep(30);
    expect(firings.length).toBe(1);

    // Wait for cooldown to expire
    await sleep(cooldownMs + 30);

    // Second fire — should work
    eventBus.publish(makeEvent('task.completed'));
    await sleep(30);
    expect(firings.length).toBe(2);

    // Verify gap between firings respects cooldown
    expect(firings[1] - firings[0]).toBeGreaterThanOrEqual(cooldownMs);

    await engine.stop();
  });

  it('cooldown is per-rule — independent rules have separate cooldowns', async () => {
    const firingsA: string[] = [];
    const firingsB: string[] = [];

    const engine = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async (action) => {
        if (action.goal === 'rule-a') firingsA.push('fired');
        if (action.goal === 'rule-b') firingsB.push('fired');
      },
    });
    await engine.start();

    // Rule A with long cooldown
    engine.register({
      name: 'rule-a',
      eventPattern: 'email.received',
      action: { goal: 'rule-a' },
      cooldownMs: 2000,
    });

    // Rule B with short cooldown
    engine.register({
      name: 'rule-b',
      eventPattern: 'email.received',
      action: { goal: 'rule-b' },
      cooldownMs: 100,
    });

    // Both fire on first event
    eventBus.publish(makeEvent('email.received'));
    await sleep(30);
    expect(firingsA.length).toBe(1);
    expect(firingsB.length).toBe(1);

    // Wait for B's cooldown to expire but A's still active
    await sleep(130);

    // Both see the event but only B should fire (A still in cooldown)
    eventBus.publish(makeEvent('email.received'));
    await sleep(30);
    expect(firingsA.length).toBe(1); // Still blocked
    expect(firingsB.length).toBe(2); // Fires again

    await engine.stop();
  });

  it('persists lastFiredAt and enforces cooldown after restart', async () => {
    const firings: string[] = [];
    const cooldownMs = 500;

    // Phase 1: Start engine, trigger once, stop
    const engine1 = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async () => {
        firings.push('fired');
      },
    });
    await engine1.start();

    const rule = engine1.register({
      name: 'persist-cooldown-test',
      eventPattern: 'data.synced',
      action: { goal: 'verify sync' },
      cooldownMs,
    });

    eventBus.publish(makeEvent('data.synced'));
    await sleep(30);
    expect(firings.length).toBe(1);

    await engine1.stop();

    // Phase 2: Restart immediately (within cooldown window)
    const engine2 = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async () => {
        firings.push('fired');
      },
    });
    await engine2.start();

    // Verify rule was loaded with lastFiredAt
    const rules = engine2.list();
    const restored = rules.find((r) => r.id === rule.id);
    expect(restored).toBeDefined();
    expect(restored!.lastFiredAt).toBeDefined();

    // Try to fire within original cooldown window — should be blocked
    eventBus.publish(makeEvent('data.synced'));
    await sleep(30);
    expect(firings.length).toBe(1); // No additional firing

    // Wait for cooldown to expire relative to original firing
    await sleep(cooldownMs + 50);

    // Now it should fire
    eventBus.publish(makeEvent('data.synced'));
    await sleep(30);
    expect(firings.length).toBe(2);

    await engine2.stop();
  });

  it('first event always fires (no prior cooldown state)', async () => {
    const firings: string[] = [];

    const engine = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async () => {
        firings.push('fired');
      },
    });
    await engine.start();

    engine.register({
      name: 'first-fire-test',
      eventPattern: 'alert.triggered',
      action: { goal: 'handle alert' },
      cooldownMs: 5000, // very long cooldown
    });

    // First event should always fire regardless of cooldown length
    eventBus.publish(makeEvent('alert.triggered'));
    await sleep(30);
    expect(firings.length).toBe(1);

    await engine.stop();
  });

  it('disabled rule does not fire even when cooldown has expired', async () => {
    const firings: string[] = [];

    const engine = new ProactiveTriggerEngine(eventBus, {
      dataDir: testDir,
      execute: async () => {
        firings.push('fired');
      },
    });
    await engine.start();

    const rule = engine.register({
      name: 'disabled-cooldown-test',
      eventPattern: 'report.generated',
      action: { goal: 'send report' },
      cooldownMs: 100,
    });

    // Fire once
    eventBus.publish(makeEvent('report.generated'));
    await sleep(30);
    expect(firings.length).toBe(1);

    // Disable the rule
    engine.disable(rule.id);

    // Wait for cooldown to expire
    await sleep(150);

    // Event shouldn't fire because rule is disabled
    eventBus.publish(makeEvent('report.generated'));
    await sleep(30);
    expect(firings.length).toBe(1);

    await engine.stop();
  });
});
