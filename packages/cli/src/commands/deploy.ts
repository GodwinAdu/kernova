/**
 * kernova deploy
 * 
 * Builds and prepares the project for production deployment.
 * Generates a Dockerfile and a production-ready entry point.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { printBanner, success, info, error } from '../ui.js';

const DOCKERFILE_TEMPLATE = `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY kernova.config.json ./

ENV NODE_ENV=production
EXPOSE 4200

CMD ["node", "dist/main.js"]
`;

const PRODUCTION_ENTRY = `import { kernovaKernel } from '@kernova/core';
import { StudioServer } from '@kernova/core';
import { AgentLoader } from '@kernova/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = JSON.parse(readFileSync('./kernova.config.json', 'utf-8'));

const kernel = new kernovaKernel({
  environment: 'production',
  debug: false,
  dataDir: process.env.kernova_DATA_DIR || './kernova-data',
});

async function main() {
  await kernel.start();

  // Load agents from dist/agents/
  const loader = new AgentLoader();
  const agentsDir = resolve('./dist/agents');
  const loaded = await loader.loadDirectory(agentsDir);
  for (const result of loaded) {
    if (result.success && result.definition && result.executor) {
      kernel.agentRegistry.register(result.definition, result.executor);
      console.log('[kernova] Agent loaded:', result.name);
    }
  }

  // Start Studio (production mode with auth)
  const studio = new StudioServer(kernel, {
    port: parseInt(process.env.PORT || '4200'),
    host: '0.0.0.0',
    requireAuth: process.env.kernova_AUTH !== 'false',
  });
  const url = await studio.start();

  console.log('[kernova] Production runtime started');
  console.log('[kernova] Studio:', url);
  console.log('[kernova] Agents:', kernel.getStatus().registeredAgents);
  console.log('[kernova] Providers:', kernel.getStatus().availableProviders.join(', ') || 'none');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[kernova] Shutting down...');
    await studio.stop();
    await kernel.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[kernova] Fatal:', err.message);
  process.exit(1);
});
`;

export async function handleDeploy(args: string[]): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const configPath = join(projectRoot, 'kernova.config.json');

  printBanner();

  if (!existsSync(configPath)) {
    error('No kernova.config.json found. Run "kernova init" first.');
    process.exit(1);
  }

  const configRaw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configRaw);
  const target = args[0] || 'docker';

  info(`Preparing deployment for "${config.name}" (target: ${target})`);
  console.log('');

  switch (target) {
    case 'docker':
      deployDocker(projectRoot, config);
      break;
    case 'node':
      deployNode(projectRoot, config);
      break;
    default:
      error(`Unknown deploy target: "${target}". Available: docker, node`);
      process.exit(1);
  }
}

function deployDocker(projectRoot: string, config: Record<string, unknown>): void {
  const deployDir = join(projectRoot, 'deploy');

  if (!existsSync(deployDir)) {
    mkdirSync(deployDir, { recursive: true });
  }

  // Generate Dockerfile
  writeFileSync(join(projectRoot, 'Dockerfile'), DOCKERFILE_TEMPLATE);
  success('Generated Dockerfile');

  // Generate production entry point
  writeFileSync(join(projectRoot, 'src/production.ts'), PRODUCTION_ENTRY);
  success('Generated src/production.ts');

  // Generate .dockerignore
  writeFileSync(join(projectRoot, '.dockerignore'), 'node_modules\nkernova-data\n.git\n');
  success('Generated .dockerignore');

  console.log('');
  info('Build and run:');
  console.log(`    npm run build`);
  console.log(`    docker build -t ${config.name || 'kernova-app'} .`);
  console.log(`    docker run -p 4200:4200 --env-file .env ${config.name || 'kernova-app'}`);
  console.log('');
}

function deployNode(projectRoot: string, config: Record<string, unknown>): void {
  // Generate production entry point only
  writeFileSync(join(projectRoot, 'src/production.ts'), PRODUCTION_ENTRY);
  success('Generated src/production.ts');

  console.log('');
  info('Run in production:');
  console.log('    npm run build');
  console.log('    NODE_ENV=production node dist/production.js');
  console.log('');
}
