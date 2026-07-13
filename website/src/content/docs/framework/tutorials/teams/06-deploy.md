---
title: "Step 5: Deploy & Next Steps"
description: "Deploy your multi-agent team to production and explore advanced patterns."
---

# Step 5: Deploy & Next Steps

## Deploy to Kernova Cloud

### Push to GitHub

```bash
git init
git add .
git commit -m "feat: multi-agent coding team"
git remote add origin https://github.com/YOUR_USERNAME/coding-team.git
git push -u origin main
```

### Deploy

```bash
kernova login
kernova deploy
```

Or import from the [Kernova Cloud dashboard](https://kernova-cloud.vercel.app).

### Add Environment Variables

In the Kernova Cloud dashboard → your project → Environment tab:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | `sk-...` |

Click "Save & Redeploy."

Your team is now live and accessible via the deployed URL.

---

## Advanced: Adding Tools to Agents

Give agents the ability to actually read/write files:

```typescript
// agents/tools/read-project-files.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'read-project-files',
  description: 'Read the contents of a file in the project',
  parameters: {
    path: { type: 'string', description: 'File path relative to project root', required: true },
  },
  execute: async ({ path }) => {
    const fs = await import('node:fs/promises');
    try {
      const content = await fs.readFile(path as string, 'utf-8');
      return { content, path };
    } catch {
      return { error: `File not found: ${path}` };
    }
  },
});
```

Then add tools to specific agents:

```typescript
// agents/senior-dev.ts
export default defineAgent({
  name: 'senior-dev',
  instructions: '...',
  tools: ['read-project-files'], // Can read code for reviews
});
```

---

## Advanced: Using the Shared Workspace

Give agents the ability to coordinate through shared state:

```typescript
// agents/senior-dev.ts (with custom handler using workspace)
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'senior-dev',
  instructions: '...',
  handler: async (ctx) => {
    // Set architecture decisions in workspace
    ctx.workspace.set('conventions', {
      naming: 'camelCase for functions, PascalCase for components',
      imports: 'Use absolute imports with @/ prefix',
      errorHandling: 'Always use try/catch in API routes',
    });

    // Delegate with context
    const frontend = await ctx.delegateTo('frontend-dev',
      'Build a UserCard component. Check workspace for conventions.'
    );

    // Read what the frontend dev produced
    const componentCode = ctx.workspace.get('frontend-output');

    return { content: `Architecture set. Frontend code:\n${frontend}` };
  },
});
```

---

## Advanced: Different Strategies

### Try Pipeline (Content Creation)

```typescript
// agents/teams/content-pipeline.ts
import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Content Pipeline',
  strategy: 'pipeline',
  members: [
    { agent: 'researcher', role: 'member', description: 'Finds relevant data' },
    { agent: 'writer', role: 'member', description: 'Writes the article' },
    { agent: 'editor', role: 'reviewer', description: 'Edits for clarity' },
  ],
});
```

### Try Broadcast (Get Best Answer)

```typescript
// agents/teams/solutions.ts
import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Solutions Team',
  strategy: 'broadcast',
  members: [
    { agent: 'conservative', role: 'member', description: 'Safe, proven approaches' },
    { agent: 'innovative', role: 'member', description: 'Creative, novel approaches' },
    { agent: 'pragmatic', role: 'lead', description: 'Picks the best approach' },
  ],
});
```

---

## Complete Project Structure

```
coding-team/
├── agents/
│   ├── senior-dev.ts            # Lead: decomposes & reviews
│   ├── frontend-dev.ts          # Specialist: React/UI
│   ├── backend-dev.ts           # Specialist: API/DB
│   ├── tester.ts                # Reviewer: tests/QA
│   ├── teams/
│   │   └── dev-team.ts          # Team definition
│   └── tools/
│       └── read-project-files.ts # Optional: file reading
├── app/
│   ├── page.tsx                 # Team dashboard UI
│   └── layout.tsx
├── .env.local
├── kernova.config.ts
├── package.json
└── tsconfig.json
```

---

## What You Built

| Feature | Implementation |
|---|---|
| 4 specialized agents | Each with unique expertise and personality |
| Team orchestration | `defineTeam()` with hierarchical strategy |
| Task decomposition | Lead automatically breaks down complex goals |
| Delegation | Work assigned based on specialization |
| Code review | Lead reviews before returning final output |
| Real-time progress | SSE streaming with `useTeam()` hook |
| Shared workspace | Agents can share structured data |
| Production deploy | One-command deploy to Kernova Cloud |

---

## Ideas to Extend

1. **Add a Designer agent** — Generates UI mockups and color schemes
2. **Add a DevOps agent** — Writes Dockerfiles, CI/CD configs
3. **Add tools** — File read/write, git operations, linting
4. **Add memory** — Team remembers past decisions and conventions
5. **Add approval gates** — Require human sign-off before executing generated code
6. **Try collaborative strategy** — Let agents freely delegate to each other
7. **Multiple teams** — A "Design Team" and an "Engineering Team" that hand off

---

## Full Tutorial Navigation

1. [Introduction](/framework/tutorials/teams/01-intro)
2. [Project Setup](/framework/tutorials/teams/02-setup)
3. [Define the Agents](/framework/tutorials/teams/03-agents)
4. [Define the Team](/framework/tutorials/teams/04-team)
5. [Build the Chat UI](/framework/tutorials/teams/05-frontend)
6. **Deploy & Next Steps** (you are here)
