/**
 * kernova serve
 * 
 * Starts the kernova daemon in persistent mode.
 * Loads agent configs, starts scheduler, task queue, and triggers.
 */

import { resolve } from 'node:path';
import { info, error, success } from '../ui.js';

export async function handleServe(args: string[]): Promise<void> {
  const options = parseServeArgs(args);

  if (options.help) {
    printServeHelp();
    return;
  }

  info('Starting kernova daemon...');
  if (options.config) info(`Config: ${options.config}`);
  if (options.watch) info('Watch mode: enabled');
  if (options.port) info(`Port: ${options.port}`);
  if (options.dataDir) info(`Data dir: ${options.dataDir}`);

  try {
    const { KernovaKernel, DaemonRunner } = await import('@kernova/core');

    const dataDir = options.dataDir || resolve(process.cwd(), 'kernova-data');

    const kernel = new KernovaKernel({
      environment: 'development',
      dataDir,
    });

    const daemon = new DaemonRunner(kernel, {
      configPath: options.config,
      watch: options.watch,
      port: options.port,
      dataDir,
    });

    await daemon.start();
    success('Daemon is running. Press Ctrl+C to stop.');
  } catch (err) {
    error(`Failed to start daemon: ${(err as Error).message}`);
    process.exit(1);
  }
}

interface ServeOptions {
  config?: string;
  watch?: boolean;
  port?: number;
  dataDir?: string;
  help?: boolean;
}

function parseServeArgs(args: string[]): ServeOptions {
  const options: ServeOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--config':
      case '-c':
        options.config = args[++i];
        break;
      case '--watch':
      case '-w':
        options.watch = true;
        break;
      case '--port':
      case '-p':
        options.port = parseInt(args[++i], 10);
        break;
      case '--data-dir':
      case '-d':
        options.dataDir = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function printServeHelp(): void {
  console.log(`
  Usage: kernova serve [options]

  Start the kernova daemon in persistent mode.

  Options:
    -c, --config <path>    Path to agent config file or directory
    -w, --watch            Enable hot-reload of config files
    -p, --port <number>    Port for webhook/gateway listeners
    -d, --data-dir <path>  Data directory for persistence
    -h, --help             Show this help message

  Examples:
    kernova serve
    kernova serve --config ./agents/ --watch
    kernova serve --port 3000 --data-dir ./data
  `);
}
