---
title: "Personal AI Assistant — Introduction"
description: "What we're building and why this tutorial matters."
---

# Build a Personal AI Assistant

In this tutorial, you'll build **Nova** — a personal AI assistant that:

- Remembers your name, preferences, and past conversations
- Searches the web for current information
- Maintains context across sessions (close the browser, come back tomorrow — it still knows you)
- Has a friendly personality you define

This is the foundation for any conversational AI product — a personal chatbot, a customer service agent, or an internal team assistant.

## Why This Tutorial?

Most AI chatbots are **stateless** — every conversation starts from scratch. The user says "My name is Alex" and five minutes later the bot has forgotten. That's frustrating.

We'll build something better. Nova uses **persistent memory** — it stores important information and recalls it in future conversations. This is the key difference between a toy chatbot and a useful assistant.

## What You'll Learn

By the end of this tutorial (about 20 minutes), you'll understand:

1. **How to create a Kernova project** — the file structure and what each part does
2. **How to define an agent with personality** — not just a model, but instructions that shape behavior
3. **How persistent memory works** — what gets stored, how long it lasts, how the agent uses it
4. **How tools work** — giving agents the ability to search the web
5. **How the chat UI connects** — React hooks that auto-bind to your agent
6. **How to deploy** — ship it to the internet in one command

## Prerequisites

- **Node.js 22+** installed ([download](https://nodejs.org))
- **An OpenAI API key** ([get one](https://platform.openai.com/api-keys))
- Basic familiarity with TypeScript/JavaScript
- A terminal (PowerShell, Terminal, or cmd)

## The End Result

After this tutorial, you'll have an app that looks like this:

```
┌─────────────────────────────────────────┐
│  Nova — Personal Assistant              │
├─────────────────────────────────────────┤
│                                         │
│  You: My name is Alex, I work at       │
│       Acme Corp as a developer.         │
│                                         │
│  Nova: Nice to meet you, Alex! I'll    │
│       remember that you work at Acme    │
│       Corp as a developer. How can I    │
│       help you today?                   │
│                                         │
│  ─── (next day, new session) ───       │
│                                         │
│  You: What's my name?                   │
│                                         │
│  Nova: Your name is Alex! You work at  │
│       Acme Corp as a developer. What    │
│       can I help you with today?        │
│                                         │
└─────────────────────────────────────────┘
```

The assistant remembers across sessions because of persistent memory.

## Let's Start

[Continue to Step 1: Create Your Project →](/framework/tutorials/assistant/02-create-project)
