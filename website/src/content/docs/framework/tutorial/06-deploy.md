---
title: "Step 6: Deploy to Production"
description: "Ship your support bot to Kernova Cloud with one command."
---

# Step 6: Deploy to Production

Your support bot works locally. Let's put it on the internet.

## Sign Up for Kernova Cloud

1. Go to [cloud.kernova.app](https://cloud.kernova.app)
2. Create an account
3. Go to **Dashboard → Settings**
4. Click **"Create Key"** to generate an API key
5. Copy the key (it starts with `kn_live_`)

## Login from CLI

```bash
kernova login --key kn_live_your_key_here
```

You'll see:

```
  ✓ Logged in to Kernova Cloud
    Key: kn_live_xxxxxxxx...
    Cloud: https://cloud.kernova.app
```

## Add Your Secrets

Before deploying, add your OpenAI key to the cloud vault so your production deployment can access it:

1. Go to **Dashboard → Secrets**
2. Click **"Add Secret"**
3. Key: `OPENAI_API_KEY`, Value: your key
4. Save

This key will be injected into your deployment as an environment variable.

## Deploy

```bash
kernova deploy
```

The CLI will:

```
  ┌──────────────────────────────────────────┐
  │  🚀 Kernova Full-Stack Dev Server        │
  └──────────────────────────────────────────┘

  Deploying: frontend + agents
  Region:    us-east-1

  [1/4] Validating configuration...  ✓
  [2/4] Compiling agents...          ✓
  [3/4] Building frontend (Next.js)... ✓
  [4/4] Uploading to Kernova Cloud...

  ┌──────────────────────────────────────────────────┐
  │  ✅ Deployed successfully                        │
  │                                                  │
  │  URL:     https://support-bot.kernova.app        │
  │  Region:  us-east-1                              │
  │  Status:  live                                   │
  └──────────────────────────────────────────────────┘
```

## Verify It's Working

Open your deployed URL:

```bash
# Check the health endpoint
curl https://support-bot.kernova.app/v1/health
```

```json
{
  "status": "healthy",
  "name": "support-bot",
  "agents": [{ "route": "support", "name": "Support Agent" }],
  "uptime": 42.5
}
```

Visit `https://support-bot.kernova.app/chat` — your chat UI is live.

## Test via API

You can also call the agent directly via API:

```bash
curl -X POST https://support-bot.kernova.app/api/agents/support \
  -H "Content-Type: application/json" \
  -d '{"input": "How do I reset my password?"}'
```

This is how other apps would integrate with your bot — any frontend (mobile app, Slack bot, widget) can call this endpoint.

## Monitor in the Dashboard

Go to your Kernova Cloud dashboard:

- **Projects** → See your deployed project
- **Monitoring** → Check deployment health, success rate
- **Deployments** → View build logs and history

## Make a Change and Redeploy

Let's add a new article to the knowledge base. Open `agents/tools/search-kb.ts` and add to the array:

```typescript
{
  id: 'kb-007',
  title: 'Mobile app',
  content: 'Our mobile app is available on iOS and Android. Download from the App Store or Google Play. Sign in with your existing account credentials.',
  tags: ['mobile', 'app', 'ios', 'android'],
},
```

Now redeploy:

```bash
kernova deploy
```

Within seconds, your production bot can answer questions about the mobile app. Zero downtime — the new version replaces the old one seamlessly.

## What You Built

Congratulations! You've built and deployed a production support bot with:

✅ An AI agent with custom instructions  
✅ A knowledge base search tool  
✅ A ticket creation tool  
✅ Streaming chat UI  
✅ Conversation memory  
✅ One-command deployment  
✅ Live at a public URL  

## What's Next

From here, you could:

- **Add more agents** — Create `agents/billing.agent.ts` for billing-specific questions
- **Connect a real database** — Replace the hardcoded KB with a vector database
- **Add authentication** — Protect the chat page so only logged-in users can access it
- **Embed in your app** — Use the API endpoint from your existing website's chat widget
- **Set up custom domain** — Point `support.yourcompany.com` to your deployment

---

## Full Project Recap

Here's your final project structure:

```
support-bot/
├── app/
│   ├── layout.tsx           # KernovaProvider wrapper
│   ├── page.tsx             # Landing page
│   ├── globals.css          # Chat styles
│   └── chat/
│       └── page.tsx         # Chat UI with useAgentStream
├── agents/
│   ├── support.agent.ts     # Support agent definition
│   └── tools/
│       ├── search-kb.ts     # Knowledge base search
│       └── create-ticket.ts # Ticket creation
├── memory/
│   └── conversations.ts     # Memory schema
├── kernova.config.ts
├── next.config.ts
├── .env.local
└── package.json
```

Commands used:
```bash
npx create-kernova-app support-bot   # Create
kernova dev                           # Develop
kernova login --key kn_live_xxx       # Authenticate
kernova deploy                        # Ship
```

That's the Kernova developer experience: **define agents, build a UI, deploy with one command.**
