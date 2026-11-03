/**
 * MCPManager — Manages MCP server lifecycle for the framework.
 *
 * Discovers MCP configs from:
 * 1. mcp/ directory (defineMCP files)
 * 2. Agent definitions (mcp: ['github', 'slack'])
 * 3. Skill requirements (skill.mcpServers)
 * 4. kernova.config.ts
 */

import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { MCPServerConfig, MCPRegistry } from './types.js';

// Well-known MCP servers that can be referenced by name
const KNOWN_SERVERS: Record<string, Omit<MCPServerConfig, 'name'>> = {
  github: { command: 'uvx', args: ['mcp-server-github'] },
  filesystem: { command: 'uvx', args: ['mcp-server-filesystem'] },
  slack: { command: 'uvx', args: ['mcp-server-slack'] },
  postgres: { command: 'uvx', args: ['mcp-server-postgres'] },
  sqlite: { command: 'uvx', args: ['mcp-server-sqlite'] },
  puppeteer: { command: 'uvx', args: ['mcp-server-puppeteer'] },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  memory: { command: 'uvx', args: ['mcp-server-memory'] },
  brave: { command: 'uvx', args: ['mcp-server-brave-search'] },
  google: { command: 'uvx', args: ['mcp-server-google-search'] },
};

/** Replace ${VAR} in .kernova/mcp.json env values with the process environment */
function expandEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    key,
    String(value).replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? ''),
  ]));
}

export class MCPManager implements MCPRegistry {
  servers: Map<string, MCPServerConfig> = new Map();

  /**
   * Add a server configuration.
   */
  add(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
  }

  /**
   * Remove a server.
   */
  remove(name: string): void {
    this.servers.delete(name);
  }

  /**
   * Get a server config by name.
   */
  get(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  /**
   * List all registered servers.
   */
  list(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Resolve a server name to a full config.
   * If it's a well-known server, returns the preset config.
   */
  resolve(name: string): MCPServerConfig | null {
    // Check if already registered
    const existing = this.servers.get(name);
    if (existing) return existing;

    // Check well-known servers
    const known = KNOWN_SERVERS[name];
    if (known) {
      const config: MCPServerConfig = { name, ...known };
      this.servers.set(name, config);
      return config;
    }

    return null;
  }

  /**
   * Discover MCP configs from the project's mcp/ directory.
   */
  async discoverFromDirectory(projectRoot: string): Promise<void> {
    const mcpDir = resolve(projectRoot, 'mcp');
    if (!existsSync(mcpDir)) return;

    const entries = readdirSync(mcpDir);
    for (const entry of entries) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
      if (entry.startsWith('_') || entry.startsWith('index.')) continue;

      const filePath = resolve(mcpDir, entry);
      try {
        const module = await import(pathToFileURL(filePath).href);
        const config = module.default || module;
        if (config && config.name && config.command) {
          this.add(config);
        }
      } catch (err) {
        console.error(`[MCP] Failed to load config from ${filePath}:`, (err as Error).message);
      }
    }
  }

  /**
   * Discover MCP configs from kernova.config.ts or .kernova/mcp.json.
   */
  async discoverFromConfig(projectRoot: string): Promise<void> {
    const mcpJsonPath = resolve(projectRoot, '.kernova', 'mcp.json');
    if (existsSync(mcpJsonPath)) {
      try {
        const content = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
        if (content.mcpServers) {
          for (const [name, config] of Object.entries(content.mcpServers)) {
            const serverConfig = config as any;
            this.add({
              name,
              command: serverConfig.command,
              args: serverConfig.args || [],
              env: expandEnv(serverConfig.env || {}),
              autoApprove: serverConfig.autoApprove || [],
              autoStart: !serverConfig.disabled,
            });
          }
        }
      } catch (err) {
        console.error('[MCP] Failed to load .kernova/mcp.json:', (err as Error).message);
      }
    }
  }

  /**
   * Resolve MCP requirements from agent/skill definitions.
   * Accepts an array of server names and ensures they're registered.
   */
  resolveRequirements(names: string[]): MCPServerConfig[] {
    const configs: MCPServerConfig[] = [];
    for (const name of names) {
      const config = this.resolve(name);
      if (config) {
        configs.push(config);
      } else {
        console.warn(`[MCP] Unknown MCP server: "${name}". Install it or add a config in mcp/ directory.`);
      }
    }
    return configs;
  }
}
