/**
 * Event Bus Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../events/event-bus.js';
import type { NexusEvent } from '@nexus/types';
import { generateId, now } from '../utils.js';

function createEvent(overrides: Partial<NexusEvent> = {}): NexusEvent {
  return {
    id: generateId('evt'),
    eventType: 'test.created',
    category: 'system',
    severity: 'info',
    timestamp: now(),
    subjectId: 'subject-1',
    subjectType: 'test',
    actorId: 'actor-1',
    correlationId: 'cor-1',
    data: { key: 'value' },
    metadata: { schemaVersion: '1.0.0', source: 'test', environment: 'test' },
    ...overrides,
  };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(async () => {
    bus = new EventBus({ persistent: false });
    await bus.start();
  });

  afterEach(async () => {
    await bus.stop();
  });

  it('should publish and receive events via subscription', () => {
    const received: NexusEvent[] = [];
    bus.subscribe(['test.*'], (event) => { received.push(event); });

    bus.publish(createEvent({ eventType: 'test.created' }));
    bus.publish(createEvent({ eventType: 'test.updated' }));
    bus.publish(createEvent({ eventType: 'other.created' }));

    expect(received).toHaveLength(2);
    expect(received[0].eventType).toBe('test.created');
    expect(received[1].eventType).toBe('test.updated');
  });

  it('should support wildcard * matching all events', () => {
    const received: NexusEvent[] = [];
    bus.subscribe(['*'], (event) => { received.push(event); });

    bus.publish(createEvent({ eventType: 'a.b' }));
    bus.publish(createEvent({ eventType: 'c.d' }));

    expect(received).toHaveLength(2);
  });

  it('should support unsubscribe', () => {
    const received: NexusEvent[] = [];
    const id = bus.subscribe(['test.*'], (event) => { received.push(event); });

    bus.publish(createEvent());
    bus.unsubscribe(id);
    bus.publish(createEvent());

    expect(received).toHaveLength(1);
  });

  it('should get timeline for a subject', () => {
    bus.publish(createEvent({ subjectId: 'obj-1', eventType: 'test.a' }));
    bus.publish(createEvent({ subjectId: 'obj-1', eventType: 'test.b' }));
    bus.publish(createEvent({ subjectId: 'obj-2', eventType: 'test.c' }));

    const timeline = bus.getTimeline('obj-1');
    expect(timeline).toHaveLength(2);
  });

  it('should query events by type pattern', () => {
    bus.publish(createEvent({ eventType: 'intent.created' }));
    bus.publish(createEvent({ eventType: 'intent.completed' }));
    bus.publish(createEvent({ eventType: 'agent.started' }));

    const results = bus.query({ type: 'intent.*' });
    expect(results).toHaveLength(2);
  });

  it('should report event count', () => {
    bus.publish(createEvent());
    bus.publish(createEvent());
    bus.publish(createEvent());

    expect(bus.eventCount).toBe(3);
  });
});
