---
title: "Tutorial: Build a Support Bot"
description: "Step 1 — Set up your project and understand the file structure."
---

# Build a Support Bot with Kernova

In this tutorial, you'll build a **customer support bot** from scratch — a real application with:

- A chat interface where users ask questions
- An AI agent that searches a knowledge base before answering
- Conversation memory so the agent remembers past messages
- A custom tool for creating support tickets
- Deployment to production

By the end, you'll have a working app deployed at `https://your-app.kernova.app`.

**Prerequisites:**
- Node.js 22+ installed
- An OpenAI API key ([get one here](https://platform.openai.com/api-keys))
- Basic familiarity with React and TypeScript

---

## Step 1: Create Your Project

Open your terminal and run:

```bash
npx create-kernova-app support-bot
```

You'll see:

```
  ╔══════════════════════════════════════════╗
  ║     🧠 create-kernova-app               ║
  ║     Full-stack AI agent framework        ║
  ╚══════════════════════════════════════════╝

  Creating "support-bot" with template: default
  Framework: next

  📁 Project structure created
  📦 Git repository initialized
  📥 Installing dependencies...
  ✓  Dependencies installed

  ✅ Project created successfully!

  Next steps:
     cd support-bot
     kernova dev
```

Now enter the project:

```bash
cd support-bot
```

## Step 2: Understand the File Structure

Open the project in your editor. Here's what was generated:

```
support-bot/
├── app/                      ← Your frontend (Next.js 16)
│   ├── layout.tsx            ← Root layout (wraps with KernovaProvider)
│   ├── page.tsx              ← Landing page
│   ├── globals.css           ← Base styles
│   └── chat/
│       └── page.tsx          ← Chat UI (pre-built, uses useAgentStream)
├── agents/                   ← Your agent backend
│   ├── assistant.agent.ts    ← Default agent (we'll replace this)
│   └── tools/
│       └── web-search.ts     ← Example tool (we'll replace this)
├── memory/
│   └── conversations.ts      ← Memory schema
├── kernova.config.ts         ← Project configuration
├── next.config.ts            ← Next.js config (proxies /api/agents to backend)
├── .env.local                ← Your secrets (API keys)
└── package.json
```

**Key insight:** There are two separate systems here sharing one URL:

1. **`app/`** — This is a normal Next.js app. Pages, components, styles. Renders in the browser.
2. **`agents/`** — This runs on a server. Talks to LLMs, executes tools, stores memory. Never runs in the browser.

They communicate via HTTP. The `next.config.ts` has rewrites that proxy `/api/agents/*` to the agent server, so from the browser's perspective, everything is on the same domain.

## Step 3: Add Your OpenAI Key

Open `.env.local` and add your API key:

```
OPENAI_API_KEY=sk-proj-your-key-here
```

This is the only configuration needed to start.

## Step 4: Start the Dev Server

```bash
kernova dev
```

You'll see:

```
  ┌──────────────────────────────────────────┐
  │  🚀 Kernova Full-Stack Dev Server        │
  └──────────────────────────────────────────┘

  🧠 Kernova Framework Server
  ├─ Agents:  1 discovered
  ├─ Tools:   1 registered
  ├─ Memory:  1 namespaces
  └─ Config:  support-bot v0.1.0

  ⚡ Agent API ready at http://localhost:4555
  📡 Routes:
     POST /agents/assistant
     POST /agents/assistant/stream
     POST /v1/intents
     GET  /health

  🌐 Starting frontend (next) on port 3000...
  
  ════════════════════════════════════════════
  ✓ Ready at http://localhost:3000

    App:     http://localhost:3000
    Chat:    http://localhost:3000/chat
    Agents:  http://localhost:3000/api/agents/*
    Health:  http://localhost:3000/v1/health
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You should see the landing page. Click **"Open Chat →"** to go to the chat interface.

## Step 5: Test the Default Agent

In the chat page, type a message:

```
What is Kernova?
```

You should see the AI respond. This is the default `assistant` agent working — it's just GPT-4o with a basic system prompt.

**What just happened:**
1. The browser sent a POST to `/api/agents/assistant/stream`
2. Next.js proxied it to the agent server (port 4555)
3. The agent server loaded `agents/assistant.agent.ts`
4. It called OpenAI's API with the agent's instructions + your message
5. Tokens streamed back through SSE to the browser

---

## What's Next

In the next step, we'll replace the default agent with a proper support bot that has a knowledge base tool.

[Continue to Step 2: Define Your Agent →](/framework/tutorial/02-agent)
