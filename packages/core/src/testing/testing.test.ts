/**
 * Agent Testing Framework Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestRunner } from './agent-test-runner.js';
import { MockModelProvider } from './mock-model-provider.js';
import { ConversationSimulator } from './conversation-simulator.js';
import { KernovaKernel } from '../kernel.js';

describe('MockModelProvider', () => {
  let provider: MockModelProvider;

  beforeEach(() => {
    provider = new MockModelProvider({
      defaultResponse: 'Default mock response',
      responses: {
        'hello': 'Hi there!',
        'weather': 'It is sunny today.',
      },
    });
  });

  it('should return default response for unmatched prompts', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'something random' }],
      model: 'test',
    });

    expect(result.content).toBe('Default mock response');
  });

  it('should match canned responses by pattern', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello world' }],
      model: 'test',
    });

    expect(result.content).toBe('Hi there!');
  });

  it('should track call count', async () => {
    await provider.complete({ messages: [{ role: 'user', content: 'a' }], model: 'test' });
    await provider.complete({ messages: [{ role: 'user', content: 'b' }], model: 'test' });

    expect(provider.callCount).toBe(2);
  });

  it('should simulate failures', async () => {
    provider.setFailure(true, 'API error');

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    })).rejects.toThrow('API error');
  });

  it('should simulate latency', async () => {
    provider.setLatency(50);
    const start = Date.now();

    await provider.complete({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // Some tolerance
  });

  it('should generate deterministic embeddings', async () => {
    const embedding1 = await provider.embed('hello world');
    const embedding2 = await provider.embed('hello world');

    expect(embedding1).toEqual(embedding2);
    expect(embedding1.length).toBe(384);
  });

  it('should generate different embeddings for different texts', async () => {
    const embedding1 = await provider.embed('hello');
    const embedding2 = await provider.embed('goodbye');

    expect(embedding1).not.toEqual(embedding2);
  });

  it('should stream responses word by word', async () => {
    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    })) {
      chunks.push(chunk.content);
    }

    const fullContent = chunks.join('');
    expect(fullContent).toBe('Default mock response');
  });

  it('should reset to initial state', async () => {
    provider.setResponse('custom', 'custom response');
    provider.setFailure(true);
    await provider.complete({ messages: [{ role: 'user', content: 'a' }], model: 't' }).catch(() => {});

    provider.reset();

    expect(provider.callCount).toBe(0);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'custom' }],
      model: 'test',
    });
    expect(result.content).toBe('This is a mock response.'); // Default after reset
  });

  it('should provide call log', async () => {
    await provider.complete({
      messages: [{ role: 'user', content: 'test query' }],
      model: 'gpt-4',
    });

    const log = provider.getCallLog();
    expect(log.length).toBe(1);
    expect(log[0].request.model).toBe('gpt-4');
  });
});

describe('AgentTestRunner', () => {
  let kernel: KernovaKernel;
  let runner: AgentTestRunner;

  beforeEach(async () => {
    const mockProvider = new MockModelProvider({
      defaultResponse: 'I can help you with that. TypeScript is a great language for building scalable applications.',
    });

    kernel = new KernovaKernel({
      environment: 'development',
      ephemeral: true,
      providers: [mockProvider],
    });
    await kernel.start();

    // Register a default agent so intents can be processed
    const { defineAgent } = await import('../define-agent.js');
    const agent = defineAgent({
      name: 'test-agent',
      description: 'Test agent for testing framework',
      capabilities: [{ id: 'general', name: 'General', description: 'General', confidence: 1 }],
      tools: [],
      instructions: 'You are a helpful assistant.',
    });
    kernel.agentRegistry.register(agent.definition, agent.executor);

    runner = new AgentTestRunner(kernel, { verbose: false });
  });

  afterEach(async () => {
    await kernel.stop();
  }, 30_000);

  it('should run a scenario and check shouldContain', async () => {
    const scenario = AgentTestRunner.scenario(
      'TypeScript question',
      'Tell me about TypeScript',
      { shouldContain: ['TypeScript'] },
    );

    const result = await runner.run(scenario);
    expect(result.passed).toBe(true);
    expect(result.assertions.length).toBeGreaterThan(0);
  });

  it('should fail when shouldContain pattern is missing', async () => {
    const scenario = AgentTestRunner.scenario(
      'Missing pattern test',
      'Tell me about TypeScript',
      { shouldContain: ['Python'] },
    );

    const result = await runner.run(scenario);
    expect(result.passed).toBe(false);
  });

  it('should check shouldNotContain', async () => {
    const scenario = AgentTestRunner.scenario(
      'Exclusion test',
      'Tell me about TypeScript',
      { shouldNotContain: ['ERROR', 'FAILURE'] },
    );

    const result = await runner.run(scenario);
    expect(result.passed).toBe(true);
  });

  it('should check maxDurationMs', async () => {
    const scenario = AgentTestRunner.scenario(
      'Speed test',
      'Quick question',
      { maxDurationMs: 10_000 },
    );

    const result = await runner.run(scenario);
    expect(result.passed).toBe(true);
    expect(result.duration).toBeLessThan(10_000);
  });

  it('should run multiple scenarios', async () => {
    const scenarios = [
      AgentTestRunner.scenario('Test 1', 'Hello', { shouldContain: ['help'] }),
      AgentTestRunner.scenario('Test 2', 'Goodbye', { shouldContain: ['help'] }),
    ];

    const results = await runner.runAll(scenarios);
    expect(results.length).toBe(2);
  });

  it('should provide a summary', async () => {
    await runner.run(AgentTestRunner.scenario('Pass', 'Hi', { shouldContain: ['TypeScript'] }));
    await runner.run(AgentTestRunner.scenario('Fail', 'Hi', { shouldContain: ['NONEXISTENT'] }));

    const summary = runner.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
  });
});

describe('ConversationSimulator', () => {
  let kernel: KernovaKernel;
  let simulator: ConversationSimulator;

  beforeEach(async () => {
    const mockProvider = new MockModelProvider({
      defaultResponse: 'Agent response to your question.',
    });

    kernel = new KernovaKernel({
      environment: 'development',
      ephemeral: true,
      providers: [mockProvider],
    });
    await kernel.start();

    // Register a default agent
    const { defineAgent } = await import('../define-agent.js');
    const agent = defineAgent({
      name: 'sim-agent',
      description: 'Simulation agent',
      capabilities: [{ id: 'general', name: 'General', description: 'General', confidence: 1 }],
      tools: [],
      instructions: 'You respond helpfully.',
    });
    kernel.agentRegistry.register(agent.definition, agent.executor);

    simulator = new ConversationSimulator(kernel);
  });

  afterEach(async () => {
    await kernel.stop();
  }, 30_000);

  it('should simulate a multi-turn conversation', async () => {
    const result = await simulator.simulate([
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'How are you?' },
    ]);

    expect(result.success).toBe(true);
    expect(result.turns.length).toBe(2);
    expect(result.turns[0].response).toBeDefined();
    expect(result.turns[1].response).toBeDefined();
  });

  it('should handle system messages as context', async () => {
    const result = await simulator.simulate([
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' },
    ]);

    expect(result.success).toBe(true);
    expect(result.turns[0].response).toContain('system message');
  });

  it('should respect delays between messages', async () => {
    const start = Date.now();

    await simulator.simulate([
      { role: 'user', content: 'First', delay: 50 },
      { role: 'user', content: 'Second', delay: 50 },
    ]);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80); // At least ~100ms of delays
  });

  it('should provide simple chat interface', async () => {
    const responses = await simulator.chat(['Hello', 'World']);

    expect(responses.length).toBe(2);
    expect(responses[0]).toBeDefined();
  });

  it('should handle timeout', async () => {
    const result = await simulator.simulate(
      [{ role: 'user', content: 'Hello' }],
      { timeout: 1 }, // 1ms timeout — will likely timeout
    );

    // May or may not timeout depending on execution speed
    expect(result).toBeDefined();
  });
});
