/**
 * kernova status
 * 
 * Shows the current state of the kernova runtime.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { info, warn } from '../ui.js';

export async function handleStatus(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const configPath = join(projectRoot, 'kernova.config.json');

  if (!existsSync(configPath)) {
    warn('Not a kernova project (no kernova.config.json found).');
    info('Run "kernova init" to create a new project.');
    return;
  }

  const configRaw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configRaw);

  console.log('');
  console.log('  kernova Project Status');
  console.log('  ════════════════════');
  console.log(`    Name:        ${config.name}`);
  console.log(`    Version:     ${config.version}`);
  console.log(`    Environment: ${config.runtime?.environment || 'development'}`);
  console.log(`    Model:       ${config.models?.default?.provider || 'not configured'}/${config.models?.default?.model || 'none'}`);
  console.log('');
  console.log('  Memory Layers:');
  console.log(`    Working:       ✓`);
  console.log(`    Session:       ✓`);
  console.log(`    Long-term:     ✓`);
  console.log(`    Organizational: ○ (requires cloud)`);
  console.log(`    Global:        ○ (requires cloud)`);
  console.log('');
}
