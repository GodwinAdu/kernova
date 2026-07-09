# @nexus/sdk

High-level SDK for building intelligent applications with Nexus.

## Installation

```bash
npm install @nexus/sdk
```

## Quick Start

```typescript
import { Nexus } from '@nexus/sdk';

const app = await Nexus.create();

app.agent('assistant', { instructions: 'You are helpful and concise.' });

app.tool('search', {
  description: 'Search for information',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  execute: async ({ query }) => `Results for: ${query}`,
});

const result = await app.ask('What is the capital of France?');
console.log(result.answer);

await app.close();
```

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` environment variable.
