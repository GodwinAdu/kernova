---
title: "Step 4: Build the Writer"
description: "Create an agent that turns analysis into polished, engaging content."
---

# Step 4: Build the Writer Agent

The Writer is the final stage. It takes structured analysis and produces content that people actually want to read.

## Create the Agent

Create `agents/writer.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Writer',
  model: 'gpt-4o',

  instructions: `
    You are a professional content writer. You receive analyzed information and
    transform it into compelling, well-structured content.

    WRITING STYLE:
    - Clear and concise — every word earns its place
    - Engaging opening that hooks the reader
    - Short paragraphs (2-3 sentences max)
    - Use bullet points and subheadings for scannability
    - Conversational but professional tone
    - End with a strong conclusion or call to action

    STRUCTURE FOR BLOG POSTS:
    1. Hook (opening paragraph that makes the reader curious)
    2. Context (why this matters right now)
    3. Main content (the insights, broken into sections)
    4. Practical implications (what the reader should do)
    5. Conclusion (memorable closing thought)

    RULES:
    - Include ALL key insights from the analysis — don't drop information
    - Cite sources where appropriate (in-line or footnotes)
    - Write for a professional audience that's intelligent but not expert
    - Avoid jargon unless you explain it
    - Use concrete examples and analogies
    - Length: aim for 800-1200 words unless told otherwise

    FORMATS YOU CAN PRODUCE:
    If the user or context specifies a format, use it:
    - "blog post" → standard article structure
    - "executive briefing" → bullet points, key takeaways
    - "social thread" → short, punchy posts (280 chars each)
    - "email newsletter" → personal, conversational
    - Default → blog post format
  `,

  memory: {
    type: 'conversational',
    ttl: '7d',
  },

  temperature: 0.8,  // Creative — we want engaging prose, not robotic text
});
```

## Why High Temperature for Writing?

`temperature: 0.8` means more variety, more creativity, more "voice." Compare:

**temperature 0.3 writing:**
> "AI agents grew in 2026. Companies adopted them. The market expanded."

**temperature 0.8 writing:**
> "2026 was the year AI agents stopped being science fiction and started showing up in your inbox, your support chat, and your team's Slack channels."

Higher temperature = more engaging prose. The risk is occasionally less consistent output, but for creative writing that's acceptable.

## The Agent Personality Spectrum

Our four agents have very different personalities:

| Agent | Temperature | Personality | Why |
|-------|------------|-------------|-----|
| Router | — | Logical, fast | Makes quick routing decisions |
| Researcher | 0.3 | Thorough, precise | Needs to find facts, not invent them |
| Analyzer | 0.3 | Skeptical, structured | Needs logical, evidence-based reasoning |
| Writer | 0.8 | Creative, engaging | Needs to produce compelling prose |

This is a design principle: **match the temperature to the task**.

## How the Writer Uses Context

The Writer receives the Analyzer's output as its input. It doesn't know about the Researcher directly — it only sees what the Analyzer produced.

```
Writer receives:
"## Executive Summary
 AI agents are transitioning from research to production...
 
 ## Key Insights
 1. Market grew 25% — businesses are investing heavily
 2. Open-source frameworks are driving adoption
 ..."

Writer produces:
"# The Year AI Agents Went Mainstream
 
 If 2025 was the year everyone talked about AI agents,
 2026 is the year they actually started working. And not
 just in Silicon Valley labs — in your company's support
 team, your marketing department, and your code reviews.
 
 Here's what happened, why it matters, and what it means
 for you..."
```

The Writer transforms **structured data** into **human-readable content**.

---

[Continue to Step 5: Build the Router →](/framework/tutorials/pipeline/06-router)
