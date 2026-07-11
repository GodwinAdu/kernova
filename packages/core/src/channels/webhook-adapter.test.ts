/**
 * WebhookChannelAdapter Unit Tests
 *
 * Task 5.5: Tests for WebhookChannelAdapter
 * - send POST, verify message event emitted
 * - connect/disconnect lifecycle
 * - invalid request handling
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebhookChannelAdapter } from './adapters/webhook-adapter.js';
import type { InboundMessage } from '@kernova/types';

describe('WebhookChannelAdapter', () => {
  let adapter: WebhookChannelAdapter;
  let portCounter = 19876;

  function getPort(): number {
    return portCounter++;
  }

  afterEach(async () => {
    if (adapter) {
      await adapter.disconnect();
    }
  });

  describe('connect/disconnect lifecycle', () => {
    it('should start an HTTP server on connect', async () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('should stop the HTTP server on disconnect', async () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should not fail when disconnecting without connecting', async () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should not fail when connecting twice', async () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      await adapter.connect();
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('inbound message handling', () => {
    it('should emit message event when receiving a valid POST', async () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      await adapter.connect();

      const received: InboundMessage[] = [];
      adapter.onMessage(async (msg) => {
        received.push(msg);
      });

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: 'test-user',
          content: 'Hello from webhook',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { received: boolean; messageId: string };
      expect(body.received).toBe(true);
      expect(body.messageId).toBeDefined();

      // Wait a tick for async handler dispatch
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
      expect(received[0].sender).toBe('test-user');
      expect(received[0].content).toBe('Hello from webhook');
      expect(received[0].connectorId).toBe(adapter.id);
    });

    it('should handle multiple message handlers', async () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      await adapter.connect();

      let handler1Called = false;
      let handler2Called = false;

      adapter.onMessage(async () => { handler1Called = true; });
      adapter.onMessage(async () => { handler2Called = true; });

      await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'user', content: 'test' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
    });

    it('should default sender to "unknown" when not provided', async () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      await adapter.connect();

      const received: InboundMessage[] = [];
      adapter.onMessage(async (msg) => { received.push(msg); });

      await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'no sender' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received[0].sender).toBe('unknown');
    });
  });

  describe('error handling', () => {
    it('should return 404 for non-POST requests', async () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      await adapter.connect();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'GET',
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 for wrong path', async () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      await adapter.connect();

      const response = await fetch(`http://localhost:${port}/other`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'wrong path' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid JSON body', async () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      await adapter.connect();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json {{{',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('send method', () => {
    it('should return a successful delivery receipt', async () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      const receipt = await adapter.send({ content: 'hello' });
      expect(receipt.success).toBe(true);
      expect(receipt.timestamp).toBeDefined();
      expect(receipt.platformMessageId).toBeDefined();
    });
  });

  describe('adapter properties', () => {
    it('should have type "webhook"', () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      expect(adapter.type).toBe('webhook');
    });

    it('should have an id', () => {
      adapter = new WebhookChannelAdapter({ port: getPort(), path: '/webhook' });
      expect(adapter.id).toBeDefined();
      expect(adapter.id.length).toBeGreaterThan(0);
    });

    it('should use custom id when provided', () => {
      adapter = new WebhookChannelAdapter({ id: 'my-webhook', port: getPort() });
      expect(adapter.id).toBe('my-webhook');
    });

    it('should report configured port and path', () => {
      const port = getPort();
      adapter = new WebhookChannelAdapter({ port, path: '/webhook' });
      expect(adapter.getPort()).toBe(port);
      expect(adapter.getPath()).toBe('/webhook');
    });
  });
});
