---
title: Intents
description: Understand Intents — structured goals that replace raw prompts.
---

# Intents

An **Intent** is the core concept that makes Kernova different from raw LLM APIs. Instead of sending a text prompt and hoping for the best, you submit a structured goal that the system tracks, governs, and fulfills with evidence.

## The Problem with Prompts

When you call an LLM API directly:

```typescript
// Raw API call — no structure, no tracking, no governance
const response = await openai.chat.completions.create({
  messages: [{ role: 'user', content: 'Summarize this document' }],
});
```

You get text back. But you don't know:
- Was the answer correct?
- What information did it use?
- How long did it take?
- Did it stay within budget?
- Can I trace back why it said what it said?

## Intents Solve This

An Intent wraps your goal with structure:

```typescript
const result = await kernel.submit({
  goal: 'Summarize the quarterly report',
  intentType: 'analysis',
  priority: 'high',
  constraints: [
    { type: 'budget', description: 'Max 5000 tokens', hard: true },
  ],
});

// Result includes everything:
result.intentStatus    // 'completed'
result.result.success  // true
result.result.summary  // "The quarterly report shows revenue grew 23%..."
result.result.evidence // { sources: [...], confidence: 0.9, reasoning: "..." }
result.result.durationMs // 2340
```

## What Makes Intents Powerful

### 1. They're trackable

Every intent has a unique ID and a full lifecycle:

```
pending → planning → executing → completed
```

Each transition emits an event. You can query the entire history:

```typescript
const timeline = kernel.events.getTimeline(result.id);
// Shows: created, planning, executing, completed — with timestamps
```

### 2. They have constraints

Tell the system what's acceptable:

```typescript
constraints: [
  { type: 'budget', description: 'Max 5000 tokens', hard: true },
  { type: 'time', description: 'Complete within 10 seconds', hard: false },
  { type: 'quality', description: 'Confidence must be > 0.8', hard: true },
]
```

Hard constraints are enforced. Soft constraints are best-effort.

### 3. They produce evidence

You can always answer "why did the AI say that?":

```typescript
result.result.evidence = {
  sources: [
    { type: 'document', ref: 'quarterly-report.pdf', label: 'Q2 Report' },
    { type: 'memory', ref: 'mem_123', label: 'Company revenue history' },
  ],
  confidence: 0.92,
  reasoning: 'Analyzed 15 pages of the Q2 report using GPT-4o. Cross-referenced with stored company data.'
}
```

### 4. They decompose

Complex goals break into sub-intents:

```typescript
// Parent intent: "Write a blog post about AI trends"
//   ├── Child intent: "Research recent AI papers" (delegated to researcher agent)
//   ├── Child intent: "Write draft" (delegated to writer agent)
//   └── Child intent: "Review and edit" (delegated to editor agent)
```

Each sub-intent has its own timeline, evidence, and result.

### 5. They're governable

Before any intent executes:
- **Permissions checked** — Does this user have `intent:submit`?
- **Budget checked** — Is there token budget remaining?
- **Risk assessed** — Is this a high-risk action that needs approval?

## Intent Types

| Type | When to use | Example |
|------|-------------|---------|
| `query` | User wants information | "What's the weather?" |
| `action` | User wants something done | "Send an email to Bob" |
| `analysis` | User wants something analyzed | "Review this code for bugs" |
| `creation` | User wants something built | "Write a unit test for login()" |
| `workflow` | User wants a multi-step process | "Research, write, and publish an article" |
| `monitoring` | User wants ongoing observation | "Alert me if server errors spike" |
| `automation` | User wants recurring execution | "Summarize daily emails every morning" |

## Using Intents

### Simple (SDK)

```typescript
const { answer } = await app.ask('What is the capital of France?');
// Creates an intent behind the scenes, routes to an agent, returns the answer
```

### Full control (Core)

```typescript
const intent = await kernel.submit({
  goal: 'Analyze sales data for anomalies',
  intentType: 'analysis',
  priority: 'high',
  owner: 'user_123', // Permission checked against this identity
});
```

## What Happens When You Submit

1. **Validation** — Is the goal non-empty? Is the type valid?
2. **Permission check** — Does the owner have `intent:submit`?
3. **Budget check** — Is there remaining token budget?
4. **Agent selection** — Kernel scores agents and picks the best fit
5. **Context computation** — Relevant memories assembled
6. **Execution** — Agent processes with LLM + tools + memory
7. **Result assembly** — Response + evidence + duration
8. **Event emission** — Full lifecycle recorded
9. **Cleanup** — Active intent removed from tracking

All of this happens in a single `await kernel.submit()` call.
