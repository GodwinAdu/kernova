---
title: Your First Agent
description: Build a custom agent with tools and memory.
---

# Your First Agent

## Basic Agent

```typescript
app.agent('writer', {
  instructions: `You are a professional technical writer.
Write clear, concise documentation. Use examples.`,
});

const { answer } = await app.ask('Write docs for a login() function');
```

## Agent with Custom Logic

```typescript
import { defineAgent } from '@nexus/core';

const reviewer = defineAgent({
  name: 'code-reviewer',
  description: 'Reviews code for bugs',
  capabilities: [{ id: 'review', name: 'Code Review', description: 'Reviews code', confidence: 0.9 }],
  tools: [],
  instructions: 'You review code for security, performance, and logic errors.',
  async execute(intent, context, tools) {
    const analysis = await tools.completeWithTools(intent.goal);
    await tools.remember(`Review: ${analysis.slice(0, 200)}`, 'session');
    return {
      success: true,
      summary: analysis,
      evidence: { sources: [], confidence: 0.85, reasoning: 'LLM analysis' },
      durationMs: 0,
    };
  },
});
```

## Agent with Delegation

```typescript
app.agent('researcher', { instructions: 'You research topics thoroughly.' });
app.agent('editor', {
  instructions: 'You coordinate research and writing.',
  async execute(intent, context, tools) {
    const research = await tools.delegate('researcher', intent.goal);
    const article = await tools.complete(`Write about: ${research.response}`);
    return { success: true, summary: article, evidence: { sources: [], confidence: 0.9 }, durationMs: 0 };
  },
});
```

## File-Based Agents (CLI)

Save as `src/agents/assistant.ts` — hot-reloads automatically with `nexus dev`.

```typescript
import { defineAgent } from '@nexus/core';
export default defineAgent({
  name: 'assistant',
  description: 'General-purpose assistant',
  capabilities: [{ id: 'general', name: 'General', description: 'General help', confidence: 0.9 }],
  tools: [],
  instructions: 'You are helpful and concise.',
});
```
