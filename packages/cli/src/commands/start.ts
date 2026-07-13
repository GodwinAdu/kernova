/**
 * kernova start
 *
 * Starts the production server.
 * Runs both the agent backend and Next.js frontend in production mode.
 *
 * Must run "kernova build" first.
 *
 * Usage:
 *   kernova start
 *   kernova start --port 3000
 *   kernova start --agents-only
 *   kernova start --agent-port 4555
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { printBanner, success, info, error } from '../ui.js';

interface StartOptions {
  port: number;
  agentPort: number;
  agentsOnly: boolean;
  appOnly: boolean;
}

function parseStartArgs(args: string[]): StartOptions {
  const options: StartOptions = {
    port: 3000,
    agentPort: 4555,
    agentsOnly: args.includes('--agents-only'),
    appOnly: args.includes('--app-only'),
  };

  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) options.port = parseInt(args[portIdx + 1]);

  const agentPortIdx = args.indexOf('--agent-port');
  if (agentPortIdx !== -1 && args[agentPortIdx + 1]) {
    options.agentPort = parseInt(args[agentPortIdx + 1]);
  }

  // Support PORT env variable
  if (process.env.PORT) options.port = parseInt(process.env.PORT);

  return options;
}

export async function handleStart(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const options = parseStartArgs(args);

  printBanner();

  // Check build exists
  const manifestPath = join(projectRoot, '.kernova-build', 'manifest.json');
  const hasManifest = existsSync(manifestPath);

  if (!hasManifest) {
    error('No build found. Run "kernova build" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const hasAgents = manifest.hasAgents && !options.appOnly;
  const hasApp = manifest.hasApp && !options.agentsOnly;

  // Read project name
  let projectName = manifest.name || 'kernova-app';

  info(`Starting "${projectName}" in production mode...`);
  console.log('');

  const processes: ChildProcess[] = [];

  // Start Next.js frontend FIRST (so Render detects its port as primary)
  if (hasApp) {
    const nextProcess = spawn('npx', ['next', 'start', '--port', String(options.port)], {
      cwd: projectRoot,
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(options.port),
        KERNOVA_URL: `http://localhost:${options.agentPort}`,
      },
    });

    nextProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  [app]    ${msg}`);
    });

    nextProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('ExperimentalWarning')) {
        console.error(`  [app]    ${msg}`);
      }
    });

    nextProcess.on('exit', (code) => {
      if (code !== 0) {
        error(`Frontend exited with code ${code}`);
        processes.forEach(p => p.kill());
        process.exit(1);
      }
    });

    processes.push(nextProcess);
    await sleep(2000); // Wait for Next.js to bind to port
  }

  // Start agent backend (on internal port, not exposed by Render)
  if (hasAgents) {
    const agentProcess = spawn('node', [
      '--input-type=module',
    ], {
      cwd: projectRoot,
      stdio: 'pipe',
      shell: false,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        KERNOVA_PORT: String(options.agentPort),
      },
    });

    // Write the startup script via a generated entry point
    const entryScript = generateProductionEntry(projectRoot, options.agentPort);
    agentProcess.stdin?.write(entryScript);
    agentProcess.stdin?.end();

    agentProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  [agents] ${msg}`);
    });

    agentProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`  [agents] ${msg}`);
    });

    agentProcess.on('exit', (code) => {
      if (code !== 0) {
        error(`Agent backend exited with code ${code}`);
        processes.forEach(p => p.kill());
        process.exit(1);
      }
    });

    processes.push(agentProcess);
    await sleep(1500); // Wait for agent backend to boot
    success(`Agent backend running on port ${options.agentPort}`);
  }

  // Ready
  console.log('');
  console.log('  ════════════════════════════════════════════');
  success(`Production server running`);
  console.log('');

  if (hasApp) {
    console.log(`    App:    http://localhost:${options.port}`);
    console.log(`    Agents: http://localhost:${options.port}/api/agents/*`);
  } else {
    console.log(`    Agents: http://localhost:${options.agentPort}`);
  }

  console.log('');
  info('Press Ctrl+C to stop.');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    info('Shutting down...');
    processes.forEach(p => p.kill('SIGTERM'));
    await sleep(2000);
    processes.forEach(p => { if (!p.killed) p.kill('SIGKILL'); });
    success('Stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

function generateProductionEntry(projectRoot: string, port: number): string {
  return `
import { createServer } from '@kernova/framework/server';

const port = parseInt(process.env.KERNOVA_PORT || '${port}');

try {
  await createServer({
    projectRoot: '${projectRoot.replace(/\\/g, '/')}',
    port,
  });
} catch (err) {
  console.error('[kernova] Failed to start agent backend:', err.message);
  process.exit(1);
}
`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
