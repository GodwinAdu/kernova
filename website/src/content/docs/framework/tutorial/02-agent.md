---
title: "Step 2: Define Your Agent"
description: "Create a support agent with custom instructions and personality."
---

# Step 2: Define Your Agent

The default `assistant.agent.ts` is generic. Let's replace it with a purpose-built support agent.

## Replace the Default Agent

Open `agents/assistant.agent.ts` and replace its contents with:

```typescript
// agents/support.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  description: 'Handles customer support inquiries for Acme Inc.',
  model: 'gpt-4o',
  instructions: `
    You are a customer support agent for Acme Inc., a project management software company.

    RULES:
    - Always be polite, concise, and helpful
    - Search the knowledge base BEFORE answering questions about the product
    - If you don't know the answer, say so honestly and offer to create a support ticket
    - Never make up features or pricing that isn't in the knowledge base
    - For billing questions, direct users to billing@acme.com
    - For urgent issues, offer to escalate by creating a ticket with priority "high"

    PERSONALITY:
    - Friendly but professional
    - Use short paragraphs
    - Include relevant links when available
  `,
  tools: ['search-kb', 'create-ticket'],
  memory: {
    type: 'conversational',
    ttl: '7d',
  },
  temperature: 0.3, // Lower = more consistent/factual responses
});
```

**Important:** Rename the file from `assistant.agent.ts` to `support.agent.ts`:

```bash
# On Windows:
move agents\assistant.agent.ts agents\support.agent.ts

# On Mac/Linux:
mv agents/assistant.agent.ts agents/support.agent.ts
```

This changes the endpoint from `/api/agents/assistant` to `/api/agents/support`.

## What Each Field Does

Let's break down what we defined:

### `instructions`
This is the system prompt — the personality and rules for your agent. Write it like you're training a new employee. Be specific about what they should and shouldn't do.

### `tools: ['search-kb', 'create-ticket']`
These are the tools the agent can call. We haven't created them yet (next step), but by declaring them here, the LLM knows they exist and will request to use them when appropriate.

### `memory: { type: 'conversational', ttl: '7d' }`
The agent remembers conversations for 7 days. If a user comes back tomorrow, the agent recalls what they discussed yesterday.

### `temperature: 0.3`
Lower temperature means more predictable outputs. For a support bot, you want consistency — not creative improvisation.

## Update the Chat Page

Since we renamed the agent from `assistant` to `support`, update the chat page to use the new name.

Open `app/chat/page.tsx` and change:

```typescript
// Before:
const { messages, send, isStreaming, streamingContent } = useAgentStream('assistant');

// After:
const { messages, send, isStreaming, streamingContent } = useAgentStream('support');
```

## Test It

If your dev server is still running, it will auto-reload. If not:

```bash
kernova dev
```

Go to [http://localhost:3000/chat](http://localhost:3000/chat) and try:

```
How do I reset my password?
```

The agent should respond but might say something generic — because we haven't given it a knowledge base yet. It's following the instructions: it wants to search the KB, but the tool doesn't exist yet, so it'll do its best without it.

You might see an error about the tool not being found. That's expected — we'll create the tools in the next step.

## What You Learned

- Agents are defined in `agents/*.agent.ts` files
- The filename determines the API route
- `instructions` is the most important field — it shapes the agent's behavior
- `tools` declares what the agent can use (we'll build them next)
- `memory` gives the agent conversation persistence

---

[Continue to Step 3: Build Custom Tools →](/framework/tutorial/03-tools)
