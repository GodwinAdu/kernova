---
title: Team & Delegation
description: Wire the Life OS team — Aura delegates to specialists seamlessly based on task domain.
---

## What You'll Build

A hierarchical team where Aura (lead agent) automatically delegates domain-specific tasks to specialists. When a user says "Create a budget for me," Aura recognizes it's a finance domain task and delegates to the Finance specialist — seamlessly, without the user knowing.

## defineTeam() and Strategy

Kernova's `defineTeam()` creates a structured group of agents with defined roles and routing logic. The `hierarchical` strategy means one agent (the lead) coordinates all others.

Create `agents/teams/life-os.ts`:

```typescript
import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Life OS',
  description: 'Full life management team — coordinates across all domains',
  strategy: 'hierarchical',

  members: [
    {
      agent: 'assistant',
      role: 'lead',
      description: 'Coordinates specialists, maintains context, communicates with user',
      canDelegate: true,
      canApprove: true,
    },
    {
      agent: 'productivity',
      role: 'member',
      description: 'Scheduling, tasks, planning, goals, habits',
      specialization: ['calendar', 'tasks', 'planning', 'goals', 'habits', 'schedule'],
    },
    {
      agent: 'finance',
      role: 'member',
      description: 'Budget, spending, savings, bills, investments',
      specialization: ['money', 'budget', 'spending', 'savings', 'bills', 'expenses'],
    },
    {
      agent: 'health',
      role: 'member',
      description: 'Exercise, sleep, nutrition, wellness, mental health',
      specialization: ['exercise', 'sleep', 'nutrition', 'fitness', 'wellness', 'diet'],
    },
    {
      agent: 'knowledge',
      role: 'member',
      description: 'Research, learning, explanations, study, news',
      specialization: ['research', 'learn', 'explain', 'study', 'science', 'technology'],
    },
    {
      agent: 'social',
      role: 'member',
      description: 'Email drafting, communication, contacts, networking',
      specialization: ['email', 'message', 'contact', 'relationship', 'networking'],
    },
    {
      agent: 'lifestyle',
      role: 'member',
      description: 'Shopping, recipes, travel, home, recommendations',
      specialization: ['shopping', 'recipe', 'travel', 'cooking', 'gift', 'restaurant'],
    },
    {
      agent: 'spiritual',
      role: 'member',
      description: 'Bible reading, ministry, meeting prep, spiritual goals',
      specialization: ['bible', 'scripture', 'prayer', 'ministry', 'spiritual', 'faith'],
    },
    {
      agent: 'developer',
      role: 'member',
      description: 'Code help, architecture, debugging, PR reviews',
      specialization: ['code', 'programming', 'debug', 'architecture', 'git', 'api'],
    },
    {
      agent: 'creative',
      role: 'member',
      description: 'Writing, content, brainstorming, marketing copy',
      specialization: ['write', 'content', 'blog', 'creative', 'brainstorm', 'marketing'],
    },
    {
      agent: 'career',
      role: 'member',
      description: 'Career growth, interviews, salary, professional development',
      specialization: ['career', 'job', 'interview', 'salary', 'resume', 'promotion'],
    },
  ],

  maxDelegationDepth: 3,
  taskTimeout: 180000,
  requireLeadApproval: true,
});
```

**Why `hierarchical`?** Other strategies (`parallel`, `consensus`, `sequential`) suit different use cases. For a personal AI, hierarchical is ideal — one agent owns the conversation and delegates as needed. The user always talks to Aura, never directly to specialists.

## The Delegation Tool

The magic happens through a tool Aura calls when she recognizes domain-specific work. Create `agents/tools/delegate.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'delegate',
  description: `Delegate a task to a specialist agent. Use when a request falls clearly into a specialist's domain.

SPECIALISTS:
- "productivity" — scheduling, planning, tasks, goals, time management
- "finance" — budgets, spending, savings, subscriptions, bills
- "health" — exercise, sleep, nutrition, wellness, mood
- "knowledge" — research, learning, explanations, technical questions
- "social" — email drafts, communication, contacts, tone matching
- "lifestyle" — shopping, recipes, travel, recommendations
- "spiritual" — Bible, devotionals, ministry, meeting prep
- "developer" — code, architecture, debugging, PRs
- "creative" — writing, content, brainstorming, marketing
- "career" — career growth, interviews, salary, skills

WHEN TO DELEGATE:
- "Create a budget" → finance
- "Plan my workout" → health
- "Write a blog post" → creative

