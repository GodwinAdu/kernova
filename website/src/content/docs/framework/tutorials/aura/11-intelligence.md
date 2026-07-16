---
title: "Advanced Intelligence"
description: "Make Aura truly intelligent — learning from corrections, cross-context reasoning, and connecting dots across your life."
---

# Part 11: Advanced Intelligence

This is what separates a chatbot from a personal AI. Aura doesn't just respond — she **learns**, **connects**, and **improves** permanently.

## What You'll Build

Two intelligence systems that make senior engineers go "wow":

1. **Rules Engine** — Aura learns from corrections and never makes the same mistake twice
2. **Cross-Context Reasoning** — Aura connects dots between different areas of your life

## The Rules Engine: Learning From Corrections

When you correct Aura, she should remember **permanently**. Not just for this conversation — forever.

### The Tool

Create `agents/tools/manage-rules.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'manage-rules',
  description: `Manage standing rules that override default behavior.
    Use when the user says "don't do X", "always do Y", "never...", "from now on..."`,
  parameters: {
    action: { type: 'string', description: '"add", "list", "remove", "search"', required: true },
    rule: { type: 'string', description: 'The rule text', required: false },
    category: { type: 'string', description: 'email, calendar, communication, behavior, etc.', required: false },
  },
  execute: async ({ action, rule, category }, ctx) => {
    const backendUrl = process.env.KERNOVA_URL || 'http://localhost:4555';

    if (action === 'add') {
      // Save rule to memory with special tags
      await fetch(`${backendUrl}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `[RULE] ${rule}`,
          tags: ['rule', 'standing-rule', category || 'behavior'],
          namespace: 'rules',
        }),
      });
      return { saved: true, message: `Got it! I'll remember: "${rule}"` };
    }

    if (action === 'list') {
      const res = await fetch(`${backendUrl}/memory/search?q=rule&limit=30`);
      const data = await res.json();
      const rules = data.entries.filter(e => e.tags?.includes('rule'));
      return { rules: rules.map(r => r.content.replace('[RULE] ', '')), count: rules.length };
    }

    // ... remove and search actions
  },
});
```

### The Instructions

Add to your agent's instructions:

```
LEARNING FROM CORRECTIONS (CRITICAL)

When the user corrects you or sets a rule:
- "Don't do X" / "Never X" → manage-rules action:"add" immediately
- "Always X" / "From now on X" → manage-rules action:"add"
- "That's wrong, the right way is X" → save correction as a rule

NEVER make the same mistake twice. Rules override default behavior.
```

### How It Works in Practice

```
User: "Don't notify me about Samsung promotional emails"
Aura: ✅ Got it! I'll remember: "Don't notify about Samsung emails"
       [Saved as standing rule]

--- Later, email-monitor trigger fires ---

Agent checks inbox → finds Samsung promo → searches rules →
finds "Don't notify about Samsung" → SKIPS it silently

User never sees that Samsung email notification again. Permanently.
```

### What Triggers Rule Creation

The agent detects correction language:
- "Don't / Never / Stop doing..."
- "Always / From now on..."
- "I prefer / I'd rather..."
- "That's wrong, actually..."
- "Please remember that..."

## Cross-Context Reasoning: Connecting Dots

This is the most impressive capability. Aura sees connections between different areas of your life that you might miss.

### The Tool

Create `agents/tools/cross-context.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'cross-context',
  description: `Gather and synthesize context from multiple life domains.
    Use to provide intelligent insights that connect different areas.`,
  parameters: {
    action: {
      type: 'string',
      description: '"dayBrief", "meetingPrep", "impactAnalysis", "patternDetect", "connectionMap"',
      required: true,
    },
    topic: { type: 'string', description: 'Topic to analyze', required: false },
    change: { type: 'string', description: 'Change to analyze impact for', required: false },
  },
  execute: async ({ action, topic, change }, ctx) => {
    const backendUrl = process.env.KERNOVA_URL || 'http://localhost:4555';

    const searchMemory = async (query) => {
      const res = await fetch(`${backendUrl}/memory/search?q=${query}&limit=10`);
      return (await res.json()).entries || [];
    };

    switch (action) {
      case 'dayBrief': {
        const [goals, habits, schedule] = await Promise.all([
          searchMemory('goal priority deadline'),
          searchMemory('habit streak energy'),
          searchMemory('meeting schedule today'),
        ]);
        return {
          goals: goals.slice(0, 3),
          habits: habits.slice(0, 3),
          schedule: schedule.slice(0, 3),
          instruction: 'Synthesize into a personalized briefing. Connect dots between areas.',
        };
      }

      case 'impactAnalysis': {
        // Search ALL domains for things related to the change
        const results = await Promise.all([
          searchMemory(`${change} calendar`),
          searchMemory(`${change} goals`),
          searchMemory(`${change} projects`),
          searchMemory(`${change} health`),
        ]);
        return {
          change,
          impacts: results.flat().map(e => e.content),
          instruction: 'Explain how this change affects other areas. Be specific.',
        };
      }

      case 'patternDetect': {
        const [mood, energy, habits] = await Promise.all([
          searchMemory('mood energy feeling'),
          searchMemory('sleep tired rest'),
          searchMemory('exercise habit streak'),
        ]);
        return {
          patterns: { mood, energy, habits },
          instruction: 'Detect correlations and trends. Show cause-and-effect.',
        };
      }
      // ... more actions
    }
  },
});
```

### Cross-Context in Action

**Scenario: User mentions a deadline**

```
User: "I have a big presentation on Friday"

