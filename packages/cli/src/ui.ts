/**
 * CLI UI utilities
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Version from this package's package.json (dist/ui.js → ../package.json) */
const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

const DOCS_URL = 'https://kernova2026.vercel.app';

/** Inner width of the banner box */
const BANNER_WIDTH = 38;

export function printBanner(): void {
  const line = (text: string) => `  ║${text.padEnd(BANNER_WIDTH)}║`;
  console.log([
    '',
    `  ╔${'═'.repeat(BANNER_WIDTH)}╗`,
    line(''),
    line('   ◆  K E R N O V A'),
    line('      Full-Stack AI Agent Platform'),
    line(`      v${VERSION}`),
    line(''),
    `  ╚${'═'.repeat(BANNER_WIDTH)}╝`,
  ].join('\n'));
}

export function printVersion(): void {
  console.log(`kernova v${VERSION}`);
}

export function printHelp(): void {
  console.log(`
  Usage: kernova <command> [options]

  Develop:
    create <name>       Scaffold a full-stack project (Next.js or React + agents)
    dev                 Start frontend + agents with hot reload
    doctor              Test every configured AI provider

  Build & deploy:
    build               Build for production
    start               Run the production build
    deploy [target]     Deploy to Kernova Cloud, or generate docker / node artifacts
    login               Authenticate with Kernova Cloud
    logout              Remove saved credentials

  Operate:
    serve               Run agents as a long-lived daemon
    studio              Open the Kernova Studio dashboard
    status              Show runtime status
    agent <action>      Manage agents (create, list, inspect)
    schedule <action>   Manage scheduled jobs (list, enable, disable)
    queue <action>      Manage the task queue (status, replay)
    triggers <action>   Manage proactive triggers (list, enable, disable)
    init [name]         Create an agents-only project (legacy)

  Options:
    -h, --help          Show this help message
    -v, --version       Show version number

  Examples:
    kernova create my-app
    kernova dev
    kernova doctor
    kernova deploy
    kernova serve --config ./agents/ --watch
    kernova studio --gateway http://localhost:3000

  Documentation: ${DOCS_URL}
  `);
}

export function success(message: string): void {
  console.log(`  ✓ ${message}`);
}

export function info(message: string): void {
  console.log(`  → ${message}`);
}

export function warn(message: string): void {
  console.log(`  ⚠ ${message}`);
}

export function error(message: string): void {
  console.error(`  ✗ ${message}`);
}

/** Data directory when --data-dir isn't given: $KERNOVA_DATA_DIR, else ./kernova-data */
export function defaultDataDir(): string {
  return resolve(process.cwd(), process.env.KERNOVA_DATA_DIR || 'kernova-data');
}
