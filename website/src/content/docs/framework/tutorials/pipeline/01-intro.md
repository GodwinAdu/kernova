---
title: "Research Pipeline — Introduction"
description: "Build a multi-agent system where specialists collaborate to produce content."
---

# Build a Research & Content Pipeline

**Difficulty:** Intermediate  
**Time:** 30-40 minutes  
**Prerequisites:** Complete the Personal Assistant tutorial first

## What We're Building

A system with **four specialized AI agents** working together:

```
User: "Write a blog post about quantum computing in 2026"
  ↓
Router Agent (decides who handles it)
  ↓
Researcher Agent (searches the web, gathers facts)
  ↓
Analyzer Agent (extracts insights, finds patterns)
  ↓
Writer Agent (produces polished content)
  ↓
Result: A complete, well-researched blog post
```

Each agent has a specific role, personality, and skill set. They **delegate** work to each other — just like a real content team.

## Why Multi-Agent?

You could put everything in one agent's instructions. But there are good reasons to split:

1. **Specialization** — Each agent is optimized for its task. The Researcher is thorough and factual. The Writer is creative and engaging. One prompt can't do both well.

2. **Separation of concerns** — If the output is bad, you know which agent to fix. Was the research wrong? Or was the writing poor?

3. **Reusability** — The Researcher can be used by other pipelines (not just content). The Writer can be used for emails, not just blog posts.

4. **Cost efficiency** — You can use a cheaper model for simple routing and an expensive model for complex writing.

## What You'll Learn

- **Multi-agent architecture** — How agents talk to each other
- **The Router pattern** — A central agent that decides who handles what
- **Delegation** — `ctx.delegate('agent-name', input)` 
- **Custom tools** — Real web search integration
- **Agent personalities** — Different temperatures, different instructions
- **Pipeline execution** — Sequential processing where each agent builds on the previous

## The Architecture

```
┌──────────────────────────────────────────────────┐
│                  User's Request                    │
│       "Write a blog post about AI agents"        │
└─────────────────────────┬────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────┐
│                Router Agent                        │
│  Decides: This needs full pipeline                │
│  (research → analyze → write)                     │
└─────────────────────────┬────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌────────────────┐ ┌────────────┐ ┌────────────────┐
│   Researcher   │ │  Analyzer  │ │    Writer       │
│ • Searches web │ │ • Patterns │ │ • Clear prose   │
│ • Cites sources│ │ • Insights │ │ • Engaging      │
│ • Factual      │ │ • Logical  │ │ • Structured    │
│ temp: 0.3      │ │ temp: 0.3  │ │ temp: 0.8       │
└────────────────┘ └────────────┘ └────────────────┘
```

## Let's Start

[Continue to Step 1: Create the Project →](/framework/tutorials/pipeline/02-setup)
