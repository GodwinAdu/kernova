/**
 * kernova serve
 *
 * Starts the kernova daemon in persistent mode.
 * Loads agent configs, starts the scheduler, task queue, and triggers, and
 * (with --port) serves the HTTP gateway.
 */

import { info, error, success, defaultDataDir } from '../ui.js';

export async function handleServe(args: string[]): Promise<void> {
  const options = parseServeArgs(args);

  if (options.help) {
    printServeHelp();
    return;
  }

  info('Starting kernova daemon...');
  if (options.config) info(`Config: ${options.config}`);
  if (options.watch) info('Watch mode: enabled');
  if (options.dataDir) info(`Data dir: ${options.dataDir}`);

  try {
    const { KernovaKernel, DaemonRunner } = await import('@kernova/core');

    const dataDir = options.dataDir || defaultDataDir();

    const kernel = new KernovaKernel({
      environment: 'development',
      dataDir,
    });

    const daemon = new DaemonRunner(kernel, {
      configPath: options.config,
      watch: options.watch,
      port: options.port,
      host: options.host,
      dataDir,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
    });

    // start() resolves when the daemon stops, so report readiness from its started event
    kernel.events.subscribe('daemon.started', () => {
      if (options.port !== undefined) {
        success(`Gateway listening on http://${options.host ?? '127.0.0.1'}:${options.port}`);
      }
      success('Daemon is running. Press Ctrl+C to stop.');
    });

    await daemon.start();
  } catch (err) {
    const message = (err as Error).message;
    error(`Failed to start daemon: ${message}`);
    if (/no authentication configured/.test(message)) {
      info('Set KERNOVA_API_KEY to the token clients must send (Authorization: Bearer <token>).');
    }
    process.exit(1);
  }
}

interface ServeOptions {
  config?: string;
  watch?: boolean;
  port?: number;
  host?: string;
  dataDir?: string;
  shutdownTimeoutMs?: number;
  heartbeatIntervalMs?: number;
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
      case '--host':
        options.host = args[++i];
        break;
      case '--data-dir':
      case '-d':
        options.dataDir = args[++i];
        break;
      case '--shutdown-timeout':
        options.shutdownTimeoutMs = parseInt(args[++i], 10);
        break;
      case '--heartbeat':
        options.heartbeatIntervalMs = parseInt(args[++i], 10);
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
    -c, --config <path>         Path to agent config file or directory
    -w, --watch                 Enable hot-reload of config files
    -p, --port <number>         Serve the HTTP gateway on this port (needs KERNOVA_API_KEY)
        --host <address>        Interface for the gateway (default: 127.0.0.1)
    -d, --data-dir <path>       Data directory (default: $KERNOVA_DATA_DIR or ./kernova-data)
        --shutdown-timeout <ms> How long to wait for active intents on shutdown (default: 30000)
        --heartbeat <ms>        Heartbeat event interval (default: 60000)
    -h, --help                  Show this help message

  Examples:
    kernova serve
    kernova serve --config ./agents/ --watch
    KERNOVA_API_KEY=secret kernova serve --port 3000 --data-dir ./data
  `);
}
