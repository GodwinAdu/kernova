/**
 * DaemonRunner — Persistent execution mode for Kernova
 * 
 * A thin wrapper over KernovaKernel that adds:
 * - Signal handling (SIGINT, SIGTERM) for graceful shutdown
 * - Heartbeat emission at configurable intervals
 * - Graceful shutdown with configurable timeout
 * 
 * Usage:
 *   const daemon = new DaemonRunner(kernel, { shutdownTimeoutMs: 30000 });
 *   await daemon.start();
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KernovaKernel } from '../kernel.js';
import {
  loadAgentConfigWithExtends,
  discoverAgentConfigFiles,
  isAgentConfigFile,
} from '../config-manager/index.js';
import { defineAgent } from '../define-agent.js';
import type { AgentConfigFile } from '@kernova/types';
import { generateId, now } from '../utils.js';

/**
 * Configuration for the DaemonRunner.
 */
export interface DaemonConfig {
  /** Path to agent config file or directory */
  configPath?: string;

  /** Enable hot-reload of config files */
  watch?: boolean;

  /**
   * Serve the HTTP gateway (kernel.gateway) on this port. The gateway needs a token
   * (KernelConfig.gateway.auth.tokens or KERNOVA_API_KEY) unless anonymous access is enabled.
   */
  port?: number;

  /** Interface the gateway binds to when `port` is set (default: the gateway's, 127.0.0.1) */
  host?: string;

  /** Data directory override */
  dataDir?: string;

  /** Graceful shutdown timeout in milliseconds (default: 30000) */
  shutdownTimeoutMs?: number;

  /** Heartbeat interval in milliseconds (default: 60000) */
  heartbeatIntervalMs?: number;
}

/**
 * DaemonRunner manages the lifecycle of a KernovaKernel in persistent mode.
 * 
 * Responsibilities:
 * - Start the kernel and keep it running
 * - Emit periodic heartbeat events on the kernel's EventBus
 * - Handle OS signals (SIGINT, SIGTERM) for graceful shutdown
 * - Wait for active intents to complete before stopping (up to timeout)
 */
export class DaemonRunner {
  private readonly kernel: KernovaKernel;
  private readonly config: Required<Pick<DaemonConfig, 'shutdownTimeoutMs' | 'heartbeatIntervalMs'>> & DaemonConfig;
  private running = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopPromiseResolve: (() => void) | null = null;
  private signalHandlers: { signal: string; handler: () => void }[] = [];
  private loadedAgentConfigs: Map<string, AgentConfigFile> = new Map();
  private stopWatching: (() => void) | null = null;

  constructor(kernel: KernovaKernel, config: DaemonConfig = {}) {
    this.kernel = kernel;
    this.config = {
      ...config,
      shutdownTimeoutMs: config.shutdownTimeoutMs ?? 30000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 60000,
    };
  }

