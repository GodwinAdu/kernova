/**
 * kernova dev
 *
 * Starts the Kernova development runtime.
 *
 * Detects project type:
 *   - Full-stack (has agents/ + app/): runs both frontend + agent backend
 *   - Agent-only (has kernova.config.json or agents/): runs agent backend only
 *   - Legacy (has kernova.config.json + src/agents/): runs legacy DevServer
 *
 * In full-stack mode:
 *   - Frontend runs on port 3000 (Next.js)
 *   - Agent backend runs on port 4555 (internal)
 *   - Next.js rewrites proxy /api/agents/* → agent backend
 *   - User sees ONE URL: http://localhost:3000
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { printBanner, success, info, warn, error } from '../ui.js';

interface ProjectType {
  mode: 'fullstack' | 'agents-only' | 'legacy';
  hasApp: boolean;
  hasAgents: boolean;
  hasConfig: boolean;
  hasLegacyConfig: boolean;
}

function detectProjectType(projectRoot: string): ProjectType {
  const hasApp = existsSync(join(projectRoot, 'app'));
  const hasAgents = existsSync(join(projectRoot, 'agents'));
  const hasConfig = existsSync(join(projectRoot, 'kernova.config.ts'))
    || existsSync(join(projectRoot, 'kernova.config.js'));
  const hasLegacyConfig = existsSync(join(projectRoot, 'kernova.config.json'));

  let mode: 'fullstack' | 'agents-only' | 'legacy';

  if (hasAgents && hasApp) {
    mode = 'fullstack';
  } else if (hasAgents || hasConfig) {
    mode = 'agents-only';
  } else {
    mode = 'legacy';
  }

  return { mode, hasApp, hasAgents, hasConfig, hasLegacyConfig };
}

export async function handleDev(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const project = detectProjectType(projectRoot);

  printBanner();

  // Parse flags
  const agentsOnly = args.includes('--agents-only');
  const appOnly = args.includes('--app-only');
  const port = getPort(args) || 3000;
  const agentPort = getAgentPort(args) || 4555;

  if (project.mode === 'legacy') {
    // Fall back to legacy DevServer from @kernova/core
    await runLegacyDev(projectRoot);
    return;
  }

  if (project.mode === 'agents-only' || agentsOnly) {
    await runAgentsDev(projectRoot, agentPort);
    return;
  }

  // Full-stack mode
  await runFullStackDev(projectRoot, port, agentPort, appOnly);
}

async function runFullStackDev(
  projectRoot: string,
  port: number,
  agentPort: number,
  appOnly: boolean
): Promise<void> {
  const processes: ChildProcess[] = [];

  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │  🚀 Kernova Full-Stack Dev Server        │');
  console.log('  └──────────────────────────────────────────┘');
  console.log('');

  // 1. Start agent backend (port 4555)
  if (!appOnly) {
    info('Starting agent backend...');
    const agentProcess = spawn('npx', tsxWatchArgs(resolveAgentEntry(projectRoot)), {
      cwd: projectRoot,
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        KERNOVA_PORT: String(agentPort),
        NODE_ENV: 'development',
      },
    });

    agentProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  [agents] ${msg}`);
    });

    agentProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('ExperimentalWarning')) {
        console.error(`  [agents] ${msg}`);
      }
    });

    processes.push(agentProcess);

    // Report the backend as running only once it answers, and say so when it doesn't start
    const state = await waitForAgentServer(agentProcess, agentPort);
    if (state === 'ready') {
      success(`Agent backend running on port ${agentPort} (internal)`);
    } else if (state === 'exited') {
      error('Agent backend failed to start; see the [agents] output above.');
    } else {
      warn(`Agent backend is still starting on port ${agentPort}; requests will fail until it's up.`);
    }
  }

  // 2. Start Next.js frontend (port 3000) — this is what the user sees
  info('Starting frontend...');
  const nextProcess = spawn('npx', ['next', 'dev', '--port', String(port)], {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: true,
    env: {
      ...process.env,
      KERNOVA_URL: `http://localhost:${agentPort}`,
      NEXT_PUBLIC_KERNOVA_URL: `http://localhost:${agentPort}`,
    },
  });

  nextProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`  [app]    ${msg}`);
  });

  nextProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('ExperimentalWarning')) {
      console.error(`  [app]    ${msg}`);
    }
  });

  processes.push(nextProcess);

  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('');
  success(`Ready at http://localhost:${port}`);
  console.log('');
  console.log(`    App:     http://localhost:${port}`);
  console.log(`    Chat:    http://localhost:${port}/chat`);
  console.log(`    Agents:  http://localhost:${port}/api/agents/*`);
  if (!appOnly) console.log(`    Health:  http://127.0.0.1:${agentPort}/health  (backend, this machine only)`);
  console.log('');
  info('All requests go through one URL. No CORS needed.');
  info('Press Ctrl+C to stop.');
  console.log('');

  // Graceful shutdown
  const shutdown = () => {
    console.log('');
    info('Shutting down...');
    for (const proc of processes) {
      proc.kill();
    }
    success('Stopped.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {});
}

async function runAgentsDev(projectRoot: string, port: number): Promise<void> {
  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │  🧠 Kernova Agent Dev Server             │');
  console.log('  └──────────────────────────────────────────┘');
  console.log('');

  const entryFile = resolveAgentEntry(projectRoot);

  const agentProcess = spawn('npx', tsxWatchArgs(entryFile), {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      KERNOVA_PORT: String(port),
      NODE_ENV: 'development',
    },
  });

  agentProcess.on('close', (code) => {
    if (code !== 0) {
      error(`Agent server exited with code ${code}`);
    }
    process.exit(code || 0);
  });

  process.on('SIGINT', () => { agentProcess.kill(); process.exit(0); });
  process.on('SIGTERM', () => { agentProcess.kill(); process.exit(0); });

  await new Promise(() => {});
}

async function runLegacyDev(projectRoot: string): Promise<void> {
  // Import and run the legacy DevServer from @kernova/core
  const configPath = join(projectRoot, 'kernova.config.json');

  if (!existsSync(configPath)) {
    error('No kernova.config.json or kernova.config.ts found.');
    info('Run "kernova create my-app" to create a new project.');
    process.exit(1);
  }

  const configRaw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configRaw);

  info(`Starting legacy kernova runtime for "${config.name}"...`);

  const { DevServer } = await import('@kernova/core');

  const server = new DevServer({
    rootDir: projectRoot,
    kernel: { environment: 'development', debug: false },
    agentDirs: ['src/agents'],
    onStatus: (message: string, type: string) => {
      switch (type) {
        case 'success': success(message); break;
        case 'error': error(message); break;
        default: info(message); break;
      }
    },
  });

  await server.start();

  const kernel = server.getKernel();
  const status = kernel.getStatus();

  console.log('');
  success('kernova runtime is running');
  console.log(`    Agents:  ${status.registeredAgents}`);
  console.log('');
  info('Press Ctrl+C to stop.');

  const shutdown = async () => {
    info('Shutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

/**
 * Generate/resolve the agent dev entry point.
 * This is a small script that boots the framework server.
 */
