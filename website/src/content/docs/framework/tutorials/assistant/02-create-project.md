---
title: "Step 1: Create Your Project"
description: "Scaffold the project and understand every file."
---

# Step 1: Create Your Project

## Create It

Open your terminal and run:

```bash
npx create-kernova-app nova-assistant
```

Wait for it to finish, then enter the project:

```bash
cd nova-assistant
```

## What Was Generated

Let's look at what we have:

```
nova-assistant/
├── app/                      ← Your frontend (what users see)
│   ├── layout.tsx            ← Root layout (wraps everything)
│   ├── providers.tsx         ← Kernova context provider
│   ├── page.tsx              ← Landing page
│   ├── globals.css           ← Tailwind styles
│   └── chat/
│       └── page.tsx          ← The chat interface
├── agents/                   ← Your AI backend
│   ├── assistant.agent.ts    ← The agent definition
│   └── tools/
│       └── web-search.ts     ← Web search tool
├── memory/
│   └── conversations.ts      ← Memory schema
├── kernova.config.ts         ← Project settings
├── next.config.ts            ← Next.js routing config
├── postcss.config.mjs        ← Tailwind setup
├── .env.local                ← Your API keys (secret!)
├── package.json              ← Dependencies
└── tsconfig.json             ← TypeScript config
```

### Understanding the split

There are **two systems** running in one project:

1. **Frontend** (`app/` folder) — This is a Next.js application. It renders HTML, handles routing, and shows the chat UI in the browser. This is what the user interacts with.

2. **Agent backend** (`agents/` folder) — This runs on a server. It talks to OpenAI, executes tools, stores memories. The browser never runs this code directly.

They communicate via HTTP. When you type a message in the chat, the frontend sends it to the agent backend, which processes it and streams the response back.

**Why this matters:** You don't have to think about APIs, endpoints, or CORS. The framework connects them automatically.

## Add Your API Key

Open `.env.local` in your editor and replace the placeholder:

```
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

This key is used by the agent backend to call OpenAI. It's never sent to the browser.

**Important:** Never commit `.env.local` to git. It's already in `.gitignore`.

## Run It

```bash
kernova dev
```

You should see:

```
  🚀 Kernova Full-Stack Dev Server

  🧠 Kernova Framework Server
  ├─ Agents:  1 discovered
  ├─ Tools:   1 registered
  ├─ Memory:  1 namespaces
  └─ Config:  nova-assistant v0.1.0

  ⚡ Agent API ready at http://localhost:4555
  
  ✓ Ready at http://localhost:3000
```

Open **http://localhost:3000** in your browser. You should see the landing page. Click "Start chatting" to go to the chat interface.

Try typing "Hello" — the assistant should respond.

## What Just Happened

When you started `kernova dev`:

1. The framework scanned `agents/` and found `assistant.agent.ts`
2. It read the agent's instructions, tools, and memory config
3. It started the agent backend on port 4555
4. It started Next.js (the frontend) on port 3000
5. Next.js proxies `/api/agents/*` requests to port 4555

When you sent "Hello":

1. The chat UI called `POST /api/agents/assistant` with `{ input: "Hello" }`
2. Next.js proxied it to port 4555
3. The agent backend loaded your agent's instructions and sent them + your message to OpenAI
4. OpenAI responded with text
5. The response streamed back token-by-token to the browser

All of this happened because of a single file: `agents/assistant.agent.ts`.

---

[Continue to Step 2: Define Nova's Personality →](/framework/tutorials/assistant/03-personality)
