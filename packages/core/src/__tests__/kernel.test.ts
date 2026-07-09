/**
 * Nexus Kernel Tests
 * 
 * Tests the core runtime lifecycle and intent processing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NexusKernel } from '../kernel.js';
import { defineAgent } from '../define-agent.js';

describe('NexusKernel', () => {
  let kernel: NexusKernel;

  beforeEach(() => {
    kernel = new NexusKernel({
      environment: 'development',
      ephemeral: true,
    });
  });

  afterEach(async () => {
    await kernel.stop();
  });

  it('should start and stop cleanly', async () => {
    await kernel.start();
    expect(kernel.getStatus().running).toBe(true);

    await kernel.stop();
    expect(kernel.getStatus().running).toBe(false);
  });

  it('should report status correctly', async () => {
    await kernel.start();
    const status = kernel.getStatus();

    expect(status.environment).toBe('development');
    expect(status.activeIntents).toBe(0);
    expect(status.registeredAgents).toBe(0);
  });

  it('should reject intents when not started', async () => {
    await expect(kernel.submit({ goal: 'test' }))
      .rejects.toThrow('Kernel is not running');
  });

  it('should fail intent when no agent is registered', async () => {
    await kernel.start();
    const result = await kernel.submit({ goal: 'test' });

    expect(result.intentStatus).toBe('failed');
    expect(result.result?.success).toBe(false);
    expect(result.result?.summary).toContain('No suitable agent');
  });

  it('should process intent through registered agent', async () => {
    const agent = defineAgent({
      name: 'test-agent',
      description: 'Test',
      capabilities: [{ id: 'test', name: 'Test', description: 'Test', confidence: 1 }],
      tools: [],
      instructions: 'Test agent',
      async execute(intent, context, tools) {
        return {
          success: true,
          summary: `Done: ${intent.goal}`,
          evidence: { sources: [], confidence: 1, reasoning: 'Test' },
          durationMs: 0,
        };
      },
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);
    await kernel.start();

    const result = await kernel.submit({ goal: 'hello world' });

    expect(result.intentStatus).toBe('completed');
    expect(result.result?.success).toBe(true);
    expect(result.result?.summary).toBe('Done: hello world');
  });

  it('should handle agent execution errors gracefully', async () => {
    const agent = defineAgent({
      name: 'failing-agent',
      description: 'Fails',
      capabilities: [{ id: 'fail', name: 'Fail', description: 'Fails', confidence: 1 }],
      tools: [],
      instructions: '',
      async execute() {
        throw new Error('Something went wrong');
      },
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);
    await kernel.start();

    const result = await kernel.submit({ goal: 'trigger error' });

    expect(result.intentStatus).toBe('failed');
    expect(result.result?.success).toBe(false);
    expect(result.result?.summary).toContain('Something went wrong');
  });

  it('should track agent count', async () => {
    const agent1 = defineAgent({
      name: 'agent-1', description: 'A', capabilities: [], tools: [], instructions: '',
      async execute() { return { success: true, summary: '', evidence: { sources: [], confidence: 1 }, durationMs: 0 }; },
    });
    const agent2 = defineAgent({
      name: 'agent-2', description: 'B', capabilities: [], tools: [], instructions: '',
      async execute() { return { success: true, summary: '', evidence: { sources: [], confidence: 1 }, durationMs: 0 }; },
    });

    kernel.agentRegistry.register(agent1.definition, agent1.executor);
    kernel.agentRegistry.register(agent2.definition, agent2.executor);

    expect(kernel.getStatus().registeredAgents).toBe(2);
  });
});
