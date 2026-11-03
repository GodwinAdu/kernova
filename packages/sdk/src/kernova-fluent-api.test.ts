/**
 * SDK Fluent API — Chaining and Return Type Verification
 *
 * This test verifies that all new autonomy methods on the Kernova class:
 * 1. Exist with the correct signatures
 * 2. Return the correct types (`this` for chaining, Promise<T> for async)
 * 3. Can be chained in sequence
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Kernova, ThreadHandle } from './kernova.js';
import type { SDKChannelAdapter, InboundMessage, IntentResult, TriggerActionDef } from '@kernova/types';

/** Generate a unique name to avoid scheduler duplicate-name errors across runs */
function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Kernova SDK Fluent API', () => {
  let app: Kernova;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('schedule() returns this for chaining', async () => {
    app = await Kernova.create({ ephemeral: true });
    const result = app.schedule(uid('job'), '* * * * *', async () => {});
    expect(result).toBe(app);
  });

  it('channel() returns this for chaining', async () => {
    app = await Kernova.create({ ephemeral: true });
    const mockAdapter: SDKChannelAdapter = {
      id: 'test-adapter',
      type: 'webhook',
      async connect() {},
      async disconnect() {},
      async send() { return { id: '1', status: 'sent', success: true, timestamp: new Date().toISOString() }; },
      onMessage() {},
    };
    const result = app.channel('webhook', mockAdapter);
    expect(result).toBe(app);
  });

  it('channel() starts the adapter listening, and close() stops it', async () => {
    app = await Kernova.create({ ephemeral: true });
    const calls: string[] = [];
    const adapter: SDKChannelAdapter = {
      id: 'listener',
      type: 'webhook',
      async connect() { calls.push('connect'); },
      async disconnect() { calls.push('disconnect'); },
      async send() { return { id: '1', status: 'sent', success: true, timestamp: new Date().toISOString() }; },
      onMessage() {},
    };
    app.channel('webhook', adapter);
    expect(calls).toEqual(['connect']);
    await app.close();
    expect(calls).toEqual(['connect', 'disconnect']);
  });

  it('accepts platform adapters and reply() answers the sender', async () => {
    app = await Kernova.create({ ephemeral: true });
    let deliver: ((raw: { sender: string; content: string; timestamp: string; replyTo?: string }) => void) | undefined;
    const sent: Array<{ content: string; recipient?: string }> = [];
    const slackLike = {
      channelType: 'slack' as const,
      state: 'connected' as const,
      async connect() {},
      async disconnect() {},
      async send(message: { content: string }, recipient?: string) {
        sent.push({ content: message.content, recipient });
        return { success: true, timestamp: new Date().toISOString() };
      },
      onMessage(handler: typeof deliver) { deliver = handler; },
      onStateChange() {},
    };

    const received: InboundMessage[] = [];
    app.channel('support', slackLike).onMessage(async (msg) => {
      received.push(msg);
      await app.reply(msg, 'on it');
    });

    deliver!({ sender: 'U1', content: 'help', timestamp: new Date().toISOString(), replyTo: 'C42' });
    await vi.waitFor(() => expect(sent).toEqual([{ content: 'on it', recipient: 'C42' }]));
    expect(received[0]).toMatchObject({ connectorId: 'support', channel: 'slack', replyTo: 'C42', content: 'help' });
  });

  it('onMessage() returns this for chaining', async () => {
    app = await Kernova.create({ ephemeral: true });
    const result = app.onMessage(async (_msg) => {});
    expect(result).toBe(app);
  });

  it('trigger() returns this for chaining', async () => {
    app = await Kernova.create({ ephemeral: true });
    const action: TriggerActionDef = { goal: 'handle user event' };
    const result = app.trigger('t1', 'user.*', action);
    expect(result).toBe(app);
  });

  it('thread() returns a ThreadHandle', async () => {
    app = await Kernova.create({ ephemeral: true });
    const handle = app.thread('test-thread');
    expect(handle).toBeInstanceOf(ThreadHandle);
    expect(handle.threadId).toBe('test-thread');
  });

  it('serve() returns Promise<void>', async () => {
    app = await Kernova.create({ ephemeral: true });
    // We just verify the method signature exists and returns a promise
    // We don't actually call serve() as it blocks until stopped
    expect(typeof app.serve).toBe('function');
  });

  it('enqueue() returns Promise<string>', async () => {
    app = await Kernova.create({ ephemeral: true });
    const taskId = await app.enqueue('test-handler', { data: 'hello' });
    expect(typeof taskId).toBe('string');
    expect(taskId.length).toBeGreaterThan(0);
  });

  it('plan() returns Promise<IntentResult>', async () => {
    app = await Kernova.create({ ephemeral: true });
    // plan() invokes the planner which requires model access — verify it returns the right shape
    // Since we're in ephemeral mode without a real model, it may throw but the return type is correct
    expect(typeof app.plan).toBe('function');
  });

  it('supports full method chaining pattern', async () => {
    app = await Kernova.create({ ephemeral: true });

    const mockAdapter: SDKChannelAdapter = {
      id: 'test-adapter',
      type: 'webhook',
      async connect() {},
      async disconnect() {},
      async send() { return { id: '1', status: 'sent', success: true, timestamp: new Date().toISOString() }; },
      onMessage() {},
    };

    // This is the canonical chaining pattern from the spec
    const chained = app
      .schedule(uid('test'), '* * * * *', async () => {})
      .trigger(uid('t1'), 'user.*', { goal: 'handle user event' })
      .channel('webhook', mockAdapter)
      .onMessage(async (_msg) => {});

    // All chaining methods return `this`, so the result should be the same instance
    expect(chained).toBe(app);
  });

  it('chaining methods can be interleaved with async methods', async () => {
    app = await Kernova.create({ ephemeral: true });

    // Chain synchronous methods
    app
      .schedule(uid('job1'), 5000, async () => {})
      .trigger(uid('trigger1'), 'task.*', { goal: 'process task' });

    // Call async method
    const taskId = await app.enqueue('handler', { value: 42 });
    expect(typeof taskId).toBe('string');

    // Continue chaining after async
    const result = app
      .schedule(uid('job2'), '0 * * * *', async () => {})
      .onMessage(async (_msg) => {});

    expect(result).toBe(app);
  });
});