  /**
   * Start the daemon.
   * Starts the kernel (if it isn't running) and the gateway (if `port` is set),
   * registers signal handlers, and begins heartbeat emission.
   * Returns a promise that resolves when the daemon stops.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      if (!this.kernel.getStatus().running) await this.kernel.start();

      // Load agent config files if configPath is specified
      if (this.config.configPath) {
        await this.loadConfigs(this.config.configPath);
      }

      if (this.config.port !== undefined) {
        await this.kernel.gateway.start({
          port: this.config.port,
          ...(this.config.host && { host: this.config.host }),
        });
      }
    } catch (error) {
      this.running = false;
      await this.kernel.stop();
      throw error;
    }

    // Start hot-reload watching if --watch is set and configPath provided
    if (this.config.watch && this.config.configPath) {
      this.startWatching(this.config.configPath);
    }

    // Start heartbeat
    this.startHeartbeat();

    // Register signal handlers
    this.registerSignalHandlers();

    // Emit daemon started event
    this.emitEvent('daemon.started', {
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      ...(this.config.port !== undefined && { port: this.config.port }),
    });

    // Return a promise that resolves when the daemon stops
    return new Promise<void>((resolve) => {
      this.stopPromiseResolve = resolve;

      // If already stopped by the time we get here, resolve immediately
      if (!this.running) {
        resolve();
      }
    });
  }

  /**
   * Stop the daemon gracefully.
   * Waits up to `shutdownTimeoutMs` for active intents to complete,
   * then force-stops the kernel.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.emitEvent('daemon.stopping', {
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
    });

    // Stop heartbeat
    this.stopHeartbeat();

    // Stop file watching
    if (this.stopWatching) {
      this.stopWatching();
      this.stopWatching = null;
    }

    // Remove signal handlers
    this.removeSignalHandlers();

    // Graceful shutdown: wait for active intents up to timeout
    await this.gracefulShutdown();

    // Stop the kernel
    await this.kernel.stop();

    this.running = false;

    this.emitEvent('daemon.stopped', {});

    // Resolve the start() promise
    if (this.stopPromiseResolve) {
      this.stopPromiseResolve();
      this.stopPromiseResolve = null;
    }
  }

  /**
   * Check if the daemon is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Wait for active intents to complete, up to the configured timeout.
   * After the timeout, forces a stop regardless of active intents.
   */
  private async gracefulShutdown(): Promise<void> {
    const timeout = this.config.shutdownTimeoutMs;
    const startTime = Date.now();

    // Poll for active intents to drain
    while (Date.now() - startTime < timeout) {
      const status = this.kernel.getStatus();
      if (status.activeIntents === 0) {
        return; // All intents completed
      }

      // Wait a short interval before checking again
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // Timeout reached — force stop
    this.emitEvent('daemon.shutdown.timeout', {
      activeIntents: this.kernel.getStatus().activeIntents,
      timeoutMs: timeout,
    });
  }

  /**
   * Start emitting heartbeat events at the configured interval.
   */
  private startHeartbeat(): void {
    const beat = () => {
      if (this.running) {
        const status = this.kernel.getStatus();
        this.emitEvent('daemon.heartbeat', {
          uptime: process.uptime(),
          activeIntents: status.activeIntents,
          registeredAgents: status.registeredAgents,
          running: status.running,
        });
      }
    };
    // One right away, so `kernova status` sees a running daemon before the first interval
    beat();
    this.heartbeatTimer = setInterval(beat, this.config.heartbeatIntervalMs);

    // Allow the process to exit even if heartbeat timer is active
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Stop the heartbeat timer.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Register OS signal handlers for graceful shutdown.
   */
  private registerSignalHandlers(): void {
    const shutdownHandler = () => {
      this.stop().catch((err) => {
        console.error('[Kernova Daemon] Error during shutdown:', err);
        process.exit(1);
      });
    };

    const signals = ['SIGINT', 'SIGTERM'] as const;
    for (const signal of signals) {
      const handler = shutdownHandler;
      process.on(signal, handler);
      this.signalHandlers.push({ signal, handler });
    }
  }

  /**
   * Remove previously registered signal handlers.
   */
  private removeSignalHandlers(): void {
    for (const { signal, handler } of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers = [];
  }

  /**
   * Load agent configs from the given path and register them with the kernel.
   */
  private async loadConfigs(configPath: string): Promise<void> {
    const files = discoverAgentConfigFiles(configPath);

    for (const filePath of files) {
      try {
        const config = loadAgentConfigWithExtends(filePath);
        this.loadedAgentConfigs.set(filePath, config);
        this.registerAgentFromConfig(config, filePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emitEvent('daemon.config.error', {
          filePath,
          error: message,
        });
      }
    }

    this.emitEvent('daemon.configs.loaded', {
      count: this.loadedAgentConfigs.size,
      files: [...this.loadedAgentConfigs.keys()],
    });
  }

  /**
   * Register an agent from a parsed AgentConfigFile with the kernel.
   */
  private registerAgentFromConfig(config: AgentConfigFile, filePath: string): void {
    const agentId = `config-agent-${config.name}`;

    // Register the agent definition with the kernel's agent registry
    const defined = defineAgent({
      name: config.name,
      description: config.description || `Agent loaded from ${filePath}`,
      capabilities: [
        { id: config.name, name: config.name, description: config.description || config.instructions.slice(0, 100), confidence: 0.8 },
      ],
      tools: (config.tools || []).map((toolId) => ({ toolId, name: toolId, purpose: 'Configured via agent config file', required: false })),
      instructions: config.instructions,
      // Sent to the kernel's default provider
      ...(config.model && { model: { model: config.model } }),
    });

    // Override the generated ID with a stable, deterministic ID for hot-reload
    defined.definition.id = agentId;

    this.kernel.agentRegistry.register(defined.definition, defined.executor);

    // Register schedules if any
    if (config.schedules) {
      for (const schedule of config.schedules) {
        try {
          this.kernel.scheduler.register({
            name: `${config.name}:${schedule.name}`,
            cronExpression: schedule.cron,
            delayMs: schedule.delayMs,
            oneShot: schedule.delayMs !== undefined && !schedule.cron,
            target: {
              type: 'agent',
              id: agentId,
              goal: schedule.goal,
            },
          });
        } catch {
          // Silently ignore duplicate schedule registrations on reload
        }
      }
    }

    // Register triggers if any
    if (config.triggers) {
      for (const trigger of config.triggers) {
        try {
          this.kernel.triggers.register({
            name: `${config.name}:${trigger.name}`,
            eventPattern: trigger.event,
            conditionDescription: trigger.condition,
            action: {
              goal: trigger.goal,
            },
          });
        } catch {
          // Silently ignore duplicate trigger registrations on reload
        }
      }
    }

    this.emitEvent('daemon.agent.registered', {
      name: config.name,
      filePath,
      tools: config.tools || [],
      scheduleCount: config.schedules?.length || 0,
      triggerCount: config.triggers?.length || 0,
    });
  }

  /**
   * Start watching config files for hot-reload.
   * Watches individual files for changes and the parent directory for new files/deletions.
   * Uses per-file debouncing (100ms) to avoid rapid re-registrations.
   */
  private startWatching(configPath: string): void {
    const watchers: fs.FSWatcher[] = [];
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const DEBOUNCE_MS = 100;

    const debouncedReload = (filePath: string) => {
      const existing = debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      debounceTimers.set(filePath, setTimeout(() => {
        debounceTimers.delete(filePath);
        this.handleFileChange(filePath);
      }, DEBOUNCE_MS));
    };

    // Watch each known config file for changes
    const files = discoverAgentConfigFiles(configPath);
    for (const filePath of files) {
      try {
        const watcher = fs.watch(filePath, (eventType) => {
          if (eventType === 'rename') {
            // File may have been deleted
            debouncedReload(filePath);
          } else {
            debouncedReload(filePath);
          }
        });
        watchers.push(watcher);
      } catch {
        // File may not exist yet; skip
      }
    }

    // Watch the directory for new files and deletions
    const absoluteConfigPath = path.resolve(configPath);
    const watchDir = fs.existsSync(absoluteConfigPath) && fs.statSync(absoluteConfigPath).isDirectory()
      ? absoluteConfigPath
      : path.dirname(absoluteConfigPath);

    try {
      const dirWatcher = fs.watch(watchDir, (eventType, filename) => {
        if (filename && isAgentConfigFile(filename)) {
          const fullPath = path.join(watchDir, filename);
          debouncedReload(fullPath);
        }
      });
      watchers.push(dirWatcher);
    } catch {
      // Directory may not exist; skip
    }

    this.stopWatching = () => {
      // Clear all pending debounce timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      // Close all file watchers
      for (const watcher of watchers) {
        watcher.close();
      }
    };

    this.emitEvent('daemon.watch.started', {
      files,
      configPath,
    });
  }

  /**
   * Handle a file change event (create, modify, or delete).
   * - If file no longer exists: unregister the agent
   * - If file exists and is new: parse and register it
   * - If file exists and was already loaded: re-parse and re-register (keeps old on error)
   */
  private handleFileChange(filePath: string): void {
    const absolutePath = path.resolve(filePath);

    // Check if file still exists
    if (!fs.existsSync(absolutePath)) {
      // File was deleted — unregister the agent
      this.unregisterConfigAgent(absolutePath);
      return;
    }

    // File exists — attempt to parse and register
    try {
      const config = loadAgentConfigWithExtends(absolutePath);
      const oldConfig = this.loadedAgentConfigs.get(absolutePath);

      // If there was a previous config with a different name, unregister old agent first
      if (oldConfig && oldConfig.name !== config.name) {
        this.unregisterConfigAgent(absolutePath);
      }

      this.loadedAgentConfigs.set(absolutePath, config);
      this.registerAgentFromConfig(config, absolutePath);

      this.emitEvent('daemon.config.reloaded', {
        filePath: absolutePath,
        agentName: config.name,
      });
    } catch (err) {
      // Parse error — keep old agent definition active, log the error
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent('daemon.config.error', {
        filePath: absolutePath,
        error: message,
        keepingOld: this.loadedAgentConfigs.has(absolutePath),
      });
    }
  }

  /**
   * Unregister an agent that was loaded from a config file.
   * Removes from the kernel's agent registry and internal tracking.
   */
  private unregisterConfigAgent(filePath: string): void {
    const config = this.loadedAgentConfigs.get(filePath);
    if (!config) return;

    const agentId = `config-agent-${config.name}`;
    this.kernel.agentRegistry.unregister(agentId);
    this.loadedAgentConfigs.delete(filePath);

    this.emitEvent('daemon.agent.unregistered', {
      name: config.name,
      filePath,
      reason: 'file_deleted',
    });
  }

  /**
   * Reload a single config file and re-register the agent.
   * @deprecated Use handleFileChange instead (kept for backward compat)
   */
  private reloadConfig(filePath: string): void {
    this.handleFileChange(filePath);
  }

  /**
   * Get the currently loaded agent configurations.
   */
  getLoadedConfigs(): Map<string, AgentConfigFile> {
    return new Map(this.loadedAgentConfigs);
  }

  /**
   * Emit an event on the kernel's EventBus.
   */
  private emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.kernel.events.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId: 'daemon',
      subjectType: 'system',
      actorId: 'daemon',
      correlationId: generateId('cor'),
      data,
      metadata: {
        schemaVersion: '1.0.0',
        source: 'daemon',
        environment: this.kernel.getStatus().environment,
      },
    });
  }
}
