/**
 * Hello Kernova — First Working Example
 * 
 * This example demonstrates the complete flow:
 * 1. Create a kernel
 * 2. Register an agent (uses default LLM executor)
 * 3. Submit an intent
 * 4. Get a real response from an AI model
 * 
 * Prerequisites:
 *   Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable.
 * 
 * Run:
 *   npx tsx examples/hello-kernova.ts
 */

import { KernovaKernel, defineAgent } from '@kernova/core';

async function main() {
  // 1. Create the kernel
  const kernel = new KernovaKernel({
    environment: 'development',
    debug: true,
  });

  // 2. Define an agent (no custom execute = uses LLM automatically)
  const assistant = defineAgent({
    name: 'assistant',
    description: 'A helpful general-purpose assistant',
    capabilities: [
      { id: 'general', name: 'General', description: 'General knowledge and reasoning', confidence: 0.9 },
      { id: 'coding', name: 'Coding', description: 'Code generation and explanation', confidence: 0.8 },
    ],
    tools: [],
    instructions: `You are a helpful assistant powered by the Kernova Intelligent Systems Runtime.
You provide concise, accurate answers. When you don't know something, you say so.
Keep responses brief unless asked for detail.`,
  });

  // 3. Register the agent
  kernel.agentRegistry.register(assistant.definition, assistant.executor);

  // 4. Start the kernel
  await kernel.start();

  console.log('');
  console.log('Available providers:', kernel.getStatus().availableProviders);
  console.log('');

  // 5. Submit an intent
  console.log('═══════════════════════════════════════════');
  console.log('  Submitting intent to Kernova...');
  console.log('═══════════════════════════════════════════');
  console.log('');

  const result = await kernel.submit({
    goal: 'Explain what an intelligence runtime is in 2-3 sentences.',
    intentType: 'query',
    priority: 'medium',
  });

  // 6. Display result
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Intent Result');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log(`  Status:     ${result.intentStatus}`);
  console.log(`  Success:    ${result.result?.success}`);
  console.log(`  Duration:   ${result.result?.durationMs}ms`);
  console.log(`  Confidence: ${result.result?.evidence?.confidence}`);
  console.log('');
  console.log('  Response:');
  console.log('  ─────────');
  console.log(`  ${result.result?.summary}`);
  console.log('');

  // 7. Show usage stats
  const status = kernel.getStatus();
  console.log('  Usage:');
  console.log(`  Tokens: ${status.modelUsage.usage.totalTokens}`);
  console.log(`  Requests: ${status.modelUsage.requestCount}`);
  console.log('');

  // 8. Shut down
  await kernel.stop();
}

main().catch((error) => {
  console.error('Error:', error.message);
  console.error('');
  console.error('Make sure you have set OPENAI_API_KEY or ANTHROPIC_API_KEY');
  process.exit(1);
});
