---
title: "Step 3: Build the Analyzer"
description: "Create an agent that extracts insights and patterns from research."
---

# Step 3: Build the Analyzer Agent

The Analyzer takes raw research and turns it into **actionable insights**. It's the bridge between "here are facts" and "here's what they mean."

## Create the Agent

Create `agents/analyzer.agent.ts`:

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Analyzer',
  model: 'gpt-4o',

  instructions: `
    You are an analytical expert. You receive research findings and your job is to:
    1. Identify patterns and trends across the data
    2. Assess the reliability and significance of each finding
    3. Draw conclusions that are supported by evidence
    4. Provide actionable implications
    5. Note any biases or gaps in the research

    YOUR ANALYTICAL PROCESS:
    - Read all findings carefully
    - Group related facts together (identify themes)
    - Look for cause-and-effect relationships
    - Compare data points for consistency
    - Distinguish between correlation and causation
    - Consider what's missing (what SHOULD have been found but wasn't)

    OUTPUT FORMAT:

    ## Executive Summary
    [2-3 sentences capturing the main takeaway]

    ## Key Insights
    1. [Insight] — supported by: [evidence from the research]
    2. [Insight] — supported by: [evidence]
    3. ...

    ## Trends Identified
    - [Trend 1]: [explanation + supporting data]
    - [Trend 2]: [explanation + supporting data]

    ## Implications
    - For businesses: [what this means practically]
    - For developers: [what this means for them]
    - For the industry: [bigger picture]

    ## Recommendations
    1. [Actionable recommendation based on the analysis]
    2. [Another recommendation]

    ## Confidence Assessment
    - Strong claims (high evidence): [list]
    - Tentative claims (needs more data): [list]

    RULES:
    - Never add information that wasn't in the research
    - Clearly distinguish between facts and your interpretations
    - If the research is insufficient, say so
    - Be skeptical of outlier claims without multiple sources
  `,

  memory: {
    type: 'conversational',
    ttl: '7d',
  },

  temperature: 0.3,  // Analytical = precise
});
```

## Why the Analyzer Doesn't Have Tools

Notice: no `tools` field. The Analyzer doesn't search the web or call APIs. Its job is purely **intellectual** — take input and think about it.

This is intentional:
- The Researcher **gathers** (uses tools)
- The Analyzer **thinks** (pure reasoning)
- The Writer **creates** (pure generation)

Separating "gather" from "think" from "create" produces better results than one agent trying to do all three.

## The Role of Temperature

`temperature: 0.3` for analysis means:
- Consistent interpretations (same data → same insights)
- Less likely to make creative leaps without evidence
- More reliable for business decisions

If you were building a creative brainstorming agent, you'd use 0.9. But analysis needs precision.

## How It Fits in the Pipeline

```
Researcher output: "Quantum computing market grew 25% in 2026.
                    Google achieved 100-qubit stability.
                    IBM announced commercial quantum services."
        │
        ▼
Analyzer processes: "The industry is moving from research to
                     commercialization. Growth rate suggests
                     mainstream adoption within 3-5 years.
                     Key implication: businesses should start
                     planning quantum strategies now."
        │
        ▼
Writer receives: structured insights to turn into a compelling article
```

Each stage **adds value**. The researcher finds facts. The analyzer finds meaning. The writer makes it readable.

---

[Continue to Step 4: Build the Writer →](/framework/tutorials/pipeline/05-writer)
