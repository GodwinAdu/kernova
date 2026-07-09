---
title: Testing Your Agents
description: How to write tests for Nexus agents, tools, and workflows.
---

# Testing Your Agents

Nexus is designed to be testable. Here's how to test each component.

## Setup

Use Vitest (recommended) or any test runner:

```bash
npm install -D vitest
```

## Testing Agents

Create a kernel in ephemeral mode (no persistence) for fast, isolated tests:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { NexusKernel, defineAgent } from '@kernova/core';

describe('My Agent', () => {
  let kernel: NexusKernel;

  afterEach(async () => { await kernel.stop(); });

  it('should process intents correctly', async () => {
    kernel = new NexusKernel({ environment: 'development', ephemeral: true });

    const agent = defineAgent({
      name: 'greeter',
      description: 'Greets people',
      capabilities: [{ id: 'greet', name: 'Greet', description: 'Greet', confidence: 1 }],
      tools: [],
      instructions: '',
      async execute(intent) {
        return {
          success: true,
          summary: `Hello! You said: ${intent.goal}`,
          evidence: { sources: [], confidence: 1 },
          durationMs: 0,
        };
      },
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);
    await kernel.start();

    const result = await kernel.submit({ goal: 'Hi there' });
    expect(result.result?.success).toBe(true);
    expect(result.result?.summary).toContain('Hi there');
  });
});
```

## Testing Tools

Test plugin tools in isolation:

```typescript
import { describe, it, expect } from 'vitest';

const calculateTool = {
  id: 'calculate',
  name: 'calculate',
  description: 'Math',
  parameters: {},
  execute: async (params: any) => ({
    result: eval(params.expression), // simplified for testing
  }),
};

describe('Calculate Tool', () => {
  it('should add numbers', async () => {
    const result = await calculateTool.execute({ expression: '2 + 3' });
    expect(result.result).toBe(5);
  });
});
```

## Testing with Memory

```typescript
it('should remember and recall', async () => {
  kernel = new NexusKernel({ environment: 'development', ephemeral: true });
  await kernel.start();

  await kernel.memoryEngine.store({
    content: 'The secret is 42',
    layer: 'session',
    owner: 'system',
  });

  const results = await kernel.memoryEngine.query({ query: 'secret' });
  expect(results[0].content).toContain('42');
});
```

## Testing Delegation

```typescript
it('should delegate between agents', async () => {
  kernel = new NexusKernel({ environment: 'development', ephemeral: true });

  const helper = defineAgent({
    name: 'helper',
    // ... returns specific response
  });

  const delegator = defineAgent({
    name: 'delegator',
    async execute(intent, context, tools) {
      const result = await tools.delegate('helper', intent.goal);
      return { success: result.success, summary: result.response, ... };
    },
  });

  kernel.agentRegistry.register(delegator.definition, delegator.executor);
  kernel.agentRegistry.register(helper.definition, helper.executor);
  await kernel.start();

  const result = await kernel.submit({ goal: 'test' });
  expect(result.result?.success).toBe(true);
});
```

## Testing Budget Enforcement

```typescript
it('should reject when over budget', async () => {
  kernel = new NexusKernel({ environment: 'development', ephemeral: true });
  kernel.budget.setGlobalBudget({ maxTokens: 100 });
  kernel.budget.record('system', 101); // Exhaust budget

  // ... register agent, start kernel ...

  await expect(kernel.submit({ goal: 'test' }))
    .rejects.toThrow('Budget exceeded');
});
```

## Key Testing Tips

1. **Always use `ephemeral: true`** — No SQLite files cluttering your test directory
2. **Use `afterEach` to stop the kernel** — Prevents resource leaks
3. **Test agents with custom `execute`** — Don't rely on real LLM calls in unit tests
4. **Test the pipeline, not the LLM** — Verify your logic, not the model's output
5. **Use `kernel.events.query()`** — Assert that correct events were emitted
