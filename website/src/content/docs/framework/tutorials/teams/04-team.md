---
title: "Step 3: Define the Team"
description: "Wire the agents into a team with roles, delegation strategy, and shared workspace."
---

# Step 3: Define the Team

Now we connect the four agents into a team. The `defineTeam()` function declares who's on the team, what they're good at, and how tasks should flow between them.

---

## Create the Team Definition

Create `agents/teams/dev-team.ts`:

```typescript
import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Dev Team',
  description: 'Full-stack development team that builds features collaboratively',

  // The lead decomposes tasks, assigns to members, reviews results
  strategy: 'hierarchical',

  members: [
    {
      agent: 'senior-dev',
      role: 'lead',
      description: 'Decomposes tasks into sub-tasks, assigns work to specialists, reviews all code before finalizing',
      canDelegate: true,
      canApprove: true,
    },
    {
      agent: 'frontend-dev',
      role: 'member',
      description: 'Builds React components, UI layouts, client-side state, styling with Tailwind',
      specialization: ['react', 'typescript', 'css', 'tailwind', 'ui', 'components', 'forms', 'accessibility'],
      canDelegate: false,
    },
    {
      agent: 'backend-dev',
      role: 'member',
      description: 'Builds API routes, database schemas, server-side logic, authentication',
      specialization: ['node', 'api', 'database', 'prisma', 'auth', 'rest', 'validation', 'routes'],
      canDelegate: false,
    },
    {
      agent: 'tester',
      role: 'reviewer',
      description: 'Writes unit tests, integration tests, finds edge cases and bugs',
      specialization: ['testing', 'jest', 'playwright', 'qa', 'edge-cases', 'mocking'],
      canApprove: true,
    },
  ],

  // Prevent infinite delegation loops
  maxDelegationDepth: 3,

  // 5 minutes max for the entire team task
  taskTimeout: 300000,

  // Max 2 retries if an agent fails
  maxRetries: 2,

  // Lead must review before returning
  requireLeadApproval: true,
});
```

---

## How Hierarchical Execution Works

When you submit a goal to this team, here's the step-by-step flow:

### Phase 1: Decomposition

The **senior-dev** (lead) receives the goal and is asked to break it into sub-tasks:

```
INPUT: "Build a user profile page with avatar upload and settings"

SENIOR-DEV RESPONSE:
[
  {
    "agent": "frontend-dev",
    "task": "Build a UserProfile component with: avatar display (circular, 80px), 
             name/email display, 'Edit Profile' button, and 'Upload Avatar' button 
             that opens a file picker. Use shadcn/ui Card and Avatar components."
  },
  {
    "agent": "backend-dev",
    "task": "Build API routes: GET /api/profile (return user data), 
             PUT /api/profile (update name/email), POST /api/profile/avatar 
             (handle file upload, store URL). Add Prisma schema for User model 
             with avatar field."
  },
  {
    "agent": "tester",
    "task": "Write tests for: profile component rendering, avatar upload flow, 
             API route validation (invalid email, file too large), and 
             error states (network failure)."
  }
]
```

### Phase 2: Execution

Each agent works on their assigned task **independently**:

```
[frontend-dev] → Builds the React component code
[backend-dev]  → Builds the API routes and schema
[tester]       → Writes the test suite
```

### Phase 3: Review

The **senior-dev** gets all results back and synthesizes them into a final answer:

```
SENIOR-DEV REVIEWS:
- Frontend code: ✓ Clean components, proper types
- Backend code: ✓ Validation present, proper error handling
- Tests: ✓ Good coverage of edge cases

RETURNS: Combined, cohesive final output with all code organized
```

---

## Understanding the Configuration

### `strategy: 'hierarchical'`

This is the most natural strategy for a dev team:
- One person coordinates (the lead)
- Work is broken down and assigned
- Results are reviewed before delivery

### `specialization: [...]`

