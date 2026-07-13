---
title: "Step 1: Project Setup"
description: "Create a new Kernova project for your multi-agent coding team."
---

# Step 1: Project Setup

## Create the Project

```bash
npx create-kernova-app coding-team
cd coding-team
```

When prompted:
- **Name:** coding-team
- **Template:** default

## Install Dependencies

```bash
npm install
```

## Set Your API Key

Create `.env.local`:

```bash
OPENAI_API_KEY=sk-your-key-here
```

## Verify It Works

```bash
kernova dev
```

You should see:

```
🧠 Kernova Framework Server
├─ Agents:  1 discovered
├─ Tools:   0 registered
├─ Teams:   0 configured
├─ Memory:  0 namespaces
└─ Config:  coding-team v1.0.0
```

Stop the dev server (Ctrl+C). We'll rebuild the agent structure from scratch.

---

## Project Structure

Delete the default agent and create our structure:

```
coding-team/
├── agents/
│   ├── senior-dev.ts           # Lead agent
│   ├── frontend-dev.ts         # Frontend specialist
│   ├── backend-dev.ts          # Backend specialist
│   ├── tester.ts               # QA agent
│   └── teams/
│       └── dev-team.ts         # Team definition
├── app/
│   ├── page.tsx                # Chat UI
│   └── layout.tsx
├── .env.local
├── kernova.config.ts
├── package.json
└── tsconfig.json
```

---

## Update the Config

Edit `kernova.config.ts`:

```typescript
import { defineConfig } from '@kernova/framework';

export default defineConfig({
  name: 'coding-team',
  description: 'Multi-agent coding team that collaborates on development tasks',
  version: '1.0.0',

  model: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.4, // Moderate creativity for code
  },
});
```

---

[Continue to Step 2: Define the Agents →](/framework/tutorials/teams/03-agents)
