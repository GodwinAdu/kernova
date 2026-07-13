---
title: Skills
description: Reusable skill packages that teach agents how to accomplish classes of tasks.
---

# Skills

A Skill is more than a prompt — it's a reusable package containing instructions, tools, workflows, and MCP requirements that an agent can load to instantly gain expertise in a domain.

## Defining a Skill

```typescript
// skills/coding/index.ts
import { defineSkill } from '@kernova/framework';

export default defineSkill({
  name: 'coding',
  description: 'Expert software developer',
  instructions: `
    You are an expert software developer.
    
    RULES:
    - Write clean, readable, well-documented code
    - Follow the language's best practices and conventions
    - Always include error handling
    - Write tests for new functionality
    - Explain your reasoning when making architectural decisions
    - Prefer simple solutions over clever ones
    
    WORKFLOW:
    1. Understand the requirements
    2. Plan the approach
    3. Implement the solution
    4. Write tests
    5. Review for edge cases
  `,
  tools: [
    {
      name: 'run-tests',
      description: 'Run the test suite',
      parameters: { path: { type: 'string', description: 'Test file path' } },
      execute: async ({ path }) => {
        // Run tests implementation
        return { passed: true, tests: 5 };
      },
    },
  ],
  mcpServers: ['github', 'filesystem'],
  recommendedModel: 'gpt-4o',
  knowledge: ['docs/style-guide.md'],
});
```

## Using Skills in Agents

Reference skills by name in your agent definition:

```typescript
// agents/developer.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Developer',
  instructions: 'You help with software development tasks.',
  skills: ['coding', 'testing'],  // ← loads skills from skills/ directory
  tools: ['web-search'],
  memory: { type: 'conversational', ttl: '7d' },
});
```

When the agent loads, it:
1. Finds the skill in `skills/coding/`
2. Appends the skill's instructions to the agent's system prompt
3. Registers the skill's tools
4. Ensures required MCP servers are connected

## Skill Directory Structure

```
skills/
├── coding/
│   ├── index.ts          # Skill definition (defineSkill)
│   ├── manifest.json     # Optional metadata
│   ├── tools/            # Skill-specific tools
│   │   ├── lint.ts
│   │   └── format.ts
│   ├── knowledge/        # Reference documents
│   │   └── style-guide.md
│   └── tests/            # Skill tests
│       └── coding.test.ts
├── research/
│   └── index.ts
└── sales/
    └── index.ts
```

## Skill Manifest

Create `manifest.json` for metadata and dependency declaration:

```json
{
  "name": "coding",
  "version": "1.0.0",
  "description": "Expert software development skill",
  "author": "Your Name",
  "requiredTools": ["filesystem", "terminal"],
  "requiredMcps": ["github", "filesystem"],
  "recommendedModel": "gpt-4o",
  "permissions": ["filesystem.read", "filesystem.write"],
  "knowledge": ["knowledge/style-guide.md"]
}
```

## Installing Skills from npm

Skills can be published as npm packages:

```bash
npm install @kernova/skill-nextjs
```

Then reference in your agent:

```typescript
export default defineAgent({
  name: 'Next.js Developer',
  skills: ['@kernova/skill-nextjs'],
});
```

## Creating a Publishable Skill

```typescript
// src/index.ts
import { defineSkill } from '@kernova/framework';

export default defineSkill({
  name: 'nextjs',
  description: 'Expert Next.js development',
  instructions: `
    You are an expert Next.js developer.
    You know App Router, Server Components, Server Actions, and the latest Next.js patterns.
    Always use TypeScript. Prefer server components unless client interactivity is needed.
  `,
  mcpServers: ['filesystem'],
  recommendedModel: 'gpt-4o',
});
```

Package.json:
```json
{
  "name": "@kernova/skill-nextjs",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@kernova/framework": "^1.0.0"
  }
}
```

## Multiple Skills on One Agent

```typescript
export default defineAgent({
  name: 'Full-Stack Developer',
  instructions: 'You build complete web applications.',
  skills: ['coding', 'testing', '@kernova/skill-nextjs', '@kernova/skill-postgres'],
});
```

Each skill's instructions are appended in order. Tools from all skills are available to the agent.

## How Skills Differ from Tools

| | Tools | Skills |
|---|---|---|
| **Scope** | One specific action | A class of tasks |
| **Contains** | Single execute function | Instructions + tools + workflows + knowledge |
| **Purpose** | "Send an email" | "Be an expert email marketer" |
| **Reusability** | Function-level | Domain-level |
