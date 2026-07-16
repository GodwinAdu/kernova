/**
 * WebSocket Server for Kernova Framework.
 *
 * Runs alongside the HTTP server on the same port (upgrade handler)
 * or a separate port. Provides:
 * - Real-time agent chat (send message → get streaming response)
 * - Event subscription (get notified of trigger firings, tool calls)
 * - Connection management (per-client threads)
 *
 * Usage in kernova.config.ts:
 *   gateway: {
 *     websocket: true,        // Enable WebSocket alongside HTTP
 *     websocketPort: 4556,    // Optional: separate port (default: same as HTTP via upgrade)
 *   }
 */

import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';

export interface WebSocketServerConfig {
  /** Enable WebSocket server (default: false) */
  enabled: boolean;
  /** Separate port for WebSocket (optional — default uses HTTP upgrade on same port) */
  port?: number;
  /** Path for WebSocket connections (default: '/ws') */
  path?: string;
  /** Maximum message size in bytes (default: 1MB) */
  maxMessageSize?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
}

export interface WSClient {
  id: string;
  socket: any;
  threadId: string;
  userId?: string;
  connectedAt: string;
  lastPing: number;
}

/**
 * Create and attach a WebSocket server to the existing HTTP server.
 * Uses the `ws` package (optional peer dependency).
 *
 * Returns a broadcast function for sending messages to all/specific clients.
 */
export async function createWebSocketServer(
  httpServer: Server,
  config: WebSocketServerConfig,
  handlers: {
    onMessage: (clientId: string, message: string, threadId: string) => Promise<string>;
    onConnect?: (clientId: string) => void;
    onDisconnect?: (clientId: string) => void;
  },
): Promise<{
  broadcast: (message: string, filter?: (client: WSClient) => boolean) => void;
  sendTo: (clientId: string, message: string) => void;
  getClients: () => WSClient[];
  close: () => void;
} | null> {
  // Dynamic import of ws package
  let WebSocketServer: any;
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(process.cwd() + '/package.json');
    const ws = require('ws');
    WebSocketServer = ws.WebSocketServer || ws.Server;
  } catch {
    try {
      const ws = await (Function('m', 'return import(m)')('ws'));
      WebSocketServer = ws.WebSocketServer || ws.default?.WebSocketServer || ws.Server || ws.default?.Server;
    } catch {
      console.log('  ⚠ WebSocket disabled (install "ws" package to enable: npm install ws)');
      return null;
    }
  }

  if (!WebSocketServer) {
    console.log('  ⚠ WebSocket: could not load ws package');
    return null;
  }

  const clients = new Map<string, WSClient>();
  const path = config.path || '/ws';

  // Create WebSocket server attached to HTTP server (upgrade handler)
  const wss = new WebSocketServer({
    server: config.port ? undefined : httpServer,
    port: config.port || undefined,
    path,
    maxPayload: config.maxMessageSize || 1048576, // 1MB
  });

  // Heartbeat to detect dead connections
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, client] of clients) {
      if (now - client.lastPing > (config.heartbeatInterval || 30000) * 2) {
        // Dead connection — terminate
        client.socket.terminate();
        clients.delete(id);
        handlers.onDisconnect?.(id);
      } else {
        // Send ping
        try { client.socket.ping(); } catch {}
      }
    }
  }, config.heartbeatInterval || 30000);

  wss.on('connection', (socket: any, req: IncomingMessage) => {
    const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const threadId = url.searchParams.get('threadId') || `ws_thread_${clientId}`;
    const userId = url.searchParams.get('userId') || undefined;

    const client: WSClient = {
      id: clientId,
      socket,
      threadId,
      userId,
      connectedAt: new Date().toISOString(),
      lastPing: Date.now(),
    };

    clients.set(clientId, client);
    handlers.onConnect?.(clientId);

    // Send welcome message
    socket.send(JSON.stringify({
      type: 'connected',
      clientId,
      threadId,
      timestamp: new Date().toISOString(),
    }));

    // Handle incoming messages
    socket.on('message', async (data: Buffer | string) => {
      client.lastPing = Date.now();

      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        let parsed: any;

        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { type: 'message', content: raw };
        }

        const messageType = parsed.type || 'message';
        const content = parsed.content || parsed.message || parsed.input || raw;

        if (messageType === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }

        if (messageType === 'message' || messageType === 'chat') {
          // Send to agent and stream response back
          socket.send(JSON.stringify({ type: 'thinking', timestamp: Date.now() }));

          const response = await handlers.onMessage(clientId, content, client.threadId);

          socket.send(JSON.stringify({
            type: 'response',
            content: response,
            threadId: client.threadId,
            timestamp: Date.now(),
          }));
        }
      } catch (err: any) {
        socket.send(JSON.stringify({
          type: 'error',
          message: err.message || 'Internal error',
          timestamp: Date.now(),
        }));
      }
    });

    // Handle pong (heartbeat response)
    socket.on('pong', () => {
      client.lastPing = Date.now();
    });

    // Handle disconnect
    socket.on('close', () => {
      clients.delete(clientId);
      handlers.onDisconnect?.(clientId);
    });

    socket.on('error', () => {
      clients.delete(clientId);
    });
  });

  console.log(`  ✓ WebSocket server: ${config.port ? `port ${config.port}` : `ws://${path}`}`);

  return {
    broadcast: (message: string, filter?: (client: WSClient) => boolean) => {
      for (const client of clients.values()) {
        if (filter && !filter(client)) continue;
        try {
          if (client.socket.readyState === 1) { // OPEN
            client.socket.send(message);
          }
        } catch {}
      }
    },
    sendTo: (clientId: string, message: string) => {
      const client = clients.get(clientId);
      if (client && client.socket.readyState === 1) {
        client.socket.send(message);
      }
    },
    getClients: () => Array.from(clients.values()),
    close: () => {
      clearInterval(heartbeatInterval);
      wss.close();
      clients.clear();
    },
  };
}
