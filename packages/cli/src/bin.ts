#!/usr/bin/env node
/**
 * Nexus CLI Entry Point
 * 
 * The developer's first interaction with Nexus.
 * `nexus init` → `nexus dev` → `nexus deploy`
 */

import { handleInit } from './commands/init.js';
import { handleDev } from './commands/dev.js';
import { handleAgent } from './commands/agent.js';
import { handleStatus } from './commands/status.js';
import { handleDeploy } from './commands/deploy.js';
import { printHelp, printVersion, printBanner } from './ui.js';

const commands: Record<string, (args: string[]) => Promise<void>> = {
  init: handleInit,
  dev: handleDev,
  agent: handleAgent,
  status: handleStatus,
  deploy: handleDeploy,
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printBanner();
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    printVersion();
    return;
  }

  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run 'nexus --help' for available commands.`);
    process.exit(1);
  }

  try {
    await handler(args.slice(1));
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
