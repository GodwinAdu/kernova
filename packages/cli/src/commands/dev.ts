/**
 * kernova dev
 * 
 * Starts the kernova development runtime with hot-reload.
 * Watches agent files and reloads them on change without restarting.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DevServer } from '@kernova/core';
import { printBanner, success, info, warn, error } from '../ui.js';

export async function handleDev(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const configPath = join(projectRoot, 'kernova.config.json');

  printBanner();

  // Check for config file
  if (!existsSync(configPath)) {
    error('No kernova.config.json found in current directory.');
    info('Run "kernova init" to create a new project.');
    process.exit(1);
  }

  // Load config
  const configRaw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configRaw);

  info(`Starting kernova runtime for "${config.name}"...`);
  console.log('');

  // Create dev server
  const server = new DevServer({
    rootDir: projectRoot,
    kernel: {
      environment: 'development',
      debug: false,
    },
    agentDirs: ['src/agents'],
    onStatus: (message, type) => {
      switch (type) {
        case 'success': success(message); break;
        case 'error': error(message); break;
        case 'info': info(message); break;
      }
    },
  });

  // Start
  await server.start();

  const kernel = server.getKernel();
  const status = kernel.getStatus();

  console.log('');
  success('kernova runtime is running');
  console.log('');
  console.log(`    Instance:   ${status.instanceId}`);
  console.log(`    Env:        ${status.environment}`);
  console.log(`    Agents:     ${status.registeredAgents}`);
  console.log(`    Providers:  ${status.availableProviders.length > 0 ? status.availableProviders.join(', ') : 'none (set OPENAI_API_KEY or ANTHROPIC_API_KEY)'}`);
  console.log(`    Events:     ${kernel.events.isPersistent ? 'persistent (SQLite)' : 'in-memory'}`);
  console.log(`    Memory:     ${kernel.memoryEngine.isPersistent ? 'persistent (SQLite + FTS5)' : 'in-memory'}`);
  console.log('');
  info('Press Ctrl+C to stop.');
  console.log('');

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('');
    info('Shutting down...');
    await server.stop();
    success('Runtime stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive
  await new Promise(() => {});
}
