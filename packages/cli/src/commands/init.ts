/**
 * kernova init
 * 
 * Creates a new kernova project with the standard structure.
 * This is the developer's first touch point.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { printBanner, success, info, error } from '../ui.js';

const kernova_CONFIG_TEMPLATE = `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "runtime": {
    "environment": "development",
    "debug": true
  },
  "agents": [],
  "memory": {
    "provider": "local",
    "layers": {
      "working": { "maxItems": 50 },
      "session": { "ttlSeconds": 3600 },
      "longterm": { "provider": "local" }
    }
  },
  "models": {
    "default": {
      "provider": "openai",
      "model": "gpt-4o"
    }
  }
}
`;

const AGENT_TEMPLATE = `import { defineAgent } from '@kernova/core';

/**
 * My first kernova agent
 */
export default defineAgent({
  name: 'assistant',
  description: 'A helpful assistant agent',
  capabilities: [
    { id: 'general', name: 'General', description: 'General purpose assistance', confidence: 0.8 }
  ],
  tools: [],
  instructions: \`
    You are a helpful assistant powered by the kernova runtime.
    You have access to memory and tools through the kernova kernel.
  \`,
  
  async execute(intent, context, tools) {
    tools.log(\`Processing intent: \${intent.goal}\`);
    
    return {
      success: true,
      summary: \`Processed: \${intent.goal}\`,
      evidence: {
        sources: [],
        confidence: 0.9,
        reasoning: 'Direct execution',
      },
      durationMs: 0,
    };
  },
});
`;

const MAIN_TEMPLATE = `import { kernovaKernel } from '@kernova/core';

/**
 * kernova Application Entry Point
 */
async function main() {
  const kernel = new kernovaKernel({
    environment: 'development',
    debug: true,
  });

  await kernel.start();
  console.log('kernova runtime started.');

  // Submit your first intent
  const result = await kernel.submit({
    goal: 'Hello, kernova!',
    intentType: 'query',
    priority: 'medium',
  });

  console.log('Result:', result.result?.summary);

  await kernel.stop();
}

main().catch(console.error);
`;

const PACKAGE_JSON_TEMPLATE = `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npx tsx src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@kernova/core": "^0.1.0",
    "@kernova/types": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0"
  }
}
`;

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
`;

export async function handleInit(args: string[]): Promise<void> {
  const projectName = args[0] || 'my-kernova-app';
  const projectPath = resolve(process.cwd(), projectName);

  printBanner();

  if (existsSync(projectPath)) {
    error(`Directory "${projectName}" already exists.`);
    process.exit(1);
  }

  info(`Creating kernova project: ${projectName}`);

  // Create directory structure
  const dirs = [
    '',
    'src',
    'src/agents',
    'src/workflows',
    'src/tools',
  ];

  for (const dir of dirs) {
    mkdirSync(join(projectPath, dir), { recursive: true });
  }

  // Write files
  writeFileSync(
    join(projectPath, 'kernova.config.json'),
    kernova_CONFIG_TEMPLATE.replace(/\{\{PROJECT_NAME\}\}/g, projectName)
  );

  writeFileSync(
    join(projectPath, 'package.json'),
    PACKAGE_JSON_TEMPLATE.replace(/\{\{PROJECT_NAME\}\}/g, projectName)
  );

  writeFileSync(join(projectPath, 'tsconfig.json'), TSCONFIG_TEMPLATE);
  writeFileSync(join(projectPath, 'src/main.ts'), MAIN_TEMPLATE);
  writeFileSync(join(projectPath, 'src/agents/assistant.ts'), AGENT_TEMPLATE);

  writeFileSync(join(projectPath, '.gitignore'), `node_modules/\ndist/\n.env\n`);

  success(`Project created at ./${projectName}`);
  console.log('');
  info('Next steps:');
  console.log(`    cd ${projectName}`);
  console.log('    npm install');
  console.log('    kernova dev');
  console.log('');
}
