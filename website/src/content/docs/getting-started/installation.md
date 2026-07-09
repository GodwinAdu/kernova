---
title: Installation
description: Install Nexus and set up your environment in 2 minutes.
---

# Installation

This guide gets you from zero to a working Nexus setup in under 2 minutes.

## Step 1: Install the SDK

```bash
npm install @nexus/sdk @nexus/types
```

This gives you everything needed to build intelligent applications.

**What's in the box:**
- `@nexus/sdk` — High-level API (`Nexus.create()`, `app.ask()`, `app.tool()`, etc.)
- `@nexus/types` — TypeScript type definitions

**Optional: Full runtime + CLI**
```bash
npm install @nexus/core @nexus/cli
```
- `@nexus/core` — The kernel (lower-level API for full control)
- `@nexus/cli` — Project scaffolding, dev server, deployment tools

## Step 2: Set an API key

Nexus needs at least one AI model provider. Pick whichever you prefer:

**OpenAI** (most popular)
```bash
export OPENAI_API_KEY=sk-proj-...
```

**Anthropic** (best for long-form reasoning)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**DeepSeek** (cheapest for most tasks)
```bash
export DEEPSEEK_API_KEY=sk-...
```

**Local with Ollama** (free, runs on your machine)
```bash
# Install Ollama from https://ollama.ai
ollama serve
ollama pull llama3.1
# No API key needed — Nexus detects Ollama automatically
```

You can set multiple keys. Nexus auto-detects all available providers and uses the first one as default. If one fails, it falls back to the next.

## Step 3: Verify it works

Create a file called `test.ts`:

```typescript
import { Nexus } from '@nexus/sdk';

async function main() {
  const app = await Nexus.create();
  
  app.agent('assistant', {
    instructions: 'You are a helpful assistant. Respond in one sentence.',
  });

  const { answer } = await app.ask('What is Nexus?');
  console.log(answer);
  
  await app.close();
}

main();
```

Run it:
```bash
npx tsx test.ts
```

If you see a response, you're ready to build.

## Troubleshooting

**"No model provider available"**
→ You haven't set an API key. Set `OPENAI_API_KEY` or any other provider key.

**"Module not found: @nexus/sdk"**
→ Run `npm install @nexus/sdk @nexus/types` in your project directory.

**"fetch is not defined"**
→ You need Node.js 18+. Check with `node --version`.

## What's next?

Now that you're set up, let's build something:

- [Quick Start →](/getting-started/quick-start/) — Build a working app in 5 minutes
- [Your First Agent →](/getting-started/first-agent/) — Create an agent with custom logic
