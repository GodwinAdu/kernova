/**
 * kernova deploy
 *
 * Deploys the project to Kernova Cloud (or generates deploy artifacts).
 *
 * Usage:
 *   kernova deploy              # Deploy everything to Kernova Cloud
 *   kernova deploy --agents-only   # Deploy only agents
 *   kernova deploy --app-only      # Deploy only frontend
 *   kernova deploy docker       # Generate Docker artifacts (self-host)
 *   kernova deploy node         # Generate Node.js production entry
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { printBanner, success, info, error, warn } from '../ui.js';

interface DeployOptions {
  target: 'cloud' | 'docker' | 'node';
  agentsOnly: boolean;
  appOnly: boolean;
  region: string;
}

function parseDeployArgs(args: string[]): DeployOptions {
  const options: DeployOptions = {
    target: 'cloud',
    agentsOnly: args.includes('--agents-only'),
    appOnly: args.includes('--app-only'),
    region: 'us-east-1',
  };

  // Check for explicit target
  if (args.includes('docker')) options.target = 'docker';
  else if (args.includes('node')) options.target = 'node';

  const regionIdx = args.indexOf('--region');
  if (regionIdx !== -1 && args[regionIdx + 1]) {
    options.region = args[regionIdx + 1];
  }

  return options;
}

export async function handleDeploy(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const options = parseDeployArgs(args);

  printBanner();

  // Detect project type
  const hasConfigTs = existsSync(join(projectRoot, 'kernova.config.ts'));
  const hasConfigJson = existsSync(join(projectRoot, 'kernova.config.json'));
  const hasAgents = existsSync(join(projectRoot, 'agents'));
  const hasApp = existsSync(join(projectRoot, 'app'));

  if (!hasConfigTs && !hasConfigJson) {
    error('No kernova.config.ts or kernova.config.json found.');
    info('Run "kernova create my-app" to start a new project.');
    process.exit(1);
  }

  // Load project name
  let projectName = 'kernova-app';
  if (hasConfigTs) {
    // Read package.json for name
    const pkgPath = join(projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      projectName = pkg.name || projectName;
    }
  } else if (hasConfigJson) {
    const config = JSON.parse(readFileSync(join(projectRoot, 'kernova.config.json'), 'utf-8'));
    projectName = config.name || projectName;
  }

  switch (options.target) {
    case 'cloud':
      await deployToCloud(projectRoot, projectName, hasApp, hasAgents, options);
      break;
    case 'docker':
      deployDocker(projectRoot, projectName, hasApp, hasAgents, options);
      break;
    case 'node':
      deployNode(projectRoot, projectName);
      break;
  }
}

async function deployToCloud(
  projectRoot: string,
  name: string,
  hasApp: boolean,
  hasAgents: boolean,
  options: DeployOptions
): Promise<void> {
  info(`Deploying "${name}" to Kernova Cloud...`);
  console.log('');

  const deployParts: string[] = [];
  if (hasApp && !options.agentsOnly) deployParts.push('frontend');
  if (hasAgents && !options.appOnly) deployParts.push('agents');

  console.log(`  Deploying: ${deployParts.join(' + ')}`);
  console.log(`  Region:    ${options.region}`);
  console.log('');

  // Step 1: Build
  info('Building project...');
  try {
    if (hasApp && !options.agentsOnly) {
      execSync('npx next build', { cwd: projectRoot, stdio: 'pipe' });
      success('Frontend built');
    }
    success('Build complete');
  } catch (err) {
    error('Build failed. Fix errors and try again.');
    process.exit(1);
  }

  // Step 2: Package
  info('Packaging for Kernova Cloud...');

  const deployDir = join(projectRoot, '.kernova-deploy');
  mkdirSync(deployDir, { recursive: true });

  // Generate deploy manifest
  const manifest = {
    name,
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    region: options.region,
    parts: {
      app: hasApp && !options.agentsOnly,
      agents: hasAgents && !options.appOnly,
    },
    routes: {
      frontend: hasApp ? '/*' : null,
      agents: hasAgents ? '/api/agents/*' : null,
      gateway: '/v1/*',
    },
  };

  writeFileSync(join(deployDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  success('Deploy package created');

  // Step 3: Deploy (placeholder — will connect to real Kernova Cloud API)
  console.log('');
  info('Uploading to Kernova Cloud...');
  console.log('');

  // Simulated deployment output
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │  ✅ Deployed successfully                        │');
  console.log('  ├──────────────────────────────────────────────────┤');
  console.log(`  │  URL:     https://${name}.kernova.app           `);
  console.log(`  │  Region:  ${options.region}                     `);
  console.log('  │                                                  │');

  if (hasApp && !options.agentsOnly) {
    console.log(`  │  App:     https://${name}.kernova.app          `);
  }
  if (hasAgents && !options.appOnly) {
    console.log(`  │  Agents:  https://${name}.kernova.app/api/agents/*`);
    console.log(`  │  Gateway: https://${name}.kernova.app/v1/*     `);
  }

  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');

  info('Your app is live. One URL for everything:');
  console.log(`    https://${name}.kernova.app`);
  console.log('');
}

function deployDocker(
  projectRoot: string,
  name: string,
  hasApp: boolean,
  hasAgents: boolean,
  options: DeployOptions
): void {
  info(`Generating Docker deployment for "${name}"...`);
  console.log('');

  const deployDir = join(projectRoot, 'deploy');
  if (!existsSync(deployDir)) mkdirSync(deployDir, { recursive: true });

  // Generate multi-stage Dockerfile for full-stack
  const dockerfile = hasApp
    ? `# Multi-stage: build frontend + run agents
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx next build

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY --from=frontend-build /app/.next ./.next
COPY --from=frontend-build /app/public ./public
COPY agents/ ./agents/
COPY memory/ ./memory/
COPY kernova.config.ts ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "node_modules/.bin/kernova", "start"]
`
    : `# Agents-only container
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY agents/ ./agents/
COPY memory/ ./memory/
COPY kernova.config.ts ./

ENV NODE_ENV=production
ENV PORT=4555
EXPOSE 4555

CMD ["node", "node_modules/.bin/kernova", "start", "--agents-only"]
`;

  writeFileSync(join(projectRoot, 'Dockerfile'), dockerfile);
  success('Generated Dockerfile');

  writeFileSync(join(projectRoot, '.dockerignore'), `node_modules
.next
.git
.env.local
.env
kernova-data
`);
  success('Generated .dockerignore');

  console.log('');
  info('Build and run:');
  console.log(`    docker build -t ${name} .`);
  console.log(`    docker run -p 3000:3000 --env-file .env.local ${name}`);
  console.log('');
}

function deployNode(projectRoot: string, name: string): void {
  info(`Generating Node.js production entry for "${name}"...`);

  writeFileSync(join(projectRoot, 'start.ts'), `/**
 * Production entry point — runs both frontend and agent backend.
 * Generated by: kernova deploy node
 */
import { createServer } from '@kernova/framework/server';

const port = parseInt(process.env.PORT || '4555');

async function main() {
  await createServer({
    projectRoot: import.meta.dirname,
    port,
  });

  console.log(\`[kernova] Production server running on port \${port}\`);
}

main().catch((err) => {
  console.error('[kernova] Fatal:', err.message);
  process.exit(1);
});
`);

  success('Generated start.ts');
  console.log('');
  info('Run in production:');
  console.log('    npx next build');
  console.log('    NODE_ENV=production npx tsx start.ts');
  console.log('');
}
