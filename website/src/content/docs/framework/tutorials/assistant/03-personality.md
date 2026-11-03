---
title: "Step 2: Define Nova's Personality"
description: "Give your assistant a name, personality, and behavioral rules."
---

# Step 2: Define Nova's Personality

The default agent is generic — "a helpful AI assistant." Let's give it a real personality.

## Why Personality Matters

Without specific instructions, every AI agent sounds the same — bland and corporate. But with good instructions, you can create:

- A friendly coding buddy
- A formal business analyst
- A casual friend who uses emojis
- A teacher who explains step-by-step

The **instructions** field is the most important part of any agent. It's not just a system prompt — it's the agent's personality, rules, and behavior guide.

## Rewrite the Agent

Open `agents/assistant.agent.ts` and replace it entirely:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Nova',
  description: 'A personal AI assistant that remembers you',
  model: 'gpt-4o',
  
  instructions: `
    Your name is Nova. You are a personal AI assistant.

    PERSONALITY:
    - Warm, friendly, and genuinely helpful
    - You speak concisely — no walls of text unless asked for detail
    - You use a conversational tone, not formal or robotic
    - You occasionally use gentle humor when appropriate
    - You address the user by name once you know it

    MEMORY RULES:
    - When the user tells you their name, preferences, or facts about themselves, REMEMBER them
    - Reference past conversations naturally: "Last time you mentioned you're working on..."
    - Don't repeat back everything you remember — use it naturally in context
    - If you're not sure about something you think you remember, ask to confirm

    BEHAVIOR:
    - If asked about current events, news, or factual questions → search the web
    - If the question is about the user's preferences → check your memory first
    - If unsure what the user wants → ask a clarifying question
    - Always be honest when you don't know something

    WHAT YOU CAN DO:
    - Answer questions on any topic
    - Search the web for current information
    - Remember user preferences and context
    - Help with planning, writing, coding, and analysis
    - Provide recommendations based on what you know about the user
  `,

  tools: ['web-search'],
  
  memory: {
    type: 'persistent',   // Memories survive across sessions
    ttl: '90d',           // Remember for 90 days
  },

  temperature: 0.7,      // Balanced between creative and precise
  maxTokens: 2048,       // Allow reasonably long responses
});
```

## Understanding Each Field

Let's break down what each part does:

### `name: 'Nova'`
This is the display name — used in logs and the dashboard. It doesn't affect the AI's behavior (that's the instructions).

### `model: 'gpt-4o'`
Which AI model to use. Options include:
- `gpt-4o` — Best for general use (recommended)
- `gpt-4o-mini` — Faster and cheaper, slightly less capable
- `claude-sonnet-5-5` — If you have an Anthropic key

### `instructions`
This is the **system prompt**. It shapes everything about how the agent behaves. Tips for writing good instructions:

1. **Give it a name and role** — "You are Nova, a personal assistant"
2. **Define personality** — How does it speak? Formal? Casual?
3. **Set rules** — What should it always/never do?
4. **List capabilities** — What can it help with?
5. **Handle edge cases** — What if it doesn't know? What if it's unsure?

### `tools: ['web-search']`
Which tools the agent can call. The name matches the `name` field in `agents/tools/web-search.ts`. The agent decides when to use tools based on the context.

### `memory: { type: 'persistent', ttl: '90d' }`
- `persistent` — Memories are stored to disk and survive restarts
- `ttl: '90d'` — Each memory expires after 90 days of not being accessed

### `temperature: 0.7`
Controls randomness:
- `0.0` — Always the same answer (deterministic)
- `0.7` — Balanced (good default for assistants)
- `1.0` — More creative/varied (good for writing)

## Test the New Personality

If `kernova dev` is still running, it will auto-reload. If not, start it:

```bash
kernova dev
```

Open the chat and try:

1. **"Hi, my name is Alex"**
   - Nova should respond warmly and acknowledge your name

2. **"What's the latest news about AI?"**  
   - Nova should use the web-search tool to find current info

3. **"I prefer TypeScript over Python"**
   - Nova stores this as a preference

4. **"What programming language should I use for my next project?"**
   - Nova should consider your TypeScript preference in its answer

## What's Different Now

Compare the default agent ("I'm here to help you with any questions") vs Nova ("Hi Alex! Since you prefer TypeScript, I'd suggest..."). The difference is all in the instructions — same model, completely different experience.

---

[Continue to Step 3: Add Persistent Memory →](/framework/tutorials/assistant/04-memory)
