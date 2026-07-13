---
title: "Step 1: Project Setup"
description: "Create the multi-agent project structure."
---

# Step 1: Project Setup

## Create the Project

```bash
npx create-kernova-app content-pipeline
cd content-pipeline
```

Add your OpenAI key to `.env.local`:
```
OPENAI_API_KEY=sk-proj-your-key
```

## Restructure for Multi-Agent

We need four agents instead of one. Delete the default agent and create our specialists:

```bash
# Remove the default
rm agents/assistant.agent.ts

# We'll create these files in the next steps:
# agents/router.agent.ts
# agents/researcher.agent.ts
# agents/analyzer.agent.ts
# agents/writer.agent.ts
```

Your project will look like:
```
content-pipeline/
├── agents/
│   ├── router.agent.ts       ← The brain (decides who handles what)
│   ├── researcher.agent.ts   ← Finds information
│   ├── analyzer.agent.ts     ← Extracts insights
│   ├── writer.agent.ts       ← Produces content
│   └── tools/
│       └── web-search.ts     ← Shared search tool
├── app/
│   └── chat/page.tsx         ← Chat UI (talks to router)
└── ...
```

## Understanding the File-Based Routing

Each agent file becomes an API endpoint:

| File | Endpoint | Who calls it |
|------|----------|-------------|
| `router.agent.ts` | `/api/agents/router` | The user (via chat UI) |
| `researcher.agent.ts` | `/api/agents/researcher` | The router (via delegation) |
| `analyzer.agent.ts` | `/api/agents/analyzer` | The router (via delegation) |
| `writer.agent.ts` | `/api/agents/writer` | The router (via delegation) |

The user only talks to the **Router**. The Router decides which specialist to call.

## Update the Chat Page

Open `app/chat/page.tsx` and change the hook to talk to the router:

Find:
```typescript
const { messages, send, isStreaming, streamingContent, abort, clear } = useAgentStream('assistant');
```

Change to:
```typescript
const { messages, send, isStreaming, streamingContent, abort, clear } = useAgentStream('router');
```

This ensures the user's messages go to the router agent, which then delegates to specialists.

## Why a Router?

Without a router, you'd need the user to choose which agent to talk to ("Am I asking the researcher or the writer?"). That's bad UX.

With a router:
- User says "Write a blog post about AI" → Router detects this needs the full pipeline
- User says "What happened today in tech?" → Router sends to Researcher only
- User says "Make this paragraph better" → Router sends to Writer only

The router is a **traffic controller** — it never does the work itself, just directs it.

---

[Continue to Step 2: Build the Researcher →](/framework/tutorials/pipeline/03-researcher)
