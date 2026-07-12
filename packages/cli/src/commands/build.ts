/**
 * kernova build
 *
 * Builds the project for production:
 *   1. Compiles agents (TypeScript → JavaScript)
 *   2. Builds frontend (next build)
 *   3. Validates configuration
 *   4. Generates production manifest
 *
 * Usage:
 *   kernova build
 *   kernova build --agents-only
 *   kernova build --app-only
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { printBanner, success, info, error, warn } from '../ui.js';

interface BuildOptions {
  agentsOnly: boolean;
  appOnly: boolean;
  verbose: boolean;
}

function parseBuildArgs(args: string[]): BuildOptions {
  return {
    agentsOnly: args.includes('--agents-only'),
    appOnly: args.includes('--app-only'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

export async function handleBuild(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const options = parseBuildArgs(args);

  printBanner();

  // Detect project structure
  const hasAgents = existsSync(join(projectRoot, 'agents'));
  const hasApp = existsSync(join(projectRoot, 'app'));
  const hasConfigTs = existsSync(join(projectRoot, 'kernova.config.ts'));
  const hasNextConfig = existsSync(join(projectRoot, 'next.config.ts'))
    || existsSync(join(projectRoot, 'next.config.js'));

  if (!hasConfigTs && !hasAgents) {
    error('No Kernova project found. Missing kernova.config.ts or agents/ directory.');
    info('Run "kernova create my-app" to start a new project.');
    process.exit(1);
  }

  // Read project name from package.json
  let projectName = 'kernova-app';
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    projectName = pkg.name || projectName;
  }

  info(`Building "${projectName}" for production...`);
  console.log('');

  const startTime = Date.now();
  const buildSteps: string[] = [];

  // Step 1: Validate config
  info('[1/4] Validating configuration...');
  if (hasConfigTs) {
    try {
      execSync('npx tsx --eval "import(\'./kernova.config.ts\')"', {
        cwd: projectRoot,
        stdio: options.verbose ? 'inherit' : 'pipe',
      });
      success('Configuration valid');
      buildSteps.push('config');
    } catch {
      error('Invalid kernova.config.ts — fix errors and try again.');
      process.exit(1);
    }
  } else {
    success('Configuration valid (using defaults)');
  }

  // Step 2: Compile agents
  if (hasAgents && !options.appOnly) {
    info('[2/4] Compiling agents...');
    try {
      // Check if tsconfig exists, if not create a minimal one for compilation
      const distDir = join(projectRoot, 'dist');
      if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

      execSync('npx tsc --outDir dist --declaration --skipLibCheck', {
        cwd: projectRoot,
        stdio: options.verbose ? 'inherit' : 'pipe',
      });
      success('Agents compiled → dist/');
      buildSteps.push('agents');
    } catch (err) {
      // Try with looser settings
      try {
        execSync('npx tsc --outDir dist --skipLibCheck --noEmit false --declaration false', {
          cwd: projectRoot,
          stdio: options.verbose ? 'inherit' : 'pipe',
        });
        success('Agents compiled → dist/ (with warnings)');
        buildSteps.push('agents');
      } catch {
        error('Agent compilation failed. Run with --verbose to see errors.');
        process.exit(1);
      }
    }
  } else {
    info('[2/4] Skipping agent compilation');
  }

  // Step 3: Build frontend
  if (hasApp && hasNextConfig && !options.agentsOnly) {
    info('[3/4] Building frontend (Next.js)...');
    try {
      execSync('npx next build', {
        cwd: projectRoot,
        stdio: options.verbose ? 'inherit' : 'pipe',
        env: {
          ...process.env,
          KERNOVA_URL: process.env.KERNOVA_URL || 'http://localhost:4555',
          NODE_ENV: 'production',
        },
      });
      success('Frontend built → .next/');
      buildSteps.push('frontend');
    } catch {
      error('Frontend build failed. Run with --verbose to see errors.');
      process.exit(1);
    }
  } else {
    info('[3/4] Skipping frontend build');
  }

  // Step 4: Generate production manifest
  info('[4/4] Generating build manifest...');

  const manifest = {
    name: projectName,
    buildTime: new Date().toISOString(),
    parts: buildSteps,
    hasApp: hasApp && !options.agentsOnly,
    hasAgents: hasAgents && !options.appOnly,
    node: process.version,
    framework: '@kernova/framework@0.1.0',
  };

  const manifestDir = join(projectRoot, '.kernova-build');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  success('Build manifest generated');

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('  ════════════════════════════════════════════');
  success(`Build complete in ${elapsed}s`);
  console.log('');
  console.log(`    Built: ${buildSteps.join(', ')}`);
  console.log('');
  info('Run in production:');
  console.log('    kernova start');
  console.log('');
  info('Or deploy to Kernova Cloud:');
  console.log('    kernova deploy');
  console.log('');
}
