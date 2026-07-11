/**
 * Integration Tests
 * 
 * Tests the full pipeline: init kernel → register agent + tools → submit intent
 * → agent uses tools → returns result with evidence → events persisted → memory stored
 */

import { describe, it, expect, afterEach } from 'vitest';
import { KernovaKernel, defineAgent } from '../index.js';
import type { NexusPlugin } from '../plugins/plugin-registry.js';

describe('Full Pipeline Integration', () => {
  let kernel: KernovaKernel;

  afterEach(async () => {
    if (kernel) await kernel.stop();
  });

  it('should process an intent through agent with tools, memory, and events', async () => {
    // 1. Create kernel
    kernel = new KernovaKernel({ environment: 'development', ephemeral: true });

    // 2. Register a tool plugin
    const mathPlugin: NexusPlugin = {
      id: 'math',
      name: 'Math',
      version: '1.0.0',
      type: 'tool',
      tools: [{
        id: 'add',
        name: 'add',
        description: 'Add two numbers',
        parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        execute: async (params) => ({ result: (params.a as number) + (params.b as number) }),
      }],
    };
    await kernel.plugins.register(mathPlugin);

    // 3. Register an agent that uses tools and memory
    const agent = defineAgent({
      name: 'calculator',
      description: 'Does math and remembers results',
      capabilities: [{ id: 'math', name: 'Math', description: 'Math', confidence: 1 }],
      tools: [],
      instructions: 'You do math.',
      async execute(intent, context, tools) {
        // Use a tool
        const result = await tools.useTool('math:add', { a: 10, b: 32 });

        // Store in memory
        await tools.remember(`Calculated: ${JSON.stringify(result)}`, 'session');

        // Emit custom event
        tools.emit('calculation.done', { result });

        return {
          success: true,
          summary: `10 + 32 = ${(result as any).result}`,
          evidence: {
            sources: [{ type: 'memory' as const, ref: 'math:add', label: 'Math tool', consultedAt: new Date().toISOString() }],
            confidence: 1.0,
            reasoning: 'Used math:add tool',
          },
          durationMs: 5,
        };
      },
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);

    // 4. Start kernel
    await kernel.start();

    // 5. Submit intent
    const intent = await kernel.submit({
      goal: 'Calculate 10 + 32',
      intentType: 'action',
      priority: 'medium',
    });

    // 6. Verify result
    expect(intent.intentStatus).toBe('completed');
    expect(intent.result?.success).toBe(true);
    expect(intent.result?.summary).toBe('10 + 32 = 42');
    expect(intent.result?.evidence?.confidence).toBe(1.0);

    // 7. Verify events were emitted
    const events = kernel.events.query({ type: 'intent.*' });
    expect(events.length).toBeGreaterThan(0);
    const completedEvent = events.find(e => e.eventType === 'intent.completed');
    expect(completedEvent).toBeDefined();

    // 8. Verify tool execution event
    const toolEvents = kernel.events.query({ type: 'tool.*' });
    expect(toolEvents.length).toBeGreaterThan(0);

    // 9. Verify memory was stored
    const memories = await kernel.memoryEngine.query({ layers: ['session'] });
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].content).toContain('Calculated');
  });

  it('should enforce budget limits', async () => {
    kernel = new KernovaKernel({ environment: 'development', ephemeral: true });

    // Record usage to exhaust budget, then check
    kernel.budget.setGlobalBudget({ maxTokens: 100 });
    kernel.budget.record('system', 101); // Exceed the budget

    const agent = defineAgent({
      name: 'blocked', description: 'Will be blocked', capabilities: [], tools: [], instructions: '',
      async execute() { return { success: true, summary: 'OK', evidence: { sources: [], confidence: 1 }, durationMs: 0 }; },
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);
    await kernel.start();

    // Should throw because budget is exhausted
    await expect(kernel.submit({ goal: 'test' })).rejects.toThrow('Budget exceeded');
  });

  it('should track multiple agents and events correctly', async () => {
    kernel = new KernovaKernel({ environment: 'development', ephemeral: true });

    const a1 = defineAgent({
      name: 'agent-a', description: 'A', capabilities: [{ id: 'a', name: 'A', description: 'A', confidence: 1 }],
      tools: [], instructions: '',
      async execute(intent) { return { success: true, summary: `A: ${intent.goal}`, evidence: { sources: [], confidence: 1 }, durationMs: 1 }; },
    });
    const a2 = defineAgent({
      name: 'agent-b', description: 'B', capabilities: [{ id: 'b', name: 'B', description: 'B', confidence: 1 }],
      tools: [], instructions: '',
      async execute(intent) { return { success: true, summary: `B: ${intent.goal}`, evidence: { sources: [], confidence: 1 }, durationMs: 1 }; },
    });

    kernel.agentRegistry.register(a1.definition, a1.executor);
    kernel.agentRegistry.register(a2.definition, a2.executor);
    await kernel.start();

    const status = kernel.getStatus();
    expect(status.registeredAgents).toBe(2);
    expect(status.running).toBe(true);

    const r1 = await kernel.submit({ goal: 'first' });
    const r2 = await kernel.submit({ goal: 'second' });

    expect(r1.result?.success).toBe(true);
    expect(r2.result?.success).toBe(true);

    // Events should have multiple intents
    const allEvents = kernel.events.query({ category: 'intent' });
    expect(allEvents.length).toBeGreaterThanOrEqual(8); // 4 events per intent minimum
  });

  it('should support recall of stored memories within agents', async () => {
    kernel = new KernovaKernel({ environment: 'development', ephemeral: true });

    // Pre-store some memory
    await kernel.start();
    await kernel.memoryEngine.store({
      content: 'The secret code is 42',
      layer: 'session',
      owner: 'system',
    });

    const agent = defineAgent({
      name: 'recaller', description: 'Recalls', capabilities: [{ id: 'r', name: 'R', description: 'R', confidence: 1 }],
      tools: [], instructions: '',
      async execute(intent, context, tools) {
        const memories = await tools.recall('secret code');
        const found = memories.length > 0 ? memories[0] : 'nothing found';
        return { success: true, summary: `Recalled: ${found}`, evidence: { sources: [], confidence: 1 }, durationMs: 1 };
      },
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);

    const result = await kernel.submit({ goal: 'What is the secret code?' });
    expect(result.result?.success).toBe(true);
    expect(result.result?.summary).toContain('42');
  });

  it('should execute a full delegation pipeline with memory', async () => {
    kernel = new KernovaKernel({ environment: 'development', ephemeral: true });

    const researcher = defineAgent({
      name: 'researcher', description: 'Researches', capabilities: [{ id: 'res', name: 'Res', description: 'Res', confidence: 1 }],
      tools: [], instructions: '',
      async execute(intent, context, tools) {
        await tools.remember(`Research finding: ${intent.goal}`, 'session');
        return { success: true, summary: `Found: answer to ${intent.goal}`, evidence: { sources: [], confidence: 0.9 }, durationMs: 2 };
      },
    });

    const coordinator = defineAgent({
      name: 'coordinator', description: 'Coordinates', capabilities: [{ id: 'coord', name: 'Coord', description: 'Coord', confidence: 1 }],
      tools: [], instructions: '',
      async execute(intent, context, tools) {
        // Delegate to researcher
        const research = await tools.delegate('researcher', intent.goal);
        // Recall what was stored
        const memories = await tools.recall('Research finding');
        const memoryContent = memories.length > 0 ? memories[0] : 'no memory';
        return {
          success: research.success,
          summary: `Coordinated: ${research.response} | Memory: ${memoryContent}`,
          evidence: { sources: [], confidence: 0.9 },
          durationMs: research.durationMs,
        };
      },
    });

    // Coordinator first so it's selected for the intent
    kernel.agentRegistry.register(coordinator.definition, coordinator.executor);
    kernel.agentRegistry.register(researcher.definition, researcher.executor);
    await kernel.start();

    const result = await kernel.submit({ goal: 'quantum physics' });
    expect(result.result?.success).toBe(true);
    expect(result.result?.summary).toContain('Found: answer to quantum physics');
    expect(result.result?.summary).toContain('Research finding');
  });
});
