---
title: "Step 3: Build Custom Tools"
description: "Give your agent the ability to search a knowledge base and create support tickets."
---

# Step 3: Build Custom Tools

Tools are functions that your agent can call. The LLM decides when to use them based on their descriptions.

We need two tools for our support bot:
1. **search-kb** — Searches a knowledge base for answers
2. **create-ticket** — Creates a support ticket when the agent can't resolve an issue

## Create the Knowledge Base Tool

Delete the existing `agents/tools/web-search.ts` and create a new file:

```typescript
// agents/tools/search-kb.ts
import { defineTool } from '@kernova/framework';

// Simulated knowledge base — in production, this would query a database or vector store
const KNOWLEDGE_BASE = [
  {
    id: 'kb-001',
    title: 'How to reset your password',
    content: 'Go to Settings → Security → Reset Password. You\'ll receive an email with a reset link. The link expires in 24 hours.',
    tags: ['password', 'security', 'account'],
  },
  {
    id: 'kb-002',
    title: 'Pricing plans',
    content: 'We offer three plans: Free (up to 3 projects), Pro ($12/month, unlimited projects, priority support), and Enterprise (custom pricing, SSO, dedicated account manager). All plans include a 14-day free trial.',
    tags: ['pricing', 'billing', 'plans'],
  },
  {
    id: 'kb-003',
    title: 'How to invite team members',
    content: 'Go to Settings → Team → Invite. Enter their email address and select a role (Admin, Member, or Viewer). They\'ll receive an email invitation. Invitations expire after 7 days.',
    tags: ['team', 'invite', 'collaboration'],
  },
  {
    id: 'kb-004',
    title: 'Integrations',
    content: 'We integrate with: Slack (notifications), GitHub (link commits to tasks), Google Calendar (sync deadlines), Zapier (custom automations). Set up integrations in Settings → Integrations.',
    tags: ['integrations', 'slack', 'github'],
  },
  {
    id: 'kb-005',
    title: 'Data export',
    content: 'Export your data anytime from Settings → Data → Export. We support CSV and JSON formats. Exports include all projects, tasks, and comments. Large exports are emailed as a download link.',
    tags: ['export', 'data', 'backup'],
  },
  {
    id: 'kb-006',
    title: 'Cancellation policy',
    content: 'You can cancel your subscription anytime from Settings → Billing → Cancel Plan. You\'ll retain access until the end of your current billing period. We don\'t offer refunds for partial months.',
    tags: ['cancel', 'billing', 'subscription'],
  },
];

export default defineTool({
  name: 'search-kb',
  description: 'Search the Acme Inc. knowledge base for product information, how-to guides, and policies. Use this BEFORE answering any product-related question.',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query — use keywords from the user\'s question',
      required: true,
    },
  },
  execute: async ({ query }, ctx) => {
    ctx.log(`Searching knowledge base for: "${query}"`);

    // Simple keyword matching — in production, use vector similarity search
    const queryWords = (query as string).toLowerCase().split(/\s+/);

    const results = KNOWLEDGE_BASE
      .map((article) => {
        const text = `${article.title} ${article.content} ${article.tags.join(' ')}`.toLowerCase();
        const matchCount = queryWords.filter((word) => text.includes(word)).length;
        return { ...article, score: matchCount / queryWords.length };
      })
      .filter((article) => article.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (results.length === 0) {
      return { found: false, message: 'No relevant articles found in the knowledge base.' };
    }

    return {
      found: true,
      articles: results.map((r) => ({
        title: r.title,
        content: r.content,
      })),
    };
  },
});
```

## Create the Ticket Tool

```typescript
// agents/tools/create-ticket.ts
import { defineTool } from '@kernova/framework';

// In-memory ticket store — in production, this would call your ticketing system API
const tickets: Array<{ id: string; subject: string; description: string; priority: string; createdAt: string }> = [];

export default defineTool({
  name: 'create-ticket',
  description: 'Create a support ticket when you cannot resolve the customer\'s issue. Use this for escalation.',
  parameters: {
    subject: {
      type: 'string',
      description: 'Brief summary of the issue',
      required: true,
    },
    description: {
      type: 'string',
      description: 'Detailed description of the problem and what was already tried',
      required: true,
    },
    priority: {
      type: 'string',
      description: 'Ticket priority level',
      required: true,
      enum: ['low', 'medium', 'high'],
    },
  },
  execute: async ({ subject, description, priority }, ctx) => {
    ctx.log(`Creating ticket: "${subject}" (priority: ${priority})`);

    const ticket = {
      id: `TKT-${Date.now().toString(36).toUpperCase()}`,
      subject: subject as string,
      description: description as string,
      priority: priority as string,
      createdAt: new Date().toISOString(),
    };

    tickets.push(ticket);

    return {
      success: true,
      ticketId: ticket.id,
      message: `Ticket ${ticket.id} created successfully. A support engineer will follow up within 24 hours.`,
    };
  },
});
```

## Test the Tools

Restart your dev server (or let hot-reload pick up the changes):

```bash
kernova dev
```

You should now see in the console:

```
  🧠 Kernova Framework Server
  ├─ Agents:  1 discovered
  ├─ Tools:   2 registered       ← Now 2!
  ├─ Memory:  1 namespaces
  └─ Config:  support-bot v0.1.0
```

Go to [http://localhost:3000/chat](http://localhost:3000/chat) and try these conversations:

**Test 1: Knowledge base search**
```
How do I reset my password?
```

The agent should:
1. Call `search-kb` with query "reset password"
2. Find the article about password reset
3. Give you specific instructions from the KB

**Test 2: Ticket creation**
```
My account has been locked for 3 days and nothing works. I need urgent help.
```

The agent should:
1. Try searching the KB first
2. Realize it can't resolve a locked account
3. Offer to create a ticket
4. Create a ticket with priority "high"

**Test 3: Out of scope**
```
What's the weather today?
```

The agent should:
1. Politely explain that it can only help with Acme product questions

## How Tool Calling Works Under the Hood

When you send a message, here's what happens:

```
User: "How do I reset my password?"
  ↓
Agent receives message + tool descriptions
  ↓
LLM thinks: "The user is asking about password reset. 
             I should search the KB first (as my instructions say)."
  ↓
LLM responds with a tool_call: search-kb(query: "reset password")
  ↓
Kernova executes the tool, gets results
  ↓
Results are fed back to the LLM
  ↓
LLM generates final answer using the KB article
  ↓
Response streamed to the user
```

The LLM decides which tools to call and when. Your `instructions` guide this behavior.

## What You Learned

- Tools are defined in `agents/tools/*.ts`
- The `description` field is crucial — it tells the LLM when to use the tool
- `parameters` define what inputs the tool accepts
- `execute` is where your actual logic lives
- The agent automatically decides when to call tools based on instructions + context
- You can log from inside tools with `ctx.log()`

---

[Continue to Step 4: Build the Chat UI →](/framework/tutorial/04-frontend)
