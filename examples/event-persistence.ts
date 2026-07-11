/**
 * Event Persistence Example
 * 
 * Demonstrates that events survive process restarts.
 * Run this script twice — the second run will see events from the first.
 * 
 * Run:
 *   npx tsx examples/event-persistence.ts
 */

import { KernovaKernel, defineAgent } from '@kernova/core';

async function main() {
  const kernel = new KernovaKernel({
    environment: 'development',
    debug: true,
    dataDir: './examples/data', // Store DB in examples directory for demo
    ephemeral: false, // Ensure persistence is enabled (default)
  });

  // Register a simple agent (no LLM needed for this demo)
  const agent = defineAgent({
    name: 'event-demo',
    description: 'Demonstrates event persistence',
    capabilities: [{ id: 'demo', name: 'Demo', description: 'Demo', confidence: 1 }],
    tools: [],
    instructions: '',
    async execute(intent, context, tools) {
      tools.log(`Processing: ${intent.goal}`);
      tools.emit('custom.happened', { note: 'This event will be persisted!' });
      return {
        success: true,
        summary: `Done: ${intent.goal}`,
        evidence: { sources: [], confidence: 1, reasoning: 'Demo' },
        durationMs: 0,
      };
    },
  });

  kernel.agentRegistry.register(agent.definition, agent.executor);
  await kernel.start();

  // Check how many events exist from previous runs
  const previousCount = kernel.events.count();
  console.log('');
  console.log(`  Events from previous runs: ${previousCount}`);
  console.log('');

  // Submit a new intent
  const result = await kernel.submit({
    goal: `Test event at ${new Date().toLocaleTimeString()}`,
    intentType: 'action',
  });

  console.log(`  Intent result: ${result.result?.summary}`);
  console.log('');

  // Query persisted events
  const allEvents = kernel.events.query({ limit: 10, order: 'desc' });
  console.log(`  Recent events (newest first):`);
  console.log('  ─────────────────────────────');
  for (const event of allEvents.slice(0, 5)) {
    console.log(`    ${event.timestamp.slice(11, 23)} │ ${event.eventType.padEnd(20)} │ ${JSON.stringify(event.data).slice(0, 50)}`);
  }
  console.log('');

  // Show timeline for this intent
  const timeline = kernel.events.getTimeline(result.id, 20);
  console.log(`  Timeline for intent ${result.id.slice(0, 20)}...`);
  console.log('  ─────────────────────────────');
  for (const event of timeline) {
    console.log(`    ${event.eventType}`);
  }
  console.log('');

  // Show stats
  const stats = kernel.events.getStats();
  if (stats) {
    console.log('  Event Store Stats:');
    console.log(`    Total events: ${stats.totalEvents}`);
    console.log(`    Database size: ${(stats.databaseSizeBytes / 1024).toFixed(1)} KB`);
    console.log(`    Categories: ${JSON.stringify(stats.byCategory)}`);
  }
  console.log('');

  // Graceful shutdown
  await kernel.stop();

  console.log('  Run this script again to see events persisted across restarts!');
  console.log('');
}

main().catch(console.error);