function resolveAgentEntry(projectRoot: string): string {
  const entryPath = join(projectRoot, 'node_modules', '.kernova', 'dev-entry.ts');
  const entryDir = join(projectRoot, 'node_modules', '.kernova');

  // Generate the dev entry script
  try { mkdirSync(entryDir, { recursive: true }); } catch {}

  writeFileSync(entryPath, `
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '@kernova/framework/server';

// Load .env.local into process.env (like Next.js does)
const projectRoot = '${projectRoot.replace(/\\/g, '/')}';
const envFiles = ['.env.local', '.env'];
for (const envFile of envFiles) {
  const envPath = resolve(projectRoot, envFile);
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Accept quoted values: KEY="value" or KEY='value'
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const port = parseInt(process.env.KERNOVA_PORT || '4555');
// Only this machine can reach the dev backend unless KERNOVA_HOST says otherwise
// (the Next.js app proxies to it on localhost)
const host = process.env.KERNOVA_HOST || '127.0.0.1';

createServer({
  projectRoot,
  port,
  host,
}).then(() => {
  // Server started
}).catch((err) => {
  console.error('Failed to start agent server:', err.message);
  process.exit(1);
});
`);

  return entryPath;
}

function getPort(args: string[]): number | null {
  const idx = args.indexOf('--port');
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1]);
  const pIdx = args.indexOf('-p');
  if (pIdx !== -1 && args[pIdx + 1]) return parseInt(args[pIdx + 1]);
  return null;
}

function getAgentPort(args: string[]): number | null {
  const idx = args.indexOf('--agent-port');
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1]);
  return null;
}

/**
 * tsx in watch mode, skipping folders the server writes to (kernova-data) or that change on
 * their own (.next, node_modules); watching them restarts the server in a loop.
 * `tsx --watch` would hand the flags to Node, which rejects them.
 */
function tsxWatchArgs(entry: string): string[] {
  return ['tsx', 'watch', '--exclude', 'kernova-data/**', '--exclude', '.next/**', '--exclude', 'node_modules/**', entry];
}

/** Waits until the agent server answers /health, its process exits, or the timeout passes */
async function waitForAgentServer(
  child: ChildProcess,
  port: number,
  timeoutMs = 60_000,
): Promise<'ready' | 'exited' | 'timeout'> {
  let exited = child.exitCode !== null;
  child.once('exit', () => { exited = true; });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) return 'exited';
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return 'ready';
    } catch {
      // Not listening yet
    }
    await sleep(500);
  }
  return exited ? 'exited' : 'timeout';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
