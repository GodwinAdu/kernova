---
title: "Teams & Delegation"
description: "Define teams of specialized agents that collaborate, delegate, and share state."
---

# Teams & Delegation

`defineTeam()` lets you create a team of agents that work together on complex tasks. Instead of writing manual orchestration logic, you declare who's on the team, what they're good at, and how tasks should flow — the framework handles the rest.

---

## Quick Start

### 1. Define Your Agents

```typescript
// agents/senior-dev.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'senior-dev',
  instructions: `You are a senior full-stack developer and tech lead.
    You excel at system design, code review, and architectural decisions.
    When reviewing code, focus on: correctness, performance, readability, and security.
    Be specific and constructive in feedback.`,
  model: 'gpt-4o',
  temperature: 0.3,
});
```

```typescript
// agents/frontend-dev.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'frontend-dev',
  instructions: `You are a frontend developer specializing in React, TypeScript, and Tailwind CSS.
    Write clean, accessible, responsive code. Use shadcn/ui components.
    Always include proper TypeScript types. Follow React best practices.`,
  model: 'gpt-4o',
});
```

```typescript
// agents/backend-dev.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'backend-dev',
  instructions: `You are a backend developer specializing in Node.js, Prisma, and PostgreSQL.
    Build secure, performant APIs. Always validate input. Use proper error handling.
    Follow RESTful conventions. Include database migrations when needed.`,
  model: 'gpt-4o',
});
```

```typescript
// agents/tester.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'tester',
  instructions: `You are a QA engineer. Write comprehensive tests using Jest and Playwright.
    Cover happy paths, edge cases, and error states.
    Verify accessibility. Check for security vulnerabilities.
    Report any issues you find in the code provided.`,
  model: 'gpt-4o',
});
```

### 2. Define the Team

```typescript
// agents/teams/dev-team.ts
import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Dev Team',
  description: 'Full-stack development team for building features',
  strategy: 'hierarchical',
  members: [
    {
      agent: 'senior-dev',
      role: 'lead',
      description: 'Decomposes tasks, assigns work, reviews all code',
      canDelegate: true,
      canApprove: true,
    },
    {
      agent: 'frontend-dev',
      role: 'member',
      description: 'Builds React components and UI',
      specialization: ['react', 'typescript', 'css', 'tailwind', 'ui', 'accessibility'],
    },
    {
      agent: 'backend-dev',
      role: 'member',
      description: 'Builds APIs, database schemas, server logic',
      specialization: ['node', 'api', 'database', 'prisma', 'auth', 'rest'],
    },
    {
      agent: 'tester',
      role: 'reviewer',
      description: 'Writes tests and verifies quality',
      specialization: ['testing', 'jest', 'playwright', 'qa'],
      canApprove: true,
    },
  ],
  maxDelegationDepth: 4,
  taskTimeout: 300000, // 5 minutes
});
```

### 3. Execute a Team Task

```bash
kernova dev
```

Then from your frontend or API:

```bash
curl -X POST http://localhost:4555/v1/teams/dev-team/execute \
  -H "Content-Type: application/json" \
  -d '{"goal": "Build a user settings page with password change and profile photo upload"}'
```

The team lead decomposes the task, assigns frontend and backend work, collects results, reviews them, and returns the final output.

---

## API Reference

### `defineTeam(definition)`

```typescript
import { defineTeam } from '@kernova/framework';

defineTeam({
  // Required
  name: string;
  strategy: 'hierarchical' | 'sequential' | 'pipeline' | 'collaborative' | 'round-robin' | 'broadcast';
  members: TeamMemberDefinition[]; // Minimum 2

  // Optional
  description?: string;
  maxDelegationDepth?: number;  // Default: 5
  taskTimeout?: number;         // Default: 300000 (5 min)
  maxRetries?: number;          // Default: 2
  requireLeadApproval?: boolean; // Default: true for hierarchical
  workspace?: {
    persistent?: boolean;       // Default: false
    maxEntries?: number;        // Default: 500
  };
});
```

### `TeamMemberDefinition`

