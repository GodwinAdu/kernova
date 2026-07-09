/**
 * Memory Engine Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine } from '../memory/memory-engine.js';
import { EventBus } from '../events/event-bus.js';

describe('MemoryEngine', () => {
  let engine: MemoryEngine;
  let eventBus: EventBus;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();
    engine = new MemoryEngine(eventBus, { persistent: false });
    await engine.start();
  });

  afterEach(async () => {
    await engine.stop();
    await eventBus.stop();
  });

  it('should store and retrieve memories', async () => {
    await engine.store({ content: 'Hello world', layer: 'session' });
    const results = await engine.query({ layers: ['session'] });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Hello world');
    expect(results[0].layer).toBe('session');
  });

  it('should respect layer filtering', async () => {
    await engine.store({ content: 'Working memory', layer: 'working' });
    await engine.store({ content: 'Session memory', layer: 'session' });
    await engine.store({ content: 'Long-term memory', layer: 'longterm' });

    const working = await engine.query({ layers: ['working'] });
    expect(working).toHaveLength(1);
    expect(working[0].content).toBe('Working memory');

    const longterm = await engine.query({ layers: ['longterm'] });
    expect(longterm).toHaveLength(1);
    expect(longterm[0].content).toBe('Long-term memory');
  });

  it('should filter by owner', async () => {
    await engine.store({ content: 'User A', layer: 'longterm', owner: 'user-a' });
    await engine.store({ content: 'User B', layer: 'longterm', owner: 'user-b' });

    const results = await engine.query({ ownerId: 'user-a' });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('User A');
  });

  it('should search by text', async () => {
    await engine.store({ content: 'TypeScript is great', layer: 'longterm' });
    await engine.store({ content: 'Python is popular', layer: 'longterm' });

    const results = await engine.query({ query: 'TypeScript' });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('TypeScript');
  });

  it('should sort by relevance * confidence', async () => {
    await engine.store({ content: 'Low relevance', layer: 'longterm', relevance: 0.3 });
    await engine.store({ content: 'High relevance', layer: 'longterm', relevance: 0.9 });

    const results = await engine.query({ layers: ['longterm'] });
    expect(results[0].content).toBe('High relevance');
  });

  it('should delete memories', async () => {
    const mem = await engine.store({ content: 'Delete me', layer: 'session' });
    expect(await engine.get(mem.id)).toBeDefined();

    await engine.delete(mem.id);
    expect(await engine.get(mem.id)).toBeUndefined();
  });

  it('should report stats by layer', async () => {
    await engine.store({ content: 'A', layer: 'working' });
    await engine.store({ content: 'B', layer: 'session' });
    await engine.store({ content: 'C', layer: 'session' });

    const stats = engine.getStats();
    expect(stats.working).toBe(1);
    expect(stats.session).toBe(2);
    expect(stats.longterm).toBe(0);
  });
});
