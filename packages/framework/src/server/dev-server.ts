/**
 * DevServer — Unified development server.
 *
 * Runs both:
 *   1. The Next.js frontend (app/ directory) on port 3000
 *   2. The Kernova agent backend on port 4555 (wired to KernovaKernel)
 *
 * Provides hot-reload for agent files.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { loadConfig } from './load-config.js';
import { createServer } from './create-server.js';
import type { KernovaKernel } from '@kernova/core';
import type { Server } from 'node:http';

export interface DevServerOptions {
  projectRoot?: string;
  appPort?: number;
  agentPort?: number;
  /** Only start the agent backend (no frontend) */
  agentsOnly?: boolean;
  /** Only start the frontend (no agent backend) */
  appOnly?: boolean;
}

export class DevServer {
  private projectRoot: string;
  private appPort: number;
  private agentPort: number;
  private frontendProcess: ChildProcess | null = null;
  private agentServer: Server | null = null;
  private kernel: KernovaKernel | null = null;
  private fileWatcher: FSWatcher | null = null;
  private options: DevServerOptions;

  constructor(options: DevServerOptions = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.appPort = options.appPort || 3000;
    this.agentPort = options.agentPort || parseInt(process.env.KERNOVA_PORT || '4555');
    this.options = options;
  }

  async start(): Promise<void> {
    const config = await loadConfig(this.projectRoot);

    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║       🚀 Kernova Dev Server              ║');
    console.log(`  ║  Project: ${padEnd(config.name, 30)}║`);
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');

    // Start agent backend (wired to KernovaKernel)
    if (!this.options.appOnly) {
      await this.startAgentBackend();
    }

    // Start frontend
    if (!this.options.agentsOnly) {
      await this.startFrontend(config);
    }

    // Watch for agent file changes (hot reload)
    if (!this.options.appOnly) {
      this.watchAgents();
    }
  }

  private async startAgentBackend(): Promise<void> {
    const result = await createServer({
      projectRoot: this.projectRoot,
      port: this.agentPort,
    });
    this.agentServer = result.server;
    this.kernel = result.kernel;
  }

  private async startFrontend(config: { app?: { framework?: string; port?: number } }): Promise<void> {
    const appDir = resolve(this.projectRoot, 'app');
    const framework = config.app?.framework || 'next';
    const port = this.appPort;

    if (!existsSync(appDir)) {
      console.log('  ⚠️  No app/ directory found — skipping frontend');
      return;
    }

    let command: string;
    let args: string[];

    switch (framework) {
      case 'next':
        command = 'npx';
        args = ['next', 'dev', '--port', String(port)];
        break;
      case 'react':
        command = 'npx';
        args = ['vite', '--port', String(port)];
        break;
      default:
        console.log(`  ⚠️  Unknown framework "${framework}" — skipping frontend`);
        return;
    }

    console.log(`  🌐 Starting frontend (${framework}) on port ${port}...`);

    this.frontendProcess = spawn(command, args, {
      cwd: this.projectRoot,
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        KERNOVA_URL: `http://localhost:${this.agentPort}`,
        NEXT_PUBLIC_KERNOVA_URL: `http://localhost:${this.agentPort}`,
      },
    });

    this.frontendProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) console.log(`  [app] ${output}`);
    });

    this.frontendProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output && !output.includes('ExperimentalWarning')) {
        console.error(`  [app] ${output}`);
      }
    });
  }

  private watchAgents(): void {
    const agentsDir = resolve(this.projectRoot, 'agents');
    if (!existsSync(agentsDir)) return;

    console.log('  👁️  Watching agents/ for changes...\n');

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    this.fileWatcher = watch(agentsDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (!filename.endsWith('.ts') && !filename.endsWith('.js')) return;

      // Debounce to avoid multiple rapid reloads
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        console.log(`  ♻️  Agent changed: ${filename} — reloading...`);
        await this.restartAgentBackend();
      }, 500);
    });
  }

  private async restartAgentBackend(): Promise<void> {
    // Stop existing kernel and server
    if (this.kernel) {
      await this.kernel.stop();
    }
    if (this.agentServer) {
      this.agentServer.close();
    }

    // Restart
    await this.startAgentBackend();
    console.log('  ✓  Agent backend reloaded\n');
  }

  async stop(): Promise<void> {
    if (this.frontendProcess) {
      this.frontendProcess.kill();
      this.frontendProcess = null;
    }
    if (this.kernel) {
      await this.kernel.stop();
      this.kernel = null;
    }
    if (this.agentServer) {
      this.agentServer.close();
      this.agentServer = null;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  getKernel(): KernovaKernel | null {
    return this.kernel;
  }
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}
