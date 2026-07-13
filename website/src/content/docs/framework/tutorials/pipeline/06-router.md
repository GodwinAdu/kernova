---
title: "Step 5: Build the Router"
description: "Create the orchestrator that connects all agents together."
---

# Step 5: Build the Router Agent

The Router is the **brain** of the system. It receives the user's request and decides:
- Which agent(s) to involve
- In what order
- What to pass between them

## Create the Router

Create `agents/router.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Content Pipeline',
  instructions: 'Route requests to the appropriate specialist agent.',

  // The router uses a custom handler — no LLM needed for routing
  handler: async (ctx) => {
    const input = ctx.input.toLowerCase();

    // ═══════════════════════════════════════════════════
    // Pattern 1: Full pipeline (research → analyze → write)
    // Triggered by: "write", "blog post", "article", "content"
    // ═══════════════════════════════════════════════════
    if (
      input.includes('write') ||
      input.includes('blog') ||
      input.includes('article') ||
      input.includes('content about')
    ) {
      // Tell the user what's happening
      ctx.emit('🔍 Starting research...');

      // Step 1: Research the topic
      const research = await ctx.delegate('researcher', 
        `Research this topic thoroughly. Find current data, expert opinions, and trends: ${ctx.input}`
      );

      ctx.emit('🧠 Analyzing findings...');

      // Step 2: Analyze the research
      const analysis = await ctx.delegate('analyzer',
        `Analyze these research findings. Extract key insights, identify trends, and provide recommendations:\n\n${research.content}`
      );

      ctx.emit('✍️ Writing content...');

      // Step 3: Write the final piece
      const article = await ctx.delegate('writer',
        `Write a polished blog post based on this analysis. Make it engaging and well-structured:\n\n${analysis.content}`
      );

      return article;
    }

    // ═══════════════════════════════════════════════════
    // Pattern 2: Research only
    // Triggered by: "research", "find out", "what's happening"
    // ═══════════════════════════════════════════════════
    if (
      input.includes('research') ||
      input.includes('find out') ||
      input.includes('what\'s happening') ||
      input.includes('latest news')
    ) {
      return await ctx.delegate('researcher', ctx.input);
    }

    // ═══════════════════════════════════════════════════
    // Pattern 3: Analysis only
    // Triggered by: "analyze", "what does this mean", "interpret"
    // ═══════════════════════════════════════════════════
    if (
      input.includes('analyze') ||
      input.includes('what does') ||
      input.includes('interpret') ||
      input.includes('insights')
    ) {
      return await ctx.delegate('analyzer', ctx.input);
    }

    // ═══════════════════════════════════════════════════
    // Pattern 4: Writing only
    // Triggered by: "rewrite", "improve", "make it better"
    // ═══════════════════════════════════════════════════
    if (
      input.includes('rewrite') ||
      input.includes('improve') ||
      input.includes('make it better') ||
      input.includes('edit this')
    ) {
      return await ctx.delegate('writer', ctx.input);
    }

    // ═══════════════════════════════════════════════════
    // Default: Show help
    // ═══════════════════════════════════════════════════
    return {
      content: `I'm a content pipeline with three specialist agents. Here's what I can do:

**Full Pipeline** (research → analyze → write):
• "Write a blog post about remote work trends"
• "Create an article about AI in healthcare"

**Research Only:**
• "Research the latest in quantum computing"
• "What's happening in the EV market?"

**Analysis Only:**
• "Analyze these market trends: [paste data]"
• "What does this data mean for businesses?"

**Writing Only:**
• "Rewrite this paragraph to be more engaging: [paste text]"
• "Make this email more professional: [paste text]"

What would you like me to help with?`
    };
  },
});
```

## Understanding the Handler

This agent uses a **custom handler** instead of LLM-based execution. Let's break it down:

### Why a custom handler for routing?

Using an LLM for routing is:
- Slow (500ms-2s for a routing decision)
- Expensive (tokens for a simple if/else)
- Unpredictable (might route wrong)

A code-based handler is:
- Instant (< 1ms)
- Free (no API calls)
- Deterministic (same input → same route)

For simple keyword-based routing, code beats AI. For complex, ambiguous routing, you could use an LLM.

### How `ctx.delegate` Works

```typescript
const research = await ctx.delegate('researcher', 'Research quantum computing');
```

This:
1. Sends `'Research quantum computing'` to the `researcher` agent
2. The researcher processes it (searches web, compiles findings)
3. Returns `{ content: "...", metadata: {...} }`
4. The router receives the result and can pass it to the next agent

`ctx.delegate` is the **key mechanism** for multi-agent communication.

### The `ctx.emit` Function

```typescript
ctx.emit('🔍 Starting research...');
```

This sends a partial update to the user's chat while the pipeline is working. Without it, the user would wait in silence for 30+ seconds while three agents process sequentially.

## The Data Flow

```
User: "Write a blog post about AI agents"
  │
  ▼ (Router receives)
  │
  ├─ ctx.emit("🔍 Starting research...")
  │
  ├─ ctx.delegate("researcher", "Research AI agents...")
  │   └─ Researcher searches web, returns findings
  │
  ├─ ctx.emit("🧠 Analyzing findings...")
  │
  ├─ ctx.delegate("analyzer", "Analyze these findings: ...")
  │   └─ Analyzer extracts insights, returns analysis
  │
  ├─ ctx.emit("✍️ Writing content...")
  │
  ├─ ctx.delegate("writer", "Write a blog post from: ...")
  │   └─ Writer produces polished article
  │
  └─ return article (sent to user)
```

## Test It

```bash
kernova dev
```

Open http://localhost:3000/chat and try:

1. **"Write a blog post about the future of remote work"**
   - Watch all three agents work in sequence
   - You should see the progress messages (🔍, 🧠, ✍️)
   - Final output is a polished article

2. **"Research what's happening with electric vehicles"**
   - Only the Researcher activates

3. **"Hello"**
   - Shows the help menu (no agents needed)

## What Just Happened

You built a system where **four files** create a complete content production pipeline:
- `router.agent.ts` — 0 tokens used (code-based routing)
- `researcher.agent.ts` — uses web search + LLM
- `analyzer.agent.ts` — uses LLM only
- `writer.agent.ts` — uses LLM only

Total: 3 LLM calls for a full research-to-article pipeline.

---

[Continue to Step 6: Test and Deploy →](/framework/tutorials/pipeline/07-deploy)
