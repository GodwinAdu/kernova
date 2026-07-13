---
title: "Step 5: Deploy Nova"
description: "Ship your personal assistant to the internet."
---

# Step 5: Deploy Nova

Let's put Nova on the internet so you can access it from anywhere.

## Push to GitHub

First, create a GitHub repository for your project. Go to https://github.com/new and create a repo (e.g., `nova-assistant`).

Then push your code:

```bash
git init
git add -A
git commit -m "Nova personal assistant"
git remote add origin https://github.com/YOUR_USERNAME/nova-assistant.git
git push -u origin main
```

## Login to Kernova Cloud

If you haven't already:

1. Go to https://kernova-cloud.vercel.app
2. Sign up / sign in
3. Go to **Settings** → **Create Key**
4. Copy the key

```bash
kernova login --key kn_live_your_key_here
```

## Add Environment Variables

Go to the Kernova Cloud dashboard:

1. **Settings** → Connect GitHub (if you haven't)
2. After your project is created, go to **Projects** → your project → **Environment**
3. Add: `OPENAI_API_KEY` = your OpenAI key

This ensures the deployed service has access to OpenAI.

## Deploy

```bash
kernova deploy
```

You'll see:

```
  ✅ Deployed successfully

  URL:     https://kn-nova-assistant.onrender.com
  Status:  QUEUED
```

Wait 2-3 minutes for the build to complete on Render.

## Test the Live App

Visit your URL: **https://kn-nova-assistant.onrender.com**

You should see:
- The landing page with Nova's branding
- Click "Start chatting" → the chat interface
- Send a message → Nova responds

## What's Running in Production

```
Render Container:
├── Next.js (port 10000) ← serves the frontend + proxies to agents
└── Agent Backend (port 4555) ← runs KernovaKernel, handles AI requests
```

Render exposes port 10000 to the internet. When someone visits your URL:
- `/` → Next.js serves the landing page
- `/chat` → Next.js serves the chat UI
- `/api/agents/assistant` → Next.js proxies to the agent backend

## Making Changes

Want to update Nova? Just push to GitHub:

```bash
# Edit agents/assistant.agent.ts
git add -A
git commit -m "Updated Nova's personality"
git push origin main
```

Render auto-deploys when you push (it watches your `main` branch).

## Congratulations! 🎉

You've built and deployed a personal AI assistant with:

- ✅ Custom personality and behavioral rules
- ✅ Persistent memory (remembers across sessions)
- ✅ Web search capability
- ✅ Streaming chat interface with Tailwind
- ✅ Live on the internet

## What to Do Next

1. **Add more tools** — a to-do list tool, a calendar tool, a weather tool
2. **Add scheduling** — "Give me a morning briefing every day at 8am"
3. **Add channels** — Connect a Slack bot so you can talk to Nova from your phone
4. **Share it** — Give the URL to friends or colleagues

---

## Full Project Recap

```
nova-assistant/
├── app/
│   ├── layout.tsx           # Root layout
│   ├── providers.tsx        # KernovaProvider
│   ├── page.tsx             # Landing page
│   ├── globals.css          # Custom colors
│   └── chat/page.tsx        # Chat UI
├── agents/
│   └── assistant.agent.ts   # Nova's definition
├── agents/tools/
│   └── web-search.ts        # Web search
├── memory/
│   └── conversations.ts     # Memory schema
├── kernova.config.ts        # Config
└── .env.local               # Secrets
```

Key commands:
```bash
kernova dev          # Local development
kernova build        # Production build
kernova deploy       # Ship to cloud
```

Next tutorial: [Research & Content Pipeline →](/framework/tutorials/pipeline/01-intro) (intermediate)
