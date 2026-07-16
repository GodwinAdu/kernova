---
title: "Agent Loops"
description: "Build agents that keep working until the goal is fully achieved — batch mode for multi-step tasks using native tool-calling."
---

# Agent Loops (Batch Mode)

By default, an agent responds in a single pass — one LLM call that may invoke tools, then a response. But real-world tasks often require processing multiple items: replying to all emails, archiving newsletters, or setting up projects with multiple milestones.

**Batch Mode** enhances the agent's prompt so it calls tools multiple times in sequence until the entire task is done — using GPT-4o's native function calling (not a custom loop).

## How It Works

When a batch task is detected, Kernova adds a `[BATCH TASK MODE]` instruction to the prompt:

```
[BATCH TASK MODE]
The user wants you to perform a multi-step batch operation.
IMPORTANT: Call tools MULTIPLE TIMES in sequence to complete ALL items.
Do NOT stop after one tool call. Keep calling tools until the ENTIRE task is done.
After processing all items, provide a final summary of what was done.
```

The kernel's native tool-calling loop (up to 10 iterations) then handles the execution:

```
LLM: "I'll search for unread emails" → calls gmail(search)
Kernel: feeds result back to LLM
LLM: "Found 3 emails. Reading first one" → calls gmail(read, id1)
Kernel: feeds result back
LLM: "Replying to first email" → calls gmail(reply, id1, body)
Kernel: feeds result back
LLM: "Reading second email" → calls gmail(read, id2)
... continues until all items processed ...
LLM: "Done! I replied to 2 emails and skipped 1 promotional."
```

No custom JSON parsing. No confidence scoring. Just GPT-4o doing what it's designed to do — calling tools iteratively until it's satisfied.

## Quick Start

Add `loop` to your agent definition:

```typescript
// agents/assistant.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Assistant',
  instructions: 'You are a helpful AI assistant...',
  tools: ['gmail', 'calendar', 'web-search'],
  loop: {
    enabled: true,
    maxIterations: 10,
  },
});
```

## What Triggers Batch Mode

The framework automatically detects batch tasks using pattern matching. Only explicit batch-action commands trigger it:

✅ **Triggers batch mode:**
- "reply to all unread emails"
- "archive all newsletters"
- "mark all as read"
- "clean up my inbox"
- "delete all spam"
- "set up a project with 3 milestones"
- "forward this to everyone on the team"

❌ **Does NOT trigger batch mode (single-pass):**
- "what are my health goals?" (question → recall)
- "help me plan my week" (delegation)
- "send an email to John" (one tool call)
- "what's the weather" (one tool call)
- "hi" / "thanks" / short messages

The detection logic checks for:
- Batch keywords: "all", "every", "each" + action verbs
- Cleanup patterns: "clean up", "organize" + target
- Multi-item creation: "set up X with N items"
- Message length > 20 characters and > 4 words
- NOT triggered for questions (what/how/why/when/where/who)

## Configuration

```typescript
loop: {
  /** Enable batch mode (default: false) */
  enabled: true,

  /** Max tool-calling iterations (default: 10) */
  maxIterations: 10,

  /** Max total execution time in ms (default: 120000 = 2 min) */
  timeout: 120000,

  /** Confidence threshold (used for future improvements) */
  completionThreshold: 0.7,

  /** Stream progress to client (default: true) */
  streamSteps: true,

  /** Allow delegation to other agents (default: true) */
  allowDelegation: true,
}
```

## Examples

### Reply to All Unread Emails

**User:** "Reply to all unread emails from today"

**Execution (native tool-calling):**
```
→ gmail(search, "is:unread newer_than:1d") → Found 3 emails
→ gmail(read, id1) → Email from Albert about design
→ gmail(reply, id1, "Thanks Albert! I'll review the thumbnails.")
→ gmail(read, id2) → Promotional from Samsung
→ (skips — promotional, no reply needed)
→ gmail(read, id3) → SyncBooks financial report
→ gmail(reply, id3, "Thanks for flagging this. I'll look into it.")
→ Final response: "Done! Replied to 2 of 3 emails. Skipped Samsung promotional."
```

### Clean Up Inbox

**User:** "Archive all newsletters and mark the rest as read"

**Execution:**
```
→ gmail(search, "category:promotions OR label:newsletters")
→ gmail(batchArchive, "id1,id2,id3,id4")
→ gmail(search, "is:unread")
→ gmail(batchRead, "id5,id6,id7")
→ "Done! Archived 4 newsletters and marked 3 remaining emails as read."
```

### Project Setup

**User:** "Set up a new project called API-Gateway with 3 milestones on GitHub"

**Execution:**
```
→ github(createIssue, "API-Gateway", "Milestone 1: Core routing")
→ github(createIssue, "API-Gateway", "Milestone 2: Auth middleware")
→ github(createIssue, "API-Gateway", "Milestone 3: Rate limiting")
→ "Created 3 milestone issues on GodwinAdu/API-Gateway."
```

## Error Recovery

If a tool call fails during batch execution:
1. The error is fed back to the LLM as a tool result
2. The LLM decides: retry with different params, skip the item, or stop
3. If the entire execution fails, the framework falls back to single-pass mode

## Batch Mode vs Single-Pass

| Feature | Single-Pass (default) | Batch Mode |
|---------|----------------------|-----------|
| Tool calls | 1-3 (parallel or sequential) | Up to 10 in sequence |
| Trigger | All normal messages | Explicit batch commands only |
| Prompt | Standard agent instructions | Enhanced with batch directive |
| Duration | 2-8 seconds | 10-60 seconds |
| Token cost | Normal | Higher (more back-and-forth) |

## Technical Details

Batch mode uses the kernel's existing `completeWithToolLoop` (in `AgentRegistry`) which:
1. Sends the prompt + tools to the LLM
2. If LLM returns tool calls → executes them, feeds results back
3. Repeats until LLM produces a final text response (no more tool calls)
4. Maximum 10 iterations (prevents runaway)

This is the same mechanism that handles single-pass tool calling — the batch prompt just instructs the LLM to be more iterative.

## Best Practices

- Keep `maxIterations` at 10 for most cases (enough for batches of 5-8 items)
- The LLM will naturally stop when done — you rarely hit the max
- For very large batches (50+ emails), consider breaking into chunks
- Monitor costs — each iteration is an LLM call
- Batch mode works best with clear, specific commands ("reply to all" vs "handle my emails")