```typescript
{
  agent: string;        // Must match a defineAgent file name
  role: 'lead' | 'member' | 'reviewer' | 'specialist';
  description?: string; // What this member does (shown to lead for task assignment)
  specialization?: string[]; // Keywords for smart routing
  canDelegate?: boolean;     // Can this agent delegate to others?
  canApprove?: boolean;      // Can this agent approve work?
  maxConcurrentTasks?: number; // Default: 3
}
```

---

## Strategies Deep Dive

### Hierarchical (Recommended for Most Cases)

```typescript
strategy: 'hierarchical'
```

**Flow:** Lead decomposes → assigns to specialists → reviews results → returns final output

```
[Lead] "Build a login page"
  → Decomposes into:
    [frontend-dev] "Build LoginForm component"
    [backend-dev] "Build POST /api/auth/login endpoint"
    [tester] "Write login tests"
  → Collects all results
  → Reviews and synthesizes
  → Returns final cohesive answer
```

**Requires:** At least one member with `role: 'lead'`

### Sequential

```typescript
strategy: 'sequential'
```

**Flow:** First member processes → passes output to next → next builds on it → ...

```
[member-1] Works on original goal → produces output
[member-2] Receives member-1's output → builds on it
[member-3] Receives member-2's output → produces final result
```

**Good for:** Approval chains, iterative refinement

### Pipeline

```typescript
strategy: 'pipeline'
```

**Flow:** Similar to sequential, but each member has a defined role in the pipeline

```
Step 1/3 [researcher] INPUT: "AI trends" → OUTPUT: raw data
Step 2/3 [analyzer] INPUT: raw data → OUTPUT: insights
Step 3/3 [writer] INPUT: insights → OUTPUT: final report
```

**Good for:** Data processing, content creation, ETL

### Collaborative

```typescript
strategy: 'collaborative'
```

**Flow:** Lead coordinates, but any agent can delegate to any other agent freely

```
[Lead] Gets the goal, may delegate or work directly
  → Can delegate to any member
  → Members can delegate to each other
  → Lead produces final result
```

**Good for:** Creative work, complex problems, brainstorming

### Round-Robin

```typescript
strategy: 'round-robin'
```

**Flow:** Goal is split into equal parts, distributed evenly across members

```
Goal split into 4 parts:
  [member-1] Part 1
  [member-2] Part 2
  [member-3] Part 3
  [member-4] Part 4
Results combined
```

**Good for:** Parallel processing, workload distribution

### Broadcast

```typescript
strategy: 'broadcast'
```

**Flow:** All agents independently work on the same goal, best result selected

```
[agent-1] Works on goal → result A
[agent-2] Works on goal → result B
[agent-3] Works on goal → result C
[lead] Reviews A, B, C → picks best or synthesizes
```

**Good for:** Quality optimization, getting diverse approaches

---

## Shared Workspace

All team members share a workspace — a key-value store for structured data:

```typescript
// In any agent handler:
export default defineAgent({
  name: 'backend-dev',
  instructions: '...',
  handler: async (ctx) => {
    // Read shared data
    const requirements = ctx.workspace.get<string[]>('requirements');
    const architecture = ctx.workspace.get<{ database: string }>('architecture');

    // Write results for others
    ctx.workspace.set('api-endpoints', [
      'GET /api/users',
      'POST /api/users',
      'PUT /api/users/:id',
    ]);

    // Merge into existing object
    ctx.workspace.merge('architecture', { apiPattern: 'REST' });

    // Append to an array
    ctx.workspace.append('completed-tasks', 'API layer built');

    return { content: 'API endpoints created' };
  },
});
```

### Workspace API

| Method | Description |
|---|---|
| `get<T>(key)` | Read a value |
| `set(key, value)` | Write a value |
| `has(key)` | Check if key exists |
| `delete(key)` | Remove a key |
| `getAll()` | Get entire workspace as object |
| `merge(key, data)` | Deep merge into an existing object |
| `append(key, item)` | Append to an array |

---

## React Hook: `useTeam`

