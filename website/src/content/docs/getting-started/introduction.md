---
title: What is Kernova?
description: Understand what Kernova is, who it's for, and how it works.
---

# What is Kernova?

Kernova is a **runtime for intelligent software**. It provides the infrastructure layer between your application and AI models — handling memory, tool execution, agent orchestration, events, security, and cost control so you can focus on building your actual product.

## Who is it for?

- **Developers building AI-powered applications** who don't want to spend months on infrastructure
- **Teams that need production-ready AI** with auth, budgets, audit trails, and observability
- **Anyone using LLMs** who wants structured, testable, governable AI behavior (not just chat)

## What does it actually do?

Think of Kernova as providing **7 things** you'd otherwise build yourself:

### 1. Agents (not just prompts)

Instead of raw API calls to OpenAI, you define agents with instructions, capabilities, and tools:

```typescript
app.agent('code-reviewer', {
  instructions: 'Review code for security issues. Be specific about line numbers.',
});
```

Agents are not chat wrappers — they're capability-bearing entities that can use tools, access memory, and delegate to other agents.

### 2. Memory (that persists)

Your AI remembers things across sessions. Five layers from "current task" to "company knowledge":

```typescript
await app.remember('This project uses PostgreSQL and TypeScript', 'longterm');

// Later (even days later) — the agent knows this
const { answer } = await app.ask('What database should I use for this feature?');
// → "Since your project uses PostgreSQL, I'd suggest..."
```

### 3. Tools (that agents use autonomously)

Give your agent functions it can call. The AI decides when to use them:

```typescript
app.tool('get_user', {
  description: 'Look up a user by their email address',
  parameters: { type: 'object', properties: { email: { type: 'string' } } },
  execute: async ({ email }) => db.users.findByEmail(email),
});

// Agent automatically calls get_user when needed
const { answer } = await app.ask('What plan is alice@company.com on?');
```

### 4. Events (everything is tracked)

Every action emits a structured event. You always know what happened, when, and why:

```typescript
kernel.events.subscribe(['intent.*'], (event) => {
  // intent.created, intent.executing, intent.completed, intent.failed
  console.log(event.eventType, event.data);
});
```

Events persist to SQLite. Query them, build dashboards, create audit logs.

### 5. Identity & Auth (production-ready)

API keys, role-based permissions, organizations — not bolted on later, built in from day one:

```typescript
const { plaintext } = kernel.identity.createApiKey({
  name: 'production',
  ownerId: userId,
  permissions: ['intent:submit', 'memory:read'],
});
```

### 6. Budget Control (no surprise bills)

Set token limits, cost caps, and rate limits. The runtime enforces them:

```typescript
kernel.budget.setGlobalBudget({ maxTokens: 1_000_000, maxCostUsd: 50.00 });
// If an agent tries to exceed this → request rejected with clear error
```

### 7. Multi-Agent (agents that collaborate)

Agents can delegate tasks to specialized agents:

```typescript
const research = await tools.delegate('researcher', 'Find recent papers on RAG');
const summary = await tools.delegate('writer', `Summarize: ${research.response}`);
```

## How does it work under the hood?

```
Your App → submits an Intent (structured goal)
    ↓
Kernova Kernel → checks permissions, checks budget
    ↓
Agent Registry → selects the best agent for the job
    ↓
Agent → reasons with LLM, calls tools, accesses memory
    ↓
Result → returned with evidence trail
    ↓
Events → every step recorded in SQLite
```

Every interaction follows this flow. It's predictable, auditable, and debuggable.

## What model providers does it support?

Kernova is **model-agnostic**. Set an environment variable and it works:

- OpenAI (GPT-4o, GPT-4o-mini)
- Anthropic (Claude 3.5 Sonnet, Opus, Haiku)
- Google Gemini (2.0 Flash, 1.5 Pro)
- DeepSeek, Groq, Mistral, Cohere, xAI/Grok
- Together AI, OpenRouter, Fireworks, Perplexity
- Ollama, LM Studio (local, no API key needed)
- Any OpenAI-compatible API (via config)

Switch providers by changing one environment variable. Your code doesn't change.

## What's the developer experience like?

```bash
# Create a project
Kernova init my-app && cd my-app && npm install

# Start development (hot-reload + web dashboard)
Kernova dev

# Edit src/agents/assistant.ts → auto-reloads
# Open http://localhost:4200 → see events, memory, agents live

# Deploy
Kernova deploy docker
docker build -t my-app . && docker run -p 4200:4200 my-app
```

## Next Steps

Ready? [Install Kernova →](/getting-started/installation/)

Want to understand the architecture? [Read the concepts →](/concepts/intents/)
