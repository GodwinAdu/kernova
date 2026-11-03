/**
 * Timers longer than setTimeout's limit (2^31 - 1 ms, about 24.8 days). Node fires longer
 * delays after 1 ms, which ran far-off scheduled jobs immediately (and cron jobs in a loop).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_TIMER_DELAY_MS, setLongInterval, setLongTimeout } from '../utils.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { EventBus } from '../events/event-bus.js';

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe('setLongTimeout / setLongInterval', () => {
  it('waits the full delay past the setTimeout limit', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
    const fn = vi.fn();
    setLongTimeout(fn, 40 * DAY);

    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS + 1000);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40 * DAY - MAX_TIMER_DELAY_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled between steps', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
    const fn = vi.fn();
    const timer = setLongTimeout(fn, 60 * DAY);
    await vi.advanceTimersByTimeAsync(30 * DAY);
    timer.cancel();
    await vi.advanceTimersByTimeAsync(60 * DAY);
    expect(fn).not.toHaveBeenCalled();
  });

  it('repeats long intervals at the right times, and short ones as setInterval does', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
    const monthly = vi.fn();
    const often = vi.fn();
    const long = setLongInterval(monthly, 30 * DAY);
    const short = setLongInterval(often, DAY);

    await vi.advanceTimersByTimeAsync(29 * DAY);
    expect(monthly).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31 * DAY);
    expect(monthly).toHaveBeenCalledTimes(2);

    short.cancel();
    const shortCalls = often.mock.calls.length;
    expect(shortCalls).toBe(60);
    long.cancel();
    await vi.advanceTimersByTimeAsync(60 * DAY);
    expect(monthly).toHaveBeenCalledTimes(2);
    expect(often).toHaveBeenCalledTimes(shortCalls);
  });
});

describe('Scheduler with far-off jobs', () => {
  it("doesn't run a job due in 40 days right away", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const dir = mkdtempSync(join(tmpdir(), 'kernova-long-timer-'));
    const execute = vi.fn(async () => 'done');
    const scheduler = new Scheduler(new EventBus({ persistent: false }), { dataDir: dir, execute });
    try {
      await scheduler.start();
      scheduler.register({ name: 'quarterly-report', oneShot: true, delayMs: 40 * DAY, target: { type: 'intent', goal: 'report' } });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(execute).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(40 * DAY);
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      await scheduler.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
