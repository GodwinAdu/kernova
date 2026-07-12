#!/usr/bin/env node
/**
 * create-kernova-app
 *
 * Scaffolds a new full-stack Kernova AI agent project.
 *
 * Usage:
 *   npx create-kernova-app my-app
 *   npx create-kernova-app my-app --template multi-agent
 *   npx create-kernova-app my-app --no-frontend
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { scaffoldProject } from './scaffold.js';

interface CliOptions {
  name: string;
  template: 'default' | 'minimal' | 'multi-agent';
  framework: 'next' | 'react' | 'none';
  install: boolean;
  git: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    name: '',
    template: 'default',
    framework: 'next',
    install: true,
    git: true,
  };

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

function printSuccess(name: string): void {
  console.log('');
  console.log('  ✅ Project created successfully!');
  console.log('');
  console.log('  Next steps:');
  console.log(`     cd ${name}`);
  console.log('     kernova dev');
  console.log('');
  console.log('  This starts:');
  console.log('     • Frontend at http://localhost:3000');
  console.log('     • Agent API at http://localhost:3000/api/agents/*');
  console.log('');
  console.log('  When ready to deploy:');
  console.log('     kernova deploy');
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printBanner();
    console.log('  Usage: npx create-kernova-app <project-name> [options]');
    console.log('');
    console.log('  Options:');
    console.log('    --template, -t   Template to use (default, minimal, multi-agent)');
    console.log('    --no-frontend    Create agents-only project (no React frontend)');
    console.log('    --react          Use Vite+React instead of Next.js');
    console.log('    --no-install     Skip npm install');
    console.log('    --no-git         Skip git init');
    console.log('');
    return;
  }

  const options = parseArgs(args);

  if (!options.name) {
    printBanner();
    console.error('  ❌ Please provide a project name:');
    console.error('     npx create-kernova-app my-app');
    console.error('');
    process.exit(1);
  }

  const projectDir = resolve(process.cwd(), options.name);

  if (existsSync(projectDir)) {
    console.error(`  ❌ Directory "${options.name}" already exists.`);
    process.exit(1);
  }

  printBanner();
  console.log(`  Creating "${options.name}" with template: ${options.template}`);
  console.log(`  Framework: ${options.framework === 'none' ? 'none (agents only)' : options.framework}`);
  console.log('');

  // Scaffold the project
  scaffoldProject({
    name: options.name,
    directory: projectDir,
    template: options.template,
    framework: options.framework,
  });

  console.log('  📁 Project structure created');

  // Initialize git
  if (options.git) {
    try {
      execSync('git init', { cwd: projectDir, stdio: 'ignore' });
      execSync('git add -A', { cwd: projectDir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit from create-kernova-app"', {
        cwd: projectDir,
        stdio: 'ignore',
      });
      console.log('  📦 Git repository initialized');
    } catch {
      // Git not available — skip silently
    }
  }

  // Install dependencies
  if (options.install) {
    console.log('  📥 Installing dependencies...');
    try {
      execSync('npm install', { cwd: projectDir, stdio: 'pipe' });
      console.log('  ✓  Dependencies installed');
    } catch {
      console.log('  ⚠️  Could not install dependencies. Run "npm install" manually.');
    }
  }

  printSuccess(options.name);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
