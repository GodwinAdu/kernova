/**
 * Memory Persistence Example
 * 
 * Demonstrates the five-layer memory system with:
 * - Persistent storage (SQLite)
 * - Full-text search (FTS5)
 * - Memory decay
 * - Cross-layer queries
 * 
 * Run multiple times to see memories persist and accumulate.
 * 
 * Run:
 *   npx tsx examples/memory-persistence.ts
 */

import { NexusKernel, defineAgent } from '@nexus/core';

async function main() {
  const kernel = new NexusKernel({
    environment: 'development',
    debug: false,
    dataDir: './examples/data',
  });

  // Simple agent for demo
  const agent = defineAgent({
    name: 'memory-demo',
    description: 'Memory persistence demo',
    capabilities: [{ id: 'demo', name: 'Demo', description: 'Demo', confidence: 1 }],
    tools: [],
    instructions: '',
    async execute(intent, context, tools) {
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

  const memory = kernel.memoryEngine;
  console.log('');
  console.log('  Nexus Memory Engine — Persistence Demo');
  console.log('  ═══════════════════════════════════════');
  console.log('');

  // Show current stats
  const statsBefore = memory.getStats();
  console.log('  Memory stats (from previous runs):');
  console.log(`    Working:        ${statsBefore.working}`);
  console.log(`    Session:        ${statsBefore.session}`);
  console.log(`    Long-term:      ${statsBefore.longterm}`);
  console.log(`    Organizational: ${statsBefore.organizational}`);
  console.log(`    Global:         ${statsBefore.global}`);
  console.log('');

  // Store some memories in different layers
  await memory.store({
    content: `User ran memory demo at ${new Date().toLocaleTimeString()}`,
    layer: 'session',
    memoryType: 'experience',
    tags: ['demo', 'session'],
    owner: 'user_1',
  });

  await memory.store({
    content: 'The Nexus runtime uses TypeScript and SQLite for persistence',
    layer: 'longterm',
    memoryType: 'fact',
    tags: ['nexus', 'typescript', 'architecture'],
    owner: 'user_1',
    confidence: 0.95,
  });

  await memory.store({
    content: 'User prefers concise responses with code examples',
    layer: 'longterm',
    memoryType: 'preference',
    tags: ['preference', 'communication'],
    owner: 'user_1',
  });

  await memory.store({
    content: 'Company policy: all AI outputs must include evidence sources',
    layer: 'organizational',
    memoryType: 'procedure',
    tags: ['policy', 'governance', 'evidence'],
    owner: 'org_1',
    confidence: 1.0,
  });

  console.log('  ✓ Stored 4 new memories across layers');
  console.log('');

  // Full-text search
  console.log('  Full-text search: "TypeScript"');
  console.log('  ─────────────────────────────');
  const tsResults = await memory.query({ query: 'TypeScript', limit: 5 });
  for (const mem of tsResults) {
    console.log(`    [${mem.layer}] ${mem.content.slice(0, 70)}...`);
    console.log(`      relevance=${mem.relevance.toFixed(2)} confidence=${mem.confidence.toFixed(2)} accessed=${mem.accessCount}x`);
  }
  console.log('');

  // Search by keyword
  console.log('  Full-text search: "policy evidence"');
  console.log('  ─────────────────────────────');
  const policyResults = await memory.query({ query: 'policy evidence', limit: 5 });
  for (const mem of policyResults) {
    console.log(`    [${mem.layer}] ${mem.content.slice(0, 70)}`);
  }
  console.log('');

  // Query by layer
  console.log('  Long-term memories for user_1:');
  console.log('  ─────────────────────────────');
  const longTerm = await memory.query({ layers: ['longterm'], ownerId: 'user_1', limit: 10 });
  for (const mem of longTerm) {
    console.log(`    [${mem.memoryType}] ${mem.content.slice(0, 60)}`);
  }
  console.log('');

  // Apply decay
  const decayed = await memory.decay({ factor: 0.98, olderThanMs: 1000 });
  console.log(`  Applied decay: ${decayed} memories reduced in relevance`);
  console.log('');

  // Final stats
  const statsAfter = memory.getStats();
  console.log('  Final memory stats:');
  console.log(`    Working:        ${statsAfter.working}`);
  console.log(`    Session:        ${statsAfter.session}`);
  console.log(`    Long-term:      ${statsAfter.longterm}`);
  console.log(`    Organizational: ${statsAfter.organizational}`);
  console.log(`    Global:         ${statsAfter.global}`);
  console.log('');
  console.log('  Persistent: memories survive across restarts!');
  console.log('');

  await kernel.stop();
}

main().catch(console.error);
