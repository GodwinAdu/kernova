---
title: "Tutorial: Personal AI Assistant"
description: "Build a personal AI assistant with memory, web search, and a clean chat UI."
---

# Tutorial: Personal AI Assistant

**Difficulty:** Beginner
**Time:** 15 minutes
**What you'll build:** A personal assistant that remembers your preferences, searches the web, and maintains conversations across sessions.

## What You'll Learn

- Creating a project from scratch
- Defining an agent with personality
- Using persistent memory
- Connecting web search
- Building a chat interface

## Step 1: Create the Project

```bash
npx create-kernova-app my-assistant
cd my-assistant
```

Add your OpenAI key to `.env.local`:
```
OPENAI_API_KEY=sk-proj-your-key
```

## Step 2: Define Your Assistant

Replace `agents/assistant.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Personal Assistant',
  model: 'gpt-4o',
  instructions: `
    You are a personal AI assistant named Nova.
    
    PERSONALITY:
    - Friendly, warm, and helpful
    - Concise but thorough
    - You remember past conversations and user preferences
    - You proactively offer relevant suggestions
    
    CAPABILITIES:
    - Answer questions on any topic
    - Search the web for current information
    - Remember user preferences and context
    - Help with tasks, planning, and decision-making
    
    RULES:
    - Always search the web when asked about current events, prices, or recent news
    - Reference past conversations when relevant ("Last time you mentioned...")
    - Ask clarifying questions when the request is ambiguous
    - Be honest when you don't know something
  `,
  tools: ['web-search'],
  memory: {
    type: 'persistent',
    ttl: '90d', // Remember for 3 months
  },
  temperature: 0.7,
});
```

## Step 3: Add Memory Schema

Replace `memory/conversations.ts`:

```typescript
import { defineMemory } from '@kernova/framework';

export default defineMemory({
  name: 'personal',
  schema: {
    preference: { type: 'text', indexed: true },
    topic: { type: 'text', indexed: true },
    context: { type: 'text' },
    importance: { type: 'number' },
  },
  ttl: '90d',
  autoSummarize: true,
});
```

## Step 4: Test It

```bash
kernova dev
```

Open http://localhost:3000/chat and try:

1. **"My name is Alex and I prefer TypeScript over JavaScript"**
   - The agent stores this preference in memory

2. **"What's the latest news about AI?"**
   - The agent uses web-search to get current info

3. **Close the browser, reopen, and ask: "What's my name?"**
   - The agent remembers from persistent memory!

## Step 5: Deploy

```bash
git init && git add -A && git commit -m "Personal assistant"
git remote add origin https://github.com/you/my-assistant.git
git push -u origin main

kernova login --key kn_live_xxx
kernova deploy
```

## What You Built

✅ An AI assistant with personality
✅ Persistent memory (survives restarts)  
✅ Web search integration  
✅ Streaming chat UI  
✅ Deployed to production

## Next Steps

- Add more tools (calendar, email, to-do list)
- Add a daily summary schedule
- Connect a Slack channel for mobile access
