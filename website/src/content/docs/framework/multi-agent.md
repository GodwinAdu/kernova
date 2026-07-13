---
title: Multi-Agent Architecture
description: Build systems where multiple agents collaborate, delegate, and specialize.
---

# Multi-Agent Architecture

Real-world applications often need multiple agents working together. A support bot delegates billing questions to a billing agent. A development team has a lead who assigns tasks to specialists. A research pipeline chains researcher → analyzer → writer.

Kernova gives you **two approaches**:

1. **Manual delegation** — Use `ctx.delegate()` to call agents from handlers (full control)
2. **Teams** — Use `defineTeam()` to let the framework orchestrate multiple agents automatically

---

## Approach 1: Manual Delegation (`ctx.delegate`)

Create multiple `.agent.ts` files and delegate between them:

```
agents/
├── router.agent.ts      → POST /api/agents/router
├── support.agent.ts     → POST /api/agents/support
├── billing.agent.ts     → POST /api/agents/billing
└── tools/
    └── ...
```

### Router Pattern

A single entry point that delegates to specialists:

```typescript
// agents/router.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Router',
  instructions: `
    You are a routing agent. Based on the user's message, delegate to the right specialist:
    - For product questions, technical issues → delegate to "support"
    - For billing, payments, subscriptions → delegate to "billing"
    - For everything else → answer directly
  `,
  handler: async (ctx) => {
    const input = ctx.input.toLowerCase();

    if (input.includes('bill') || input.includes('payment') || input.includes('subscription')) {
      const result = await ctx.delegate('billing', ctx.input);
      return result;
    }

    if (input.includes('bug') || input.includes('error') || input.includes('help')) {
      const result = await ctx.delegate('support', ctx.input);
      return result;
    }

    return { content: "I can help with support or billing. What do you need?" };
  },
});
```

### Pipeline Pattern

Agents process sequentially, each building on the previous output:

```typescript
// agents/research-pipeline.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Research Pipeline',
  instructions: 'Orchestrate a research pipeline',
  handler: async (ctx) => {
    const research = await ctx.delegate('researcher', ctx.input);
    const analysis = await ctx.delegate('analyzer', `Analyze:\n${research.content}`);
    const report = await ctx.delegate('writer', `Write report:\n${analysis.content}`);
    return report;
  },
});
```

### Parallel Pattern

Multiple agents work simultaneously:

```typescript
export default defineAgent({
  name: 'Multi-Perspective',
  instructions: 'Get multiple viewpoints',
  handler: async (ctx) => {
    const [optimist, pessimist, pragmatist] = await Promise.all([
      ctx.delegate('optimist', ctx.input),
      ctx.delegate('pessimist', ctx.input),
      ctx.delegate('pragmatist', ctx.input),
    ]);

    return {
      content: `## Optimistic\n${optimist.content}\n\n## Cautious\n${pessimist.content}\n\n## Practical\n${pragmatist.content}`,
    };
  },
});
```

---

## Approach 2: Teams (`defineTeam`)

For complex scenarios where you want the framework to handle orchestration — task decomposition, assignment, delegation chains, reviews, and shared state.

### Define a Team

```typescript
// agents/teams/engineering.ts
import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Engineering Team',
  strategy: 'hierarchical',
  members: [
    {
      agent: 'senior-dev',
      role: 'lead',
      description: 'Decomposes tasks, reviews code, makes architectural decisions',
      canDelegate: true,
      canApprove: true,
    },
    {
      agent: 'frontend-dev',
      role: 'member',
      description: 'Builds React components, CSS, client-side logic',
      specialization: ['react', 'typescript', 'css', 'tailwind', 'ui'],
    },
    {
      agent: 'backend-dev',
      role: 'member',
      description: 'Builds APIs, database schemas, server-side logic',
      specialization: ['node', 'api', 'database', 'prisma', 'auth'],
    },
    {
      agent: 'tester',
      role: 'reviewer',
      description: 'Writes tests, runs QA, finds bugs',
      specialization: ['testing', 'jest', 'playwright'],
      canApprove: true,
    },
  ],
});
```

### Delegation Strategies

| Strategy | How It Works | Best For |
|---|---|---|
| `hierarchical` | Lead decomposes → assigns to members → reviews results | Dev teams, management structures |
| `sequential` | Agent A → B → C in fixed order | Content pipelines, approval chains |
| `pipeline` | Output of one feeds into next as input | Data processing, ETL |
| `collaborative` | Agents freely delegate to each other | Creative work, brainstorming |
| `round-robin` | Tasks distributed evenly | Load balancing, parallel processing |
| `broadcast` | All agents work on same task, best result wins | Quality optimization |

### Execute a Team Task

**From the backend:**

```typescript
// Inside any agent handler
const result = await ctx.delegateTo('frontend-dev', 'Build a login form with shadcn/ui');
```

**From the frontend (React):**

```tsx
import { useTeam } from '@kernova/framework/react';