WHEN NOT TO DELEGATE:
- Simple questions, quick tool calls, casual chat
- Multi-domain tasks (handle yourself)`,
  parameters: {
    specialist: {
      type: 'string',
      description: 'Which specialist: productivity, finance, health, knowledge, social, lifestyle, spiritual, developer, creative, career',
      required: true,
    },
    task: {
      type: 'string',
      description: 'The specific task to delegate. Include all context the specialist needs.',
      required: true,
    },
    context: {
      type: 'string',
      description: 'Additional context from the conversation',
      required: false,
    },
  },
  execute: async ({ specialist, task, context }, ctx) => {
    const validSpecialists = ['productivity', 'finance', 'health', 'knowledge', 'social', 'lifestyle', 'spiritual', 'developer', 'creative', 'career'];

    if (!validSpecialists.includes(specialist as string)) {
      return { error: `Unknown specialist "${specialist}". Available: ${validSpecialists.join(', ')}` };
    }

    ctx.log(`🔀 Delegating to ${specialist}: "${(task as string).slice(0, 60)}..."`);

    try {
      const backendUrl = process.env.KERNOVA_URL || 'http://localhost:4555';
      const fullInput = context ? `${task}\n\nContext: ${context}` : task as string;

      const res = await fetch(`${backendUrl}/agents/${specialist}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: fullInput,
          threadId: `delegate_${specialist}_${Date.now()}`,
        }),
      });

      if (res.ok) {
        const data = await res.json() as any;
        ctx.log(`✅ ${specialist} responded (${data.metadata?.durationMs || 0}ms)`);
        return { specialist, response: data.content, delegated: true };
      }
      return { specialist, error: `Specialist returned ${res.status}`, delegated: false };
    } catch (err: any) {
      return { specialist, error: `Could not reach specialist: ${err.message}`, delegated: false };
    }
  },
});
```

## How Delegation Works Under the Hood

```
User: "Create a monthly budget for me"
  │
  ▼
Aura receives message + memory context
  │
  ▼
Aura's instructions say: budget → delegate to finance
  │
  ▼
Aura calls delegate tool: specialist="finance", task="Create a monthly budget..."
  │
  ▼
delegate tool POSTs to http://localhost:4555/agents/finance
  │
  ▼
Finance agent processes with its deep instructions
  │
  ▼
Finance returns detailed budget breakdown
  │
  ▼
Aura receives result, presents it naturally to user
```

The user never sees the delegation. Aura presents the specialist's response as her own.

## Update Aura's Instructions

Add delegation guidelines to `agents/assistant.agent.ts`:

```typescript
// Add to Aura's instructions string:
`
DELEGATION (use delegate tool for domain-specific deep tasks):
- "Help me plan my week" → delegate to "productivity"
- "Create a budget for me" → delegate to "finance"
- "Give me a workout plan" → delegate to "health"
- "Explain quantum computing" → delegate to "knowledge"
- "Draft a professional email" → delegate to "social"
- "Plan a trip to Japan" → delegate to "lifestyle"
- "Help me with Bible study" → delegate to "spiritual"
- "Review this code" → delegate to "developer"
- "Write a blog post" → delegate to "creative"
- "Help me prep for interviews" → delegate to "career"

DO delegate when: user needs detailed domain expertise
DON'T delegate for: quick tool calls, simple questions, casual chat

Present the specialist's response naturally as your own.
Don't say "I delegated to my finance agent" — just give the answer seamlessly.
`
```

## When to Delegate vs Handle Directly

The lead agent should handle:
- Greetings, casual conversation
- Quick tool calls ("what's the weather?")
- Multi-domain tasks that span specialists
- Anything requiring user context from multiple domains

Delegate when:
- The task clearly belongs to one domain
- It requires deep domain instructions (budget frameworks, workout programming)
- The specialist's focused context will produce better results

## Testing

```bash
kernova dev
```

Chat:
```
You:    Create a budget for me. I make $5000/month.
Aura:   [internally delegates to Finance specialist]
        Here's a budget framework for your $5000 monthly income:

        Using the 50/30/20 rule:
        • Needs (50%): $2,500 — rent, utilities, groceries, insurance
        • Wants (30%): $1,500 — entertainment, dining, hobbies
        • Savings (20%): $1,000 — emergency fund, investments
        ...
```

Watch the terminal:
```
🔀 Delegating to finance: "Create a budget for me. I make $5000/month..."
✅ finance responded (2340ms)
```

## Exercise

1. Test delegation: ask Aura to create a workout plan, write a blog post, and explain a concept
2. Watch the terminal logs — see which specialist handles each request
3. Try a multi-domain question: "Help me balance my work schedule with my fitness goals" — see how Aura handles it without delegating
4. Add a custom specialist for your own domain and wire it into the team
5. Experiment with `maxDelegationDepth: 3` — what happens if a specialist tries to delegate?

Next: we'll enable agent loops so Aura can handle complex multi-step tasks.