Aura's thought process:
1. Check calendar for Friday → 2 meetings already booked
2. Check this week's workload → heavy (4 PRs to review)
3. Check habits → user hasn't exercised in 3 days (stress indicator)
4. Check rules → user prefers morning prep for presentations

Aura's response:
"Friday presentation noted! A few things I noticed:
- You have 2 meetings on Friday already (10am and 2pm). Want me to reschedule one?
- This week is heavy with 4 PRs to review. I'd suggest delegating 2 to focus on prep.
- You haven't exercised since Tuesday — a workout tonight might help with the stress.
- Based on your preference, I'll block Thursday 6-8am for presentation prep."
```

**Scenario: Morning briefing**

```
User: "Good morning"

Aura (using cross-context dayBrief):
"Morning Godwin! Here's your day:

📅 Schedule: 3 meetings (10am standup, 1pm Albert, 4pm Sprint review)
📧 Emails: 5 new — 2 from SyncBooks (flagged important), rest are newsletters
🎯 Active goal: Ship Kernova v2 (deadline in 4 days)
⚡ Pattern I noticed: You've been sleeping <6h for 3 days. Your productivity
   tends to dip on day 4 of short sleep. Consider an early night tonight.
📖 Bible reading: You're on Psalm 42 this week (2 chapters behind schedule)

Suggested focus for today: SyncBooks emails first, then deep work on Kernova."
```

### When Cross-Context Activates

Add these triggers to instructions:

```
CROSS-CONTEXT INTELLIGENCE

Use cross-context tool proactively:
- Morning greeting → dayBrief
- Before meetings → meetingPrep  
- User mentions changes → impactAnalysis
- User asks "why am I feeling..." → patternDetect
- User asks about connections → connectionMap
```

## The Difference This Makes

**Without intelligence:**
```
User: "What's on my schedule today?"
Agent: "You have 3 meetings: standup at 10, Albert at 1, sprint at 4."
```

**With intelligence:**
```
User: "What's on my schedule today?"
Agent: "You have 3 meetings today. Heads up — the Albert meeting is about
the design thumbnails he shared last week (you haven't replied to his email yet).
Also, sprint review is at 4pm but you told me you wanted to deploy Kernova
before that — you have a 2-hour window from 2-4pm for the deployment."
```

The second response uses:
- Calendar data (meetings)
- Email context (Albert's unread email)
- Memory (user's deployment goal)
- Temporal reasoning (finding the window)

## Exercise

1. Tell Aura a rule: "Never send emails after 9pm"
2. Ask "What are my rules?" — verify it's saved
3. Say "Good morning" and see if cross-context provides a rich briefing
4. Mention a change: "My deadline moved to next Monday" — see if she analyzes impact
5. Ask "Why have I been feeling tired?" — see if pattern detection finds correlations

These two systems — corrections + cross-context — are what make Aura feel like a genuine intelligence rather than a tool-calling chatbot.
