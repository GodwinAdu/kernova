---
title: "Step 2: Build the Researcher"
description: "Create an agent that searches the web and compiles findings."
---

# Step 2: Build the Researcher Agent

The Researcher is the first agent in our pipeline. Its job: find accurate, current information on any topic.

## Create the Agent

Create `agents/researcher.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Researcher',
  model: 'gpt-4o',

  instructions: `
    You are a research specialist. Your only job is to find accurate, current,
    and relevant information on the topic you're given.

    HOW TO RESEARCH:
    1. Search the web for the most recent information
    2. Look for multiple sources to verify facts
    3. Focus on data, statistics, expert quotes, and concrete examples
    4. Note the source URL for everything you find
    5. Flag any conflicting information between sources

    OUTPUT FORMAT (always use this structure):
    
    ## Key Findings
    - [fact 1] (source: URL)
    - [fact 2] (source: URL)
    - ...

    ## Statistics & Data
    - [stat 1]
    - [stat 2]

    ## Expert Opinions
    - [quote or paraphrase] — [who said it]

    ## Source List
    1. [title] - [URL]
    2. [title] - [URL]

    ## Confidence Level
    [High/Medium/Low] — explain why

    ## Gaps
    - What couldn't you find? What needs more research?

    RULES:
    - Never make up facts or statistics
    - Always cite your sources
    - If you can't find good info, say so honestly
    - Prefer recent sources (last 12 months) over older ones
    - Search multiple times if the first search isn't enough
  `,

  tools: ['web-search'],

  memory: {
    type: 'persistent',
    ttl: '30d',  // Remember research for reuse
  },

  temperature: 0.3,  // Low — we want factual, not creative
});
```

## Why These Settings?

### `temperature: 0.3`
Research needs precision, not creativity. Low temperature means the model sticks closer to facts and is less likely to hallucinate.

### `memory: { type: 'persistent', ttl: '30d' }`
If someone asks about the same topic next week, the researcher can recall its previous findings without searching again. This saves API calls and time.

### The Instructions Structure
Notice how specific the instructions are:
- **Step-by-step process** (HOW TO RESEARCH) — tells the model exactly what to do
- **Output format** — ensures structured, parsable results
- **Rules** — prevents bad behavior (making up facts)

This is the difference between "Research AI" and "Find stuff about AI." Specific instructions = consistent, high-quality output.

## How It Uses Tools

When the Researcher gets a request like "Research quantum computing in 2026", here's what happens:

```
1. LLM reads the instructions + user's request
2. LLM decides: "I should search the web for this"
3. LLM calls: web-search({ query: "quantum computing breakthroughs 2026" })
4. Tool executes → returns search results
5. LLM reads results, maybe searches again with a different query
6. LLM compiles findings in the specified format
7. Response returned
```

The LLM **decides** when and how to use tools. You don't hardcode "always search" — the model figures it out based on the instructions.

## Test It Directly

Start the dev server:
```bash
kernova dev
```

You can test the researcher directly via curl (or PowerShell):

```bash
curl -X POST http://localhost:4555/agents/researcher \
  -H "Content-Type: application/json" \
  -d '{"input": "Research the current state of AI agents in 2026"}'
```

You should get a structured response with key findings, sources, and confidence level.

## What Makes a Good Research Agent

| Good Research Agent | Bad Research Agent |
|---|---|
| Searches multiple queries | Searches once and stops |
| Cites every claim | Makes unsourced assertions |
| Admits uncertainty | Presents guesses as facts |
| Structured output | Wall of unorganized text |
| Low temperature | High temperature (hallucinates) |

---

[Continue to Step 3: Build the Analyzer →](/framework/tutorials/pipeline/04-analyzer)
