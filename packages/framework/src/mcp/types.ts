/**
 * MCP types for the framework.
 */

export interface MCPServerConfig {
  /** Server name (used as identifier) */
  name: string;
  /** Command to start the server */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Auto-approve these tools */
  autoApprove?: string[];
  /** Whether to auto-start on agent boot */
  autoStart?: boolean;
}

export interface MCPRegistry {
  /** Registered MCP server configs */
  servers: Map<string, MCPServerConfig>;
  /** Add a server config */
  add: (config: MCPServerConfig) => void;
  /** Remove a server */
  remove: (name: string) => void;
  /** Get config */
  get: (name: string) => MCPServerConfig | undefined;
  /** List all */
  list: () => MCPServerConfig[];
}

export interface MCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}
