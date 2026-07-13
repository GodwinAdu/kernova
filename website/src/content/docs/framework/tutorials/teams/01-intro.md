---
title: "Multi-Agent Teams: Introduction"
description: "Build a team of AI agents that collaborate like a real development team."
---

# Tutorial: Build a Multi-Agent Coding Team

In this tutorial, you'll build a team of AI agents that work together like a real software development team:

- **Senior Developer** (Lead) — Decomposes tasks, assigns work, reviews code
- **Frontend Developer** — Builds React components, handles UI/UX
- **Backend Developer** — Builds APIs, database schemas, server logic
- **QA Engineer** — Writes tests, finds bugs, verifies quality

When you give the team a task like "Build a user profile page," the senior dev breaks it down, assigns parts to the frontend and backend devs, collects their output, has the QA engineer verify it, and returns the final result.

---

## What You'll Learn

- How to define multiple specialized agents
- How to create a team with `defineTeam()`
- How hierarchical delegation works
- How to use the shared workspace
- How to track progress with `useTeam()` in React
- How to deploy a multi-agent app

---

## Prerequisites

- Node.js 18+
- An OpenAI API key (or any supported provider)
- Basic TypeScript knowledge
- Completed the [Support Bot tutorial](/framework/tutorial/01-setup) (recommended, not required)

---

## What We're Building

```
User: "Build a todo list app with CRUD operations"
  ↓
[senior-dev] Breaks it down:
  → frontend-dev: "Build TodoList and TodoItem components with add/edit/delete"
  → backend-dev: "Build REST API: GET/POST/PUT/DELETE /api/todos with Prisma"
  → tester: "Write tests for the todo CRUD operations"
  ↓
[frontend-dev] Returns React component code
[backend-dev] Returns API route code
[tester] Returns test file code
  ↓
[senior-dev] Reviews all code, combines, returns final answer
```

The entire flow happens automatically — you just provide the goal.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Kernova Framework                    │
│                                                     │
│  ┌─────────────┐      ┌──────────────────────┐    │
│  │  Frontend    │      │   Agent Server       │    │
│  │  (Next.js)  │─────→│   (port 4555)        │    │
│  │             │      │                      │    │
│  │  useTeam()  │←─SSE─│  Team Executor       │    │
│  └─────────────┘      │    │                 │    │
│                        │    ├→ senior-dev     │    │
│                        │    ├→ frontend-dev   │    │
│                        │    ├→ backend-dev    │    │
│                        │    └→ tester         │    │
│                        │                      │    │
│                        │  Shared Workspace    │    │
│                        └──────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

[Continue to Step 1: Project Setup →](/framework/tutorials/teams/02-setup)
