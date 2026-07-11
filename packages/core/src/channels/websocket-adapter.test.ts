/**
 * WebSocketChannelAdapter Unit Tests
 *
 * Task 5.6: Tests for WebSocketChannelAdapter
 * - connect, send, verify receipt
 * - ping/pong keepalive
 * - client lifecycle management
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketChannelAdapter } from './adapters/websocket-adapter.js';
import WebSocket from 'ws';
import type { InboundMessage } from '@kernova/types';

describe('WebSocketChannelAdapter', () => {
  let adapter: WebSocketChannelAdapter;
  let portCounter = 19900;

  function getPort(): number {
    return portCounter++;
  }

  afterEach(async () => {
    if (adapter) {
      await adapter.disconnect();
    }
  });

  function connectClient(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  describe('connect/disconnect lifecycle', () => {
    it('should start a WebSocket server on connect', async () => {
      adapter = new WebSocketChannelAdapter({ port: getPort(), path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('should stop the WebSocket server on disconnect', async () => {
      adapter = new WebSocketChannelAdapter({ port: getPort(), path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should not fail when disconnecting without connecting', async () => {
      adapter = new WebSocketChannelAdapter({ port: getPort(), path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should not fail when connecting twice', async () => {
      adapter = new WebSocketChannelAdapter({ port: getPort(), path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('client connections', () => {
    it('should accept WebSocket connections', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const ws = await connectClient(port);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(adapter.getClientCount()).toBe(1);
      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(adapter.getClientCount()).toBe(0);
    });

    it('should handle multiple clients', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const ws1 = await connectClient(port);
      const ws2 = await connectClient(port);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(adapter.getClientCount()).toBe(2);

      ws1.close();
      ws2.close();
    });
  });

  describe('inbound message handling', () => {
    it('should emit message event when client sends data', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const received: InboundMessage[] = [];
      adapter.onMessage(async (msg) => {
        received.push(msg);
      });

      const ws = await connectClient(port);
      ws.send(JSON.stringify({
        sender: 'ws-user',
        content: 'Hello via WebSocket',
      }));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received).toHaveLength(1);
      expect(received[0].sender).toBe('ws-user');
      expect(received[0].content).toBe('Hello via WebSocket');
      expect(received[0].connectorId).toBe(adapter.id);

      ws.close();
    });

    it('should call multiple message handlers', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      let handler1Called = false;
      let handler2Called = false;

      adapter.onMessage(async () => { handler1Called = true; });
      adapter.onMessage(async () => { handler2Called = true; });

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ sender: 'user', content: 'multi' }));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);

      ws.close();
    });

    it('should handle invalid JSON messages gracefully', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const received: InboundMessage[] = [];
      adapter.onMessage(async (msg) => { received.push(msg); });

      const ws = await connectClient(port);
      ws.send('not json {{{');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received).toHaveLength(0);

      ws.close();
    });
  });

  describe('outbound message sending', () => {
    it('should send message to connected clients', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const ws = await connectClient(port);
      const messages: string[] = [];

      ws.on('message', (data) => {
        messages.push(data.toString());
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const receipt = await adapter.send({ content: 'Hello clients!' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receipt.success).toBe(true);
      expect(receipt.platformMessageId).toBeDefined();
      expect(messages).toHaveLength(1);

      const parsed = JSON.parse(messages[0]);
      expect(parsed.content).toBe('Hello clients!');
      expect(parsed.type).toBe('message');

      ws.close();
    });

    it('should return failure when no clients connected', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const receipt = await adapter.send({ content: 'No one here' });
      expect(receipt.success).toBe(false);
      expect(receipt.error).toBe('No connected clients');
    });

    it('should broadcast to all connected clients', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws', keepaliveIntervalMs: 30_000 });
      await adapter.connect();

      const ws1 = await connectClient(port);
      const ws2 = await connectClient(port);
      const messages1: string[] = [];
      const messages2: string[] = [];

      ws1.on('message', (data) => messages1.push(data.toString()));
      ws2.on('message', (data) => messages2.push(data.toString()));

      await new Promise((resolve) => setTimeout(resolve, 50));

      await adapter.send({ content: 'Broadcast!' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages1).toHaveLength(1);
      expect(messages2).toHaveLength(1);

      ws1.close();
      ws2.close();
    });
  });

  describe('ping/pong keepalive', () => {
    it('should send ping to clients at the configured interval', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({
        port,
        path: '/ws',
        keepaliveIntervalMs: 100, // 100ms for test speed
      });

      await adapter.connect();

      const ws = await connectClient(port);

      let pingReceived = false;
      ws.on('ping', () => {
        pingReceived = true;
      });

      // Wait for at least one ping interval
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(pingReceived).toBe(true);

      ws.close();
    });

    it('should track client count after disconnect', async () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({
        port,
        path: '/ws',
        keepaliveIntervalMs: 100,
      });

      await adapter.connect();

      const ws = await connectClient(port);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(adapter.getClientCount()).toBe(1);

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(adapter.getClientCount()).toBe(0);
    });
  });

  describe('adapter properties', () => {
    it('should have type "websocket"', () => {
      adapter = new WebSocketChannelAdapter({ port: getPort(), path: '/ws' });
      expect(adapter.type).toBe('websocket');
    });

    it('should have an id', () => {
      adapter = new WebSocketChannelAdapter({ port: getPort(), path: '/ws' });
      expect(adapter.id).toBeDefined();
      expect(adapter.id.length).toBeGreaterThan(0);
    });

    it('should use custom id when provided', () => {
      adapter = new WebSocketChannelAdapter({ id: 'my-ws', port: getPort() });
      expect(adapter.id).toBe('my-ws');
    });

    it('should report configured port', () => {
      const port = getPort();
      adapter = new WebSocketChannelAdapter({ port, path: '/ws' });
      expect(adapter.getPort()).toBe(port);
    });
  });
});
