/**
 * Kernova Dev Server
 * 
 * Orchestrates the development experience:
 * - Starts the kernel
 * - Loads agents from src/agents/
 * - Watches for file changes
 * - Hot-reloads agents on change
 * - Reports status to console
 * 
 * This is what `kernova dev` actually runs.
 */

import { resolve } from 'node:path';
import { KernovaKernel } from '../kernel.js';
import type { KernelConfig } from '../kernel.js';
import { FileWatcher } from './file-watcher.js';
import { AgentLoader } from './agent-loader.js';
import { StudioServer } from '../studio/studio-server.js';

export interface DevServerConfig {
  /** Project root directory */
  rootDir: string;

  /** Kernel configuration */
  kernel?: Partial<KernelConfig>;

  /** Directories to watch for agents */
  agentDirs?: string[];

  /** Studio port (default: 4200) */
  studioPort?: number;

  /** Disable Studio */
  noStudio?: boolean;

  /** Callback for status messages */
  onStatus?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export class DevServer {
  private kernel: KernovaKernel;
  private watcher: FileWatcher;
  private loader: AgentLoader;
  private studio: StudioServer | null = null;
  private config: DevServerConfig;
  private running = false;

  constructor(config: DevServerConfig) {
    this.config = config;

    this.kernel = new KernovaKernel({
      environment: 'development',
      debug: true,
      dataDir: resolve(config.rootDir, 'kernova-data'),
      ...config.kernel,
    });

    const agentDirs = config.agentDirs || ['src/agents'];

    this.watcher = new FileWatcher({
      paths: agentDirs,
      rootDir: config.rootDir,
    });

    this.loader = new AgentLoader();

    // Wire up hot reload
    this.watcher.onChange(async (event) => {
      await this.handleFileChange(event.path, event.relativePath);
    });
  }

  /**
   * Start the dev server
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Start kernel
    await this.kernel.start();

    // Load existing agents
    const agentDirs = this.config.agentDirs || ['src/agents'];
    let totalLoaded = 0;

    for (const dir of agentDirs) {
      const fullDir = resolve(this.config.rootDir, dir);
      const results = await this.loader.loadDirectory(fullDir);

      for (const result of results) {
        if (result.success && result.definition && result.executor) {
          this.kernel.agentRegistry.register(result.definition, result.executor);
          totalLoaded++;
          this.status(`Agent '${result.name}' loaded (${result.durationMs}ms)`, 'success');
        } else if (!result.success) {
          this.status(`Agent '${result.name}' failed: ${result.error}`, 'error');
        }
      }
    }

    if (totalLoaded === 0) {
      this.status('No agents found in src/agents/. Create one with: kernova agent create <name>', 'info');
    }

    // Start file watcher
    const watchedPaths = this.watcher.start();
    if (watchedPaths.length > 0) {
      this.status(`Watching: ${watchedPaths.join(', ')}`, 'info');
    }

    // Start Studio
    if (!this.config.noStudio) {
      this.studio = new StudioServer(this.kernel, { port: this.config.studioPort || 4200 });
      const studioUrl = await this.studio.start();
      this.status(`Studio: ${studioUrl}`, 'info');
    }

    this.running = true;
  }

  /**
   * Stop the dev server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.watcher.stop();
    if (this.studio) {
      await this.studio.stop();
    }
    await this.kernel.stop();
    this.running = false;
  }

  /**
   * Handle a file change — reload the agent
   */
  private async handleFileChange(filePath: string, relativePath: string): Promise<void> {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

    // Attempt reload
    const result = await this.loader.loadAgent(filePath);

    if (result.success && result.definition && result.executor) {
      // Re-register the agent (replaces existing)
      this.kernel.agentRegistry.register(result.definition, result.executor);
      this.status(`[${timestamp}] Agent '${result.name}' reloaded (${result.durationMs}ms)`, 'success');
    } else {
      this.status(`[${timestamp}] Agent '${result.name}' failed: ${result.error}`, 'error');
    }
  }

  /**
   * Get the kernel instance (for submitting intents, etc.)
   */
  getKernel(): KernovaKernel {
    return this.kernel;
  }

  /**
   * Report status
   */
  private status(message: string, type: 'success' | 'error' | 'info'): void {
    if (this.config.onStatus) {
      this.config.onStatus(message, type);
    }
  }
}
