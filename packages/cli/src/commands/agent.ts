/**
 * nexus agent
 * 
 * Agent management commands:
 *   nexus agent create <name>
 *   nexus agent list
 *   nexus agent inspect <name>
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { success, info, error } from '../ui.js';

const AGENT_TEMPLATE = (name: string) => `import { defineAgent } from '@nexus/core';

/**
 * ${name} Agent
 */
export default defineAgent({
  name: '${name}',
  description: 'A ${name} agent',
  capabilities: [
    {
      id: '${name}-default',
      name: '${name}',
      description: 'Default capability for ${name}',
      confidence: 0.8,
    },
  ],
  tools: [],
  instructions: \`
    You are the ${name} agent in the Nexus runtime.
    Define your behavior here.
  \`,

  async execute(intent, context, tools) {
    tools.log(\`[${name}] Processing: \${intent.goal}\`);

    // Implement your agent logic here
    return {
      success: true,
      summary: \`${name} processed: \${intent.goal}\`,
      evidence: {
        sources: [],
        confidence: 0.9,
        reasoning: 'Direct execution by ${name}',
      },
      durationMs: 0,
    };
  },
});
`;

export async function handleAgent(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'create':
      return createAgent(args[1]);
    case 'list':
      return listAgents();
    case 'inspect':
      return inspectAgent(args[1]);
    default:
      console.log('Usage: nexus agent <create|list|inspect> [name]');
      break;
  }
}

async function createAgent(name?: string): Promise<void> {
  if (!name) {
    error('Agent name required. Usage: nexus agent create <name>');
    process.exit(1);
  }

  const agentsDir = resolve(process.cwd(), 'src/agents');
  const agentPath = join(agentsDir, `${name}.ts`);

  if (existsSync(agentPath)) {
    error(`Agent "${name}" already exists at src/agents/${name}.ts`);
    process.exit(1);
  }

  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(agentPath, AGENT_TEMPLATE(name));

  success(`Agent "${name}" created at src/agents/${name}.ts`);
}

async function listAgents(): Promise<void> {
  const agentsDir = resolve(process.cwd(), 'src/agents');

  if (!existsSync(agentsDir)) {
    info('No agents directory found. Run "nexus agent create <name>" to create one.');
    return;
  }

  const files = readdirSync(agentsDir).filter(f => f.endsWith('.ts'));

  if (files.length === 0) {
    info('No agents found.');
    return;
  }

  console.log('');
  console.log('  Registered Agents:');
  console.log('  ──────────────────');
  for (const file of files) {
    const name = file.replace('.ts', '');
    console.log(`    ◆ ${name}`);
  }
  console.log('');
}

async function inspectAgent(name?: string): Promise<void> {
  if (!name) {
    error('Agent name required. Usage: nexus agent inspect <name>');
    process.exit(1);
  }

  const agentPath = resolve(process.cwd(), `src/agents/${name}.ts`);

  if (!existsSync(agentPath)) {
    error(`Agent "${name}" not found at src/agents/${name}.ts`);
    process.exit(1);
  }

  info(`Agent: ${name}`);
  info(`Path: src/agents/${name}.ts`);
  info(`Status: Defined (load with "nexus dev")`);
}