```tsx
import { useTeam } from '@kernova/framework/react';

function TeamUI() {
  const {
    execute,    // Start a team task
    isRunning,  // Is the team currently working?
    progress,   // Array of progress events
    result,     // Final result (null until done)
    error,      // Error if failed
    cancel,     // Cancel current execution
    reset,      // Clear state
  } = useTeam('dev-team');

  return (
    <div>
      <button
        onClick={() => execute('Build a dashboard with charts')}
        disabled={isRunning}
      >
        {isRunning ? 'Working...' : 'Start Task'}
      </button>

      {/* Live progress feed */}
      {progress.map((event, i) => (
        <div key={i} className="flex gap-2 text-sm text-muted-foreground">
          <span className="font-mono text-xs">{event.agent}</span>
          <span>{event.type}</span>
        </div>
      ))}

      {/* Final result */}
      {result && (
        <div>
          <p>Completed in {result.duration}ms</p>
          <p>Tasks: {result.totalTasks}</p>
          <pre>{result.result}</pre>
        </div>
      )}
    </div>
  );
}
```

### Hook Options

```typescript
const team = useTeam('team-name', {
  strategy: 'pipeline',           // Override default strategy
  context: { language: 'TypeScript' }, // Extra context for all agents
  timeout: 120000,                // Custom timeout
  onProgress: (event) => {},      // Callback per progress event
  onComplete: (result) => {},     // Callback on completion
  onError: (error) => {},         // Callback on error
});
```

---

## HTTP API

### Execute a Team Task

```
POST /v1/teams/:teamName/execute
```

**Request:**
```json
{
  "goal": "Build a user registration flow with email verification",
  "strategy": "hierarchical",
  "context": {
    "framework": "Next.js",
    "database": "PostgreSQL"
  },
  "timeout": 300000
}
```

**Response:** Server-Sent Events (SSE) stream with progress + final result.

### List Teams

```
GET /v1/teams
```

**Response:**
```json
{
  "teams": [
    {
      "name": "Dev Team",
      "description": "Full-stack development team",
      "strategy": "hierarchical",
      "members": [
        { "agent": "senior-dev", "role": "lead", "description": "..." },
        { "agent": "frontend-dev", "role": "member", "specialization": ["react"] }
      ]
    }
  ]
}
```

---

## Project Structure

```
my-app/
├── agents/
│   ├── senior-dev.ts          # Lead agent
│   ├── frontend-dev.ts        # Frontend specialist
│   ├── backend-dev.ts         # Backend specialist
│   ├── tester.ts              # QA agent
│   ├── teams/
│   │   └── dev-team.ts        # Team definition
│   └── tools/
│       ├── read-file.ts
│       ├── write-file.ts
│       └── run-tests.ts
├── app/
│   └── page.tsx               # Frontend with useTeam()
├── kernova.config.ts
└── package.json
```

Teams are auto-discovered from `agents/teams/` or `teams/` directories.

---

## Advanced: Custom Delegation in Agent Handlers

When running inside a team, agents get enhanced context:

```typescript
export default defineAgent({
  name: 'senior-dev',
  instructions: '...',
  handler: async (ctx) => {
    // See who's on the team
    console.log(ctx.teamMembers);
    // [{ agent: 'frontend-dev', role: 'member', ... }, ...]

    // Delegate to a specific member
    const uiCode = await ctx.delegateTo('frontend-dev', 'Build a Button component');

    // Read/write shared workspace
    ctx.workspace.set('ui-components', ['Button']);

    // Log for debugging
    ctx.log('UI component delegated successfully');

    return { content: uiCode };
  },
});
```

---

## Error Handling

- **Task timeout:** If a team member takes too long, the task fails and is retried (up to `maxRetries`)
- **Agent not found:** If you delegate to an agent that doesn't exist, you get an error message
- **Max depth exceeded:** If delegation chains get too deep, a clear error is returned
- **Duplicate agents:** `defineTeam` throws at startup if two members have the same agent name

---

## When to Use Teams vs Manual Delegation

| Scenario | Use |
|---|---|
| Simple routing (A → B or C) | `ctx.delegate()` in a handler |
| Fixed pipeline (always A → B → C) | `defineTeam` with `pipeline` strategy |
| Complex decomposition (lead assigns) | `defineTeam` with `hierarchical` |
| Multiple agents with shared state | `defineTeam` with workspace |
| Want live progress tracking in UI | `defineTeam` + `useTeam()` hook |
| Quick prototype | `ctx.delegate()` |
| Production multi-agent system | `defineTeam` |
