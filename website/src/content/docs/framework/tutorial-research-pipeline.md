---
title: "Tutorial: Research & Content Pipeline"
description: "Build a multi-agent system that researches topics, analyzes findings, and generates content."
---

# Tutorial: Research & Content Pipeline

**Difficulty:** Intermediate  
**Time:** 30 minutes  
**What you'll build:** A multi-agent pipeline where a Researcher finds information, an Analyzer extracts insights, and a Writer produces polished content.

## What You'll Learn

- Multi-agent architecture (delegation)
- Custom tools with API integration
- Workflow-based execution
- Handling agent pipelines
- Router pattern for directing requests

## Step 1: Create the Project

```bash
npx create-kernova-app content-pipeline --template multi-agent
cd content-pipeline
```

## Step 2: Define the Researcher Agent

```typescript
// agents/researcher.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Researcher',
  model: 'gpt-4o',
  instructions: `
    You are a research specialist. Your job is to find accurate, current information on any topic.
    
    APPROACH:
    1. Search the web for the most recent and relevant sources
    2. Verify information across multiple sources when possible
    3. Cite your sources with URLs
    4. Focus on facts, statistics, and expert opinions
    5. Note any conflicting information you find
    
    OUTPUT FORMAT:
    Always structure your findings as:
    - Key Facts (bullet points)
    - Sources (with URLs)
    - Confidence Level (high/medium/low)
    - Areas needing more research
  `,
  tools: ['web-search'],
  memory: { type: 'persistent', ttl: '30d' },
});
```

## Step 3: Define the Analyzer Agent

```typescript
// agents/analyzer.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Analyzer',
  model: 'gpt-4o',
  instructions: `
    You are an analytical expert. You take raw research and extract meaningful insights.
    
    YOUR PROCESS:
    1. Read the research findings carefully
    2. Identify patterns, trends, and key themes
    3. Assess the reliability of the information
    4. Draw conclusions supported by evidence
    5. Identify gaps or areas of uncertainty
    
    OUTPUT FORMAT:
    - Executive Summary (2-3 sentences)
    - Key Insights (numbered, with supporting evidence)
    - Implications (what this means practically)
    - Recommendations (actionable next steps)
  `,
  memory: { type: 'conversational', ttl: '7d' },
  temperature: 0.3, // More analytical, less creative
});
```

## Step 4: Define the Writer Agent

```typescript
// agents/writer.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Writer',
  model: 'gpt-4o',
  instructions: `
    You are a professional content writer. You transform analysis into engaging, readable content.
    
    STYLE:
    - Clear, concise, and engaging
    - Use short paragraphs and bullet points
    - Include compelling headlines and subheadings
    - Write for a professional but accessible audience
    - End with a strong conclusion or call to action
    
    FORMATS YOU CAN PRODUCE:
    - Blog posts
    - Executive briefings
    - Social media threads
    - Email newsletters
    - Technical documentation
    
    Always ask what format is desired if not specified.
  `,
  memory: { type: 'conversational', ttl: '7d' },
  temperature: 0.8, // More creative
});
```

## Step 5: Define the Router Agent

```typescript
// agents/router.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Pipeline Router',
  instructions: `You route requests to the right specialist.`,
  handler: async (ctx) => {
    const input = ctx.input.toLowerCase();

    // Full pipeline: research → analyze → write
    if (input.includes('write about') || input.includes('blog post') || input.includes('article')) {
      ctx.emit('Starting research pipeline...');
      
      // Step 1: Research
      const research = await ctx.delegate('researcher', `Research this topic thoroughly: ${ctx.input}`);
      
      // Step 2: Analyze
      const analysis = await ctx.delegate('analyzer', `Analyze these research findings and extract key insights:\n\n${research.content}`);
      
      // Step 3: Write
      const article = await ctx.delegate('writer', `Write a polished blog post based on this analysis:\n\n${analysis.content}`);
      
      return article;
    }

    // Just research
    if (input.includes('research') || input.includes('find out')) {
      return await ctx.delegate('researcher', ctx.input);
    }

    // Just analyze
    if (input.includes('analyze') || input.includes('what does this mean')) {
      return await ctx.delegate('analyzer', ctx.input);
    }

    // Just write
    if (input.includes('rewrite') || input.includes('make it better')) {
      return await ctx.delegate('writer', ctx.input);
    }

    // Default: use as general assistant
    return { content: "I can help you research topics, analyze information, and write content. Try:\n\n• \"Write a blog post about AI agents in 2026\"\n• \"Research the latest trends in cloud computing\"\n• \"Analyze this data and give me insights\"" };
  },
});
```

## Step 6: Update the Chat Page

In `app/chat/page.tsx`, change the agent name:

```typescript
const { messages, send, isStreaming, streamingContent } = useAgentStream('router');
```

## Step 7: Test the Pipeline

```bash
kernova dev
```

Open http://localhost:3000/chat and try:

**"Write a blog post about the future of AI agents in business"**

Watch as:
1. Router delegates to Researcher → searches the web
2. Researcher's findings go to Analyzer → extracts insights
3. Analyzer's insights go to Writer → produces a polished article

## Step 8: Add a Workflow (Optional)

For guaranteed execution with checkpointing:

```typescript
// workflows/content-pipeline.ts
import { defineWorkflow } from '@kernova/framework';

export default defineWorkflow({
  name: 'content-pipeline',
  description: 'Research → Analyze → Write pipeline',
  steps: [
    {
      name: 'research',
      execute: async (ctx) => {
        // Research step
        ctx.log('Researching topic...');
        return { findings: 'Research results here' };
      },
    },
    {
      name: 'analyze',
      execute: async (ctx) => {
        const research = ctx.previous.research;
        ctx.log('Analyzing findings...');
        return { insights: 'Analysis here' };
      },
    },
    {
      name: 'write',
      execute: async (ctx) => {
        const analysis = ctx.previous.analyze;
        ctx.log('Writing content...');
        return { article: 'Final article here' };
      },
    },
    {
      name: 'publish',
      requiresApproval: true, // Human reviews before publishing
      description: 'Publish the article to the blog',
      execute: async (ctx) => {
        const article = ctx.previous.write;
        ctx.log('Publishing...');
        return { published: true };
      },
    },
  ],
});
```

## What You Built

✅ 4 specialized agents working together  
✅ Router pattern for intelligent delegation  
✅ Multi-step pipeline (research → analyze → write)  
✅ Durable workflow with approval gate  
✅ Each agent has its own personality and temperature  

## Key Patterns Learned

1. **Delegation**: `ctx.delegate('agentName', input)` passes work between agents
2. **Router**: A handler-based agent that decides which specialist to use
3. **Pipeline**: Sequential processing where each agent builds on the previous
4. **Approval Gate**: Human reviews sensitive steps before execution
