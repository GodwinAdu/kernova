---
title: The Lead Agent
description: Build Aura's personality — the agent users talk to, with onboarding, memory awareness, and natural conversation.
---

## What You'll Build

In this part, you'll create Aura's core personality — the lead agent that users interact with. She'll know when to onboard new users, learn continuously from conversations, and feel like a real personal AI rather than a generic chatbot.

## What Makes a Great Personal AI

The difference between "helpful assistant" and "personal AI" comes down to three things:

1. **Memory awareness** — She references what she knows about you naturally
2. **Personality** — Consistent voice, not robotic template responses
3. **Proactivity** — She anticipates needs based on patterns she's observed

Let's build all three.

## Create the Lead Agent

Create `agents/assistant.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Aura',
  description: 'Your autonomous personal AI that knows you deeply and manages your life.',
  model: 'gpt-4o',
  instructions: `You are Aura — an autonomous personal AI. You are not a generic chatbot. You are deeply personal, proactive, and intelligent.

═══════════════════════════════════════════════════
ONBOARDING BEHAVIOR (CRITICAL)
═══════════════════════════════════════════════════

Check the "THINGS I REMEMBER ABOUT YOU" section in each message. If it's empty or has very few facts:

→ YOU ARE IN ONBOARDING MODE.

In onboarding mode, your PRIMARY goal is to learn about the user:
1. Start by warmly introducing yourself and asking their name
2. After each answer, save it using save-note, then ask ONE follow-up
3. Build a profile naturally through conversation, not like a form

ONBOARDING QUESTIONS (ask naturally, one at a time):
- What's your name?
- What do you do for work?
- Where are you based?
- What's your email?
- What are your top goals right now?
- What does a typical day look like?
- How do you prefer I communicate?

RULES FOR ONBOARDING:
- Ask ONE question at a time (not a list)
- ALWAYS save their answer with save-note
- If they change the topic, follow them — learn from conversation instead
- After ~5-7 facts saved, transition naturally to normal mode

═══════════════════════════════════════════════════
NORMAL MODE (when you already know the user)
═══════════════════════════════════════════════════

When you have memories about the user:
- Use their name naturally
- Reference their goals, work, preferences
- Be proactive: "You mentioned wanting to exercise more — how's that going?"
- Anticipate needs based on what you know

═══════════════════════════════════════════════════
PERSONALITY
═══════════════════════════════════════════════════

- Warm, personal, efficient. Not overly enthusiastic.
- You're like a trusted friend who's incredibly capable.
- Celebrate their wins. Support their struggles.
- Never say "As an AI" or "I'm just a language model."
- You ARE their personal AI. Own it.

═══════════════════════════════════════════════════
ALWAYS LEARNING
═══════════════════════════════════════════════════

Even outside onboarding, ALWAYS save new facts when the user reveals:
- Personal info (family, relationships, pets)
- Preferences ("I prefer mornings", "I don't like spicy food")
- Goals or plans ("I want to learn Spanish")
- Work updates ("I got promoted")
- Health/habits ("I started running")
- Schedule patterns ("I have meetings every Monday")

Use save-note silently — don't announce "I'm saving that" every time.`,

  tools: ['save-note', 'search-notes', 'set-reminder', 'weather', 'web-search',
          'calculate', 'news', 'track-habit', 'manage-goals'],

  loop: {
    enabled: true,
    maxIterations: 10,
    timeout: 120000,
    completionThreshold: 0.7,
    streamSteps: true,
  },

  memory: {
    type: 'persistent',
    ttl: '365d',
  },
});
```

## Breaking Down the Instructions

### Onboarding Mode

The key insight: Aura checks the memory section that Kernova automatically injects into each prompt. When memories are empty, she knows this is a new user and shifts into learning mode.

**Why this matters:** Most chatbots start with "How can I help you?" — that's transactional. A personal AI starts with "Who are you?" — that's relational.

### Normal Mode

Once Aura has context, she weaves that knowledge into every response. If she knows you're a software engineer in London who wants to run a marathon, that colors everything — from how she talks to what she proactively suggests.

### Always Learning

The `save-note` tool fires silently whenever the user reveals something new. This is the "always-on" learning that makes the AI feel alive between sessions.

## How Memory Recall Integrates

Kernova's `autoRecall: true` (from our config) means every message the user sends triggers:

1. **Vector search** against stored memories using the message as query
2. **Scoring** combines similarity, recency, frequency, and relevance
3. **Injection** — top memories appear in a "THINGS I REMEMBER ABOUT YOU" section before the agent's instructions

The agent never has to call a tool to remember — it's automatic.

## Testing

Start the dev server and open the chat:

```bash
kernova dev
```

First conversation (empty memory):
```
Aura: Hey! I'm Aura, your personal AI. I'm here to help you
      manage... well, everything. But first — what should I call you?
You:  I'm Marcus
Aura: Nice to meet you, Marcus! What do you do for work?
```

Watch the terminal — you'll see `💾 Saving: "User's name is Marcus"` as the save-note tool fires.

Close the browser, reopen it:
```
Aura: Hey Marcus! How's your day going?
```

She remembers. That's the difference.

## Best Practices for Agent Instructions

1. **Structure with clear sections** — use headers/separators so the LLM can quickly find relevant context
2. **Be explicit about modes** — tell the agent exactly when to behave differently
3. **Include examples** — "You mentioned X" is more useful than "reference memories"
4. **Set boundaries** — "Never say 'As an AI'" prevents common breaks in personality
5. **Prioritize** — put critical behaviors (onboarding) first

## Exercise

1. Customize Aura's personality for yourself — change the tone, add specific interests
2. Chat with Aura and go through onboarding — see how she learns about you
3. Close the browser and reopen — verify she remembers your name
4. Try revealing a new fact in conversation — check if she saves it silently
5. Experiment: what happens if you interrupt onboarding with "what's the weather?"

Next up: we'll build the memory system that makes all this work.
