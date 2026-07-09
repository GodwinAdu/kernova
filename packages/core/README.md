# @nexus/core

The Nexus Intelligent Systems Runtime kernel.

Provides: intent execution, agent orchestration, event persistence, five-layer memory, model routing, plugins, workflows, identity, budgets, streaming, and multi-agent coordination.

## Installation

```bash
npm install @nexus/core
```

## Quick Start

```typescript
import { NexusKernel, defineAgent } from '@nexus/core';

const kernel = new NexusKernel({ environment: 'development' });
const agent = defineAgent({
  name: 'assistant',
  instructions: 'You are helpful.',
  capabilities: [{ id: 'general', name: 'General', description: 'General', confidence: 0.9 }],
  tools: [],
});

kernel.agentRegistry.register(agent.definition, agent.executor);
await kernel.start();

const result = await kernel.submit({ goal: 'Hello!' });
console.log(result.result?.summary);

await kernel.stop();
```

For a simpler API, use `@nexus/sdk` instead.
