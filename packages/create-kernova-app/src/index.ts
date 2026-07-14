#!/usr/bin/env node
/**
 * create-kernova-app
 *
 * Scaffolds a new full-stack Kernova AI agent project.
 * Interactive prompts guide the user through setup choices.
 *
 * Usage:
 *   npx create-kernova-app
 *   npx create-kernova-app my-app
 *   npx create-kernova-app my-app --template multi-agent --react
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { scaffoldProject } from './scaffold.js';

interface CliOptions {
  name: string;
  template: 'default' | 'minimal' | 'multi-agent';
  framework: 'next' | 'react' | 'none';
  install: boolean;
  git: boolean;
}

// ─── Interactive Prompts ─────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function select(question: string, options: Array<{ value: string; label: string; hint?: string }>): Promise<string> {
  console.log(`\n  ${question}`);
  options.forEach((opt, i) => {
    const hint = opt.hint ? `  ${opt.hint}` : '';
    console.log(`    ${i + 1}) ${opt.label}${hint}`);
  });
  
  const answer = await ask(`\n  Enter choice (1-${options.length}) [1]: `);
  const index = parseInt(answer) - 1;
  
  if (index >= 0 && index < options.length) {
    return options[index].value;
  }
  return options[0].value; // Default to first option
}

// ─── Main ────────────────────────────────────────────────────

function parseArgs(args: string[]): Partial<CliOptions> {
  const options: Partial<CliOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--template' || arg === '-t') {
      const val = args[++i];
      if (val === 'minimal' || val === 'multi-agent' || val === 'default') {
        options.template = val;
      }
    } else if (arg === '--no-frontend') {
      options.framework = 'none';
    } else if (arg === '--react') {
      options.framework = 'react';
    } else if (arg === '--next') {
      options.framework = 'next';
    } else if (arg === '--no-install') {
      options.install = false;
    } else if (arg === '--no-git') {
      options.git = false;
    } else if (!arg.startsWith('-') && !options.name) {
      options.name = arg;
    }
  }

  return options;
}

function printBanner(): void {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║     🧠 create-kernova-app               ║');
  console.log('  ║     Full-stack AI agent framework        ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
}

function printSuccess(name: string, framework: string): void {
  console.log('');
  console.log('  ✅ Project created successfully!');
  console.log('');
  console.log('  Next steps:');
  console.log(`     cd ${name}`);
  console.log('     kernova dev');
  console.log('');
  if (framework !== 'none') {
    console.log('  This starts:');
    console.log('     • Frontend at http://localhost:3000');
    console.log('     • Agent API at http://localhost:3000/api/agents/*');
  } else {
    console.log('  This starts:');
    console.log('     • Agent API at http://localhost:4555');
    console.log('     • Health: http://localhost:4555/health');
  }
  console.log('');
  console.log('  When ready to deploy:');
  console.log('     kernova deploy');
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printBanner();
    console.log('  Usage: npx create-kernova-app [project-name] [options]');
    console.log('');
    console.log('  Options:');
    console.log('    --template, -t   Template: default, minimal, multi-agent');
    console.log('    --next           Use Next.js (default)');
    console.log('    --react          Use Vite + React');
    console.log('    --no-frontend    Agents only (no UI)');
    console.log('    --no-install     Skip npm install');
    console.log('    --no-git         Skip git init');
    console.log('');
    return;
  }

  printBanner();

  const parsed = parseArgs(args);

  // Interactive: Ask for project name if not provided
  let name = parsed.name || '';
  if (!name) {
    name = await ask('  Project name: ');
    if (!name.trim()) {
      console.error('  ❌ Project name is required.');
      process.exit(1);
    }
    name = name.trim();
  }

  // Interactive: Ask for framework if not provided via flag
  let framework = parsed.framework;
  if (!framework) {
    framework = await select('Frontend framework:', [
      { value: 'next', label: 'Next.js', hint: '(recommended — full-stack, SSR, API routes)' },
      { value: 'react', label: 'React (Vite)', hint: '(SPA — lightweight, fast builds)' },
      { value: 'none', label: 'None', hint: '(agents only — no frontend, API server only)' },
    ]) as 'next' | 'react' | 'none';
  }

  // Interactive: Ask for template if not provided via flag
  let template = parsed.template;
  if (!template) {
    template = await select('Template:', [
      { value: 'default', label: 'Default', hint: '(single agent + chat UI + tools)' },
      { value: 'multi-agent', label: 'Multi-agent', hint: '(team with specialist agents + delegation)' },
      { value: 'minimal', label: 'Minimal', hint: '(bare bones — just an agent, no extras)' },
    ]) as 'default' | 'minimal' | 'multi-agent';
  }

  rl.close();

  // Validate
  const projectDir = resolve(process.cwd(), name);
  if (existsSync(projectDir)) {
    console.error(`\n  ❌ Directory "${name}" already exists.`);
    process.exit(1);
  }

  console.log('');
  console.log(`  Creating "${name}"...`);
  console.log(`  • Framework: ${framework === 'none' ? 'None (agents only)' : framework === 'next' ? 'Next.js' : 'React (Vite)'}`);
  console.log(`  • Template: ${template}`);

  // Scaffold
  scaffoldProject({
    name,
    directory: projectDir,
    template,
    framework,
  });

  console.log('  • Project structure created ✓');

  // Git
  const git = parsed.git !== false;
  if (git) {
    try {
      execSync('git init', { cwd: projectDir, stdio: 'ignore' });
      execSync('git add -A', { cwd: projectDir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit from create-kernova-app"', { cwd: projectDir, stdio: 'ignore' });
      console.log('  • Git initialized ✓');
    } catch { /* Git not available */ }
  }

  // Install
  const install = parsed.install !== false;
  if (install) {
    console.log('  • Installing dependencies...');
    try {
      execSync('npm install', { cwd: projectDir, stdio: 'pipe' });
      console.log('  • Dependencies installed ✓');
    } catch {
      console.log('  ⚠️  npm install failed. Run it manually.');
    }
  }

  printSuccess(name, framework);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  rl.close();
  process.exit(1);
});
