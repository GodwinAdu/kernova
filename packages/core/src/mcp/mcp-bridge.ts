/**
 * Kernova MCP Bridge
 *
 * Model Context Protocol client that connects to external MCP servers
 * and imports their tools into the Kernova runtime.
 *
 * Supports:
 * - stdio transport (spawn a process)
 * - SSE transport (connect to HTTP endpoint)
 * - Tool discovery and registration
 * - Tool execution proxying
 * - Graceful lifecycle management
 *
 * Inspired by OpenClaw's MCP integration.
 */

import type {
  NexusId,
  NexusEvent,
  MCPServerConfig,
  MCPTool,
  MCPToolCallResult,
  MCPTransport,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';
import { spawn, type ChildProcess } from 'node:child_process';

export interface MCPBridgeConfig {
  /** Timeout for tool calls in ms */
  toolCallTimeout?: number;       // default: 30_000
}

interface MCPConnection {
  config: MCPServerConfig;
  process?: ChildProcess;
  tools: MCPTool[];
  connected: boolean;
  /** Pending request callbacks */
  pending: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>;
  /** Buffer for incoming data */
  buffer: string;
}

export class MCPBridge {
  private readonly eventBus: EventBus;
  private readonly config: MCPBridgeConfig;
  private connections: Map<NexusId, MCPConnection> = new Map();

  constructor(eventBus: EventBus, config?: MCPBridgeConfig) {
    this.eventBus = eventBus;
    this.config = { toolCallTimeout: 30_000, ...config };
  }

  /**
   * Register an MCP server configuration.
   * Does not connect immediately — call connect() separately.
   */
  register(serverConfig: Omit<MCPServerConfig, 'id'>): MCPServerConfig {
    const config: MCPServerConfig = {
      id: generateId('mcp'),
      ...serverConfig,
    };

    this.connections.set(config.id, {
      config,
      tools: [],
      connected: false,
      pending: new Map(),
      buffer: '',
    });

    return config;
  }

  /**
   * Connect to an MCP server and discover its tools.
   */
  async connect(serverId: NexusId): Promise<MCPTool[]> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new ValidationError('serverId', 'MCP server not registered');
    if (!conn.config.enabled) {
      throw new ValidationError('enabled', 'MCP server is disabled');
    }

    const transport = conn.config.transport;

    if (transport.type === 'stdio') {
      await this.connectStdio(conn);
    } else if (transport.type === 'sse') {
      // SSE transport — for now, just mark as connected
      // Full SSE implementation would use EventSource
      conn.connected = true;
    }

    // Discover tools
    const tools = await this.listServerTools(conn);
    conn.tools = tools;

    this.emitEvent('mcp.connected', serverId, {
      name: conn.config.name,
      toolCount: tools.length,
      transport: transport.type,
    });

    return tools;
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(serverId: NexusId): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    if (conn.process) {
      conn.process.kill();
      conn.process = undefined;
    }

    conn.connected = false;
    conn.tools = [];
    conn.pending.clear();

    this.emitEvent('mcp.disconnected', serverId, { name: conn.config.name });
  }

  /**
   * Call a tool on an MCP server.
   */
  async callTool(
    serverId: NexusId,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<MCPToolCallResult> {
    const conn = this.connections.get(serverId);
    if (!conn || !conn.connected) {
      return { content: [{ type: 'text', text: 'MCP server not connected' }], isError: true };
    }

    const requestId = generateId('req');
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    try {
      const result = await this.sendRequest(conn, request);
      return result as MCPToolCallResult;
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Tool error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  /**
   * Get all tools from all connected servers.
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      if (!conn.connected) continue;
      for (const tool of conn.tools) {
        const prefix = conn.config.toolPrefix ?? '';
        tools.push({
          ...tool,
          name: prefix ? `${prefix}${tool.name}` : tool.name,
        });
      }
    }
    return tools;
  }

  /**
   * Get tools from a specific server.
   */
  getServerTools(serverId: NexusId): MCPTool[] {
    const conn = this.connections.get(serverId);
    return conn?.tools ?? [];
  }

  /**
   * List all registered servers and their status.
   */
  listServers(): Array<{ id: NexusId; name: string; connected: boolean; toolCount: number }> {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.config.id,
      name: conn.config.name,
      connected: conn.connected,
      toolCount: conn.tools.length,
    }));
  }

  /**
   * Disconnect all servers and clean up.
   */
  async dispose(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnect(id);
    }
    this.connections.clear();
  }

  // ─── Private: stdio transport ──────────────────────────────

  private async connectStdio(conn: MCPConnection): Promise<void> {
    const transport = conn.config.transport as Extract<MCPTransport, { type: 'stdio' }>;

    const child = spawn(transport.command, transport.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...transport.env },
    });

    conn.process = child;
    conn.buffer = '';

    // Handle stdout (JSON-RPC responses)
    child.stdout?.on('data', (data: Buffer) => {
      conn.buffer += data.toString();
      this.processBuffer(conn);
    });

    child.on('exit', () => {
      conn.connected = false;
    });

    child.on('error', (error) => {
      conn.connected = false;
      this.emitEvent('mcp.error', conn.config.id, {
        name: conn.config.name,
        error: error.message,
      });
    });

    conn.connected = true;

    // Send initialize request
    await this.sendRequest(conn, {
      jsonrpc: '2.0',
      id: generateId('init'),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kernova', version: '0.1.0' },
      },
    });
  }

  private async listServerTools(conn: MCPConnection): Promise<MCPTool[]> {
    if (!conn.connected) return [];

    try {
      const result = await this.sendRequest(conn, {
        jsonrpc: '2.0',
        id: generateId('list'),
        method: 'tools/list',
        params: {},
      });

      const tools = (result as { tools?: unknown[] })?.tools ?? [];
      return tools.map((t: unknown) => {
        const tool = t as Record<string, unknown>;
        return {
          name: String(tool.name ?? ''),
          description: String(tool.description ?? ''),
          inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
          serverId: conn.config.id,
        };
      });
    } catch {
      return [];
    }
  }

  private sendRequest(conn: MCPConnection, request: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(request.id);
      const timeout = this.config.toolCallTimeout ?? 30_000;

      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error('MCP request timeout'));
      }, timeout);

      conn.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });

      const message = JSON.stringify(request) + '\n';
      conn.process?.stdin?.write(message);
    });
  }

  private processBuffer(conn: MCPConnection): void {
    const lines = conn.buffer.split('\n');
    conn.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && conn.pending.has(String(msg.id))) {
          const handler = conn.pending.get(String(msg.id))!;
          conn.pending.delete(String(msg.id));
          if (msg.error) {
            handler.reject(new Error(msg.error.message ?? 'MCP error'));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {
        // Invalid JSON line — skip
      }
    }
  }

  private emitEvent(eventType: string, subjectId: NexusId, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('error') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'mcp',
      actorId: 'mcp-bridge',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'mcp-bridge', environment: 'runtime' },
    });
  }
}