These keywords help the lead assign the right agent:
- Task mentions "component" or "form" → frontend-dev
- Task mentions "API" or "database" → backend-dev
- Task mentions "test" → tester

### `canDelegate: true/false`

- The **lead** can delegate (assign tasks to others)
- Regular **members** cannot delegate by default (they just do the work)
- Setting `canDelegate: false` on members prevents infinite chains

### `maxDelegationDepth: 3`

Prevents loops:
- Depth 0: System assigns to lead
- Depth 1: Lead assigns to member
- Depth 2: If member could delegate (disabled), this would be the max
- Depth 3: Hard stop — returns error

### `requireLeadApproval: true`

The lead always gets the final say. Even after all members complete their work, the lead reviews before the result is returned to the user.

---

## Test the Team

Start the dev server:

```bash
kernova dev
```

You should see:

```
🧠 Kernova Framework Server
├─ Agents:  4 discovered
├─ Tools:   0 registered
├─ Teams:   1 configured
├─ Memory:  0 namespaces
└─ Config:  coding-team v1.0.0

⚡ Agent API ready at http://localhost:4555
📡 Routes:
   POST /agents/senior-dev
   POST /agents/frontend-dev
   POST /agents/backend-dev
   POST /agents/tester
   POST /v1/intents
   GET  /v1/teams
   POST /v1/teams/dev-team/execute
   GET  /memory/search
   POST /memory
   GET  /health
```

### Verify the team is discovered:

```bash
curl http://localhost:4555/v1/teams | jq
```

Response:
```json
{
  "teams": [
    {
      "name": "Dev Team",
      "description": "Full-stack development team that builds features collaboratively",
      "strategy": "hierarchical",
      "members": [
        { "agent": "senior-dev", "role": "lead", "description": "..." },
        { "agent": "frontend-dev", "role": "member", "specialization": ["react", "typescript", "..."] },
        { "agent": "backend-dev", "role": "member", "specialization": ["node", "api", "..."] },
        { "agent": "tester", "role": "reviewer", "specialization": ["testing", "jest", "..."] }
      ]
    }
  ]
}
```

### Execute a team task:

```bash
curl -X POST http://localhost:4555/v1/teams/dev-team/execute \
  -H "Content-Type: application/json" \
  -d '{"goal": "Build a simple counter component with increment and decrement buttons"}'
```

Watch the SSE stream — you'll see progress events as each agent works:

```
data: {"type":"progress","event":{"type":"task-assigned","agent":"senior-dev",...}}
data: {"type":"progress","event":{"type":"task-completed","agent":"senior-dev",...}}
data: {"type":"progress","event":{"type":"delegation","agent":"senior-dev",...}}
data: {"type":"progress","event":{"type":"task-assigned","agent":"frontend-dev",...}}
data: {"type":"progress","event":{"type":"task-completed","agent":"frontend-dev",...}}
data: {"type":"progress","event":{"type":"task-assigned","agent":"tester",...}}
data: {"type":"progress","event":{"type":"task-completed","agent":"tester",...}}
data: {"type":"progress","event":{"type":"review","agent":"senior-dev",...}}
data: {"type":"progress","event":{"type":"task-completed","agent":"senior-dev",...}}
data: {"type":"result","result":{"result":"...final combined output..."}}
data: [DONE]
```

---

## Common Issues

**"Team not found"**
- Make sure your team file is in `agents/teams/` or `teams/`
- File must export a default `defineTeam()` result
- Restart `kernova dev` after adding new files

**"Agent not found"**
- Each agent in `members` must have a matching `.ts` file in `agents/`
- The `agent` field must match the file name exactly (without extension)

**Timeout errors**
- Complex tasks may take more than 5 minutes with GPT-4
- Increase `taskTimeout` in the team definition
- Or use a faster model for simple agents

---

[Continue to Step 4: Build the Chat UI →](/framework/tutorials/teams/05-frontend)