function TeamDashboard() {
  const { execute, isRunning, progress, result } = useTeam('engineering-team');

  return (
    <div>
      <button onClick={() => execute('Build a user profile page with avatar upload')}>
        Start Team Task
      </button>

      {isRunning && (
        <div className="space-y-2">
          {progress.map((event, i) => (
            <div key={i} className="text-sm">
              <span className="font-mono">[{event.agent}]</span> {event.type}
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="mt-4">
          <h3>Result</h3>
          <pre>{result.result}</pre>
          <p>Tasks completed: {result.totalTasks}</p>
        </div>
      )}
    </div>
  );
}
```

**Via HTTP API:**

```bash
curl -X POST http://localhost:4555/v1/teams/engineering-team/execute \
  -H "Content-Type: application/json" \
  -d '{"goal": "Build a user profile page with avatar upload"}'
```

### How Hierarchical Execution Works

```
Goal: "Build a user profile page"
  ↓
[senior-dev] Decomposes into sub-tasks:
  - frontend-dev: "Build the ProfileCard component with Tailwind"
  - backend-dev: "Create GET /api/profile endpoint with Prisma"
  - tester: "Write tests for the profile feature"
  ↓
[frontend-dev] Builds the component → returns code
[backend-dev] Builds the API → returns code
[tester] Writes tests → returns test file
  ↓
[senior-dev] Reviews all outputs → synthesizes final result
  ↓
Final output returned to caller
```

### Shared Workspace

Agents in a team share a workspace — a key-value store visible to all members:

```typescript
// agents/senior-dev.ts
export default defineAgent({
  name: 'senior-dev',
  instructions: 'You are a senior developer...',
  handler: async (ctx) => {
    // Write to shared workspace
    ctx.workspace.set('architecture', { pattern: 'MVC', database: 'PostgreSQL' });

    // Delegate — the other agent can read workspace
    const result = await ctx.delegateTo('backend-dev', 'Build the API layer');

    // Read what they stored
    const apiSpec = ctx.workspace.get('api-spec');

    return { content: `Architecture decided. API spec: ${JSON.stringify(apiSpec)}` };
  },
});

// agents/backend-dev.ts
export default defineAgent({
  name: 'backend-dev',
  instructions: 'You are a backend developer...',
  handler: async (ctx) => {
    // Read what the lead decided
    const arch = ctx.workspace.get('architecture');

    // Do the work
    const apiCode = `// Using ${arch?.database}...`;

    // Store result for others
    ctx.workspace.set('api-spec', { endpoints: ['/api/users'], database: arch?.database });

    return { content: apiCode };
  },
});
```

### Depth Limits (Prevent Infinite Loops)

Teams have a `maxDelegationDepth` (default: 5). If Agent A delegates to Agent B, who delegates to Agent C, who delegates to Agent D — that's depth 3. If it hits the max, the delegation returns an error instead of recursing infinitely.

```typescript
defineTeam({
  name: 'My Team',
  strategy: 'collaborative',
  maxDelegationDepth: 3, // Agents can delegate max 3 levels deep
  members: [...],
});
```

---

## Team Member Roles

| Role | Default Permissions | Purpose |
|---|---|---|
| `lead` | Can delegate, can approve | Coordinates the team, decomposes tasks |
| `member` | Cannot delegate (unless enabled) | Does the actual work |
| `reviewer` | Can approve | Reviews output quality |
| `specialist` | Same as member | Like member, but implies narrow expertise |

---

## Agent-per-Feature in the UI

Different pages can talk to different agents:

```tsx
// app/chat/page.tsx
const chat = useAgentStream('support');

// app/billing/page.tsx
const billing = useAgent('billing');

// app/admin/page.tsx — uses a team for complex tasks
const team = useTeam('engineering-team');
```

---

## Sharing Tools Between Agents

```typescript
// agents/support.agent.ts
tools: ['search-kb', 'create-ticket']

// agents/billing.agent.ts
tools: ['search-kb', 'lookup-subscription']

// 'search-kb' is shared — defined once in agents/tools/search-kb.ts
```

---

## Best Practices

1. **Keep agents focused** — Each agent does one thing well
2. **Use teams for complex orchestration** — Don't write manual delegation logic when `defineTeam` handles it
3. **Use a router for simple cases** — If you just need routing, a manual handler is simpler than a full team
4. **Set sensible depth limits** — `maxDelegationDepth: 3` is usually enough
5. **Use the shared workspace** — Don't pass massive strings between agents; store structured data in workspace
6. **Monitor execution** — Watch the progress events to see which agents are doing what
7. **Start with hierarchical** — It's the most natural for most use cases (one lead + specialists)
