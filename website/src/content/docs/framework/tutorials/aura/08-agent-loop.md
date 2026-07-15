---
title: Agent Loops
description: Enable iterative execution — agents keep working until complex goals are fully achieved.
---

## What You'll Build

Agent loops that let Aura handle multi-step tasks autonomously. Instead of a single response, she'll think, act, evaluate, and repeat until the goal is complete. "Reply to all my unread emails" becomes a real action — not a suggestion.

## The Problem

Without loops, every user message gets one response cycle:

```
User: "Reply to all unread emails"
Agent: [calls gmail search] "You have 5 unread emails. Would you like me to reply to each one?"
```

That's unhelpful. The user said "reply to all" — they want *action*, not a question.

## The Solution: Think → Act → Evaluate → Repeat

With loops enabled, the agent continues working:

```
User: "Reply to all unread emails"
Agent:
  Step 1: Search unread emails → found 5
  Step 2: Read email #1 (from John about meeting)
  Step 3: Reply to John: "Thanks, I'll be there at 3pm"
  Step 4: Read email #2 (from Sarah about project)
  Step 5: Reply to Sarah: "Great progress! Let's sync tomorrow"
  ... continues until all are handled
  Final: "Done! Replied to 3 emails from real people, archived 2 automated ones."
```

## Enable Loops

Add the `loop` config to your agent definition in `agents/assistant.agent.ts`:

```typescript
export default defineAgent({
  name: 'Aura',
  // ... instructions, tools, etc.

  loop: {
    enabled: true,
    maxIterations: 10,         // Maximum steps before stopping
    timeout: 120000,           // 2 minute max (prevents runaway loops)
    completionThreshold: 0.7,  // How "done" the task needs to feel
    streamSteps: true,         // Show progress in real-time
    allowDelegation: true,     // Can delegate within loops
  },

  // ... rest of config
});
```

### What Each Setting Does

- **`maxIterations: 10`** — Safety cap. Most tasks complete in 3-5 steps. If it hits 10, something is wrong.
- **`timeout: 120000`** — Hard time limit. Even if iterations remain, stop after 2 minutes.
- **`completionThreshold: 0.7`** — The agent self-evaluates after each step. When it's 70%+ confident the task is done, it stops.
- **`streamSteps: true`** — Each step streams to the frontend so the user sees progress.
- **`allowDelegation: true`** — The agent can delegate to specialists mid-loop.

## How the Loop Decides When to Activate

Not every message needs a loop. "What's the weather?" is a single tool call. "Reply to all emails" is iterative.

The framework evaluates complexity based on:

1. **Multiple entities** — "all emails", "each task", "every meeting"
2. **Sequential dependencies** — need to read before replying
3. **Action verbs** — "reply", "update", "fix", "process"
4. **Implied iteration** — "clean up my inbox", "organize my notes"

Simple questions and casual chat skip the loop entirely.

## Example Walkthrough: "Reply to all unread emails"

Here's what happens internally:

```
┌─────────────────────────────────────────────┐
│ ITERATION 1                                  │
│ Think: Need to find unread emails first      │
│ Act:   gmail(action:"search", query:"is:unread newer_than:1d") │
│ Result: Found 4 unread emails                │
│ Evaluate: 0% done — haven't replied yet      │
└─────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────┐
│ ITERATION 2                                  │
│ Think: Read first email to understand context│
│ Act:   gmail(action:"read", messageId:"abc") │
│ Result: John asking about Friday meeting     │
│ Evaluate: 10% done — read 1, need to reply  │
└─────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────┐
│ ITERATION 3                                  │
│ Think: Reply to John confirming attendance   │
│ Act:   gmail(action:"reply", messageId:"abc",│
│         body:"Hey John! Yes, Friday works...") │
│ Result: Reply sent ✅                        │
│ Evaluate: 25% done — 1 of 4 handled         │
└─────────────────────────────────────────────┘
        │
        ... (continues for remaining emails)
        │
┌───────▼─────────────────────────────────────┐
│ ITERATION 7                                  │
│ Think: All real emails replied to, 2 were    │
│        newsletters (archived silently)       │
│ Evaluate: 95% done → exceeds threshold → STOP│
│ Final response to user                       │
└─────────────────────────────────────────────┘
```

## Safeguards

Loops are powerful but need guardrails:

```typescript
loop: {
  maxIterations: 10,    // Never more than 10 steps
  timeout: 120000,      // Kill after 2 minutes regardless
}
```

**Why these limits matter:**
- A bug in tool output could cause infinite retries
- API rate limits could slow everything down
- The user shouldn't wait forever for a result

If the loop hits max iterations, Aura reports what she accomplished and what's remaining.

## The Evaluation Prompt

After each iteration, the framework asks the agent:

> "Based on the original goal and your progress so far, estimate completion (0.0 to 1.0). If above threshold, summarize what was accomplished."

The agent responds with a confidence score. When it crosses `completionThreshold`, the loop terminates and the final response goes to the user.

## Streaming Loop Progress

With `streamSteps: true`, each iteration streams to the frontend. The user sees:

```
Aura: Checking your inbox...
      Found 4 unread emails.
      Reading email from John...
      ✅ Replied to John about the meeting.
      Reading email from Sarah...
      ✅ Replied to Sarah about the project update.
      Archived 2 newsletter emails.
      Done! Replied to 2 emails and archived 2 newsletters.
```

This gives transparency — the user knows what's happening without waiting for a single massive response.

## Testing Loops

```bash
kernova dev
```

Try these multi-step commands:

```
"Reply to all my unread emails"
"Check my calendar for this week and set reminders for each meeting"
"Search my notes for all my goals and give me a progress report"
"Archive all newsletters in my inbox from the past week"
```

Watch the terminal for loop execution:

```
[loop] Starting iterative execution (max: 10, timeout: 120s)
[loop] Iteration 1: gmail.search → 4 results
[loop] Iteration 2: gmail.read → email content
[loop] Iteration 3: gmail.reply → sent ✅
[loop] Iteration 4: gmail.read → email content
[loop] Iteration 5: gmail.reply → sent ✅
[loop] Iteration 6: gmail.batchArchive → 2 archived
[loop] Completed in 6 iterations (confidence: 0.92)
```

## Exercise

1. Enable loops and try "Reply to all unread emails" — watch the terminal for each step
2. Try "Check my calendar and prepare for each meeting today"
3. Set `maxIterations: 3` and try a complex task — see how the agent handles hitting the limit
4. Experiment with `completionThreshold` — what happens at 0.9 vs 0.5?
5. Try a loop that involves delegation: "Research AI trends and write a blog post about it"

Next: we'll make Aura proactive with autonomous triggers.
