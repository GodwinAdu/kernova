# @kernova/framework

Full-stack AI agent framework. Build frontends and agent backends in one project, deploy with one command.

## Quick Start

```bash
# Create a new project
kernova create my-app

# Start development
cd my-app
kernova dev

# Deploy to Kernova Cloud
kernova deploy
```

## Project Structure

```
my-app/
├── app/                      # Frontend (Next.js)
│   ├── layout.tsx
│   ├── page.tsx
│   └── chat/
│       └── page.tsx          # Auto-connected to agents
├── agents/                   # Agent backend (file-based routing)
│   ├── assistant.agent.ts    # → POST /agents/assistant
│   ├── support.agent.ts      # → POST /agents/support
│   └── tools/
│       ├── search-kb.ts      # Custom tool
│       └── create-ticket.ts
├── memory/                   # Memory schemas
│   └── conversations.ts
├── middleware/               # Agent pipeline middleware
│   └── auth.ts
├── kernova.config.ts         # Project config
└── package.json
```

## Defining Agents

```typescript
// agents/support.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  model: 'gpt-4o',
  instructions: 'You help customers with their issues...',
  tools: ['search-kb', 'create-ticket'],
  memory: { type: 'conversational', ttl: '7d' },
});
```

## Defining Tools

```typescript
// agents/tools/search-kb.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'search-kb',
  description: 'Search the knowledge base',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
  },
  execute: async ({ query }, ctx) => {
    return await db.search(query);
  },
});
```

## React Hooks

```tsx
// app/chat/page.tsx
'use client';
import { useAgentStream } from '@kernova/framework/react';

export default function Chat() {
  const { messages, send, isStreaming, streamingContent } = useAgentStream('support');

  return (
    <div>
      {messages.map(m => <p key={m.id}>{m.content}</p>)}
      {isStreaming && <p>{streamingContent}</p>}
    </div>
  );
}
```

## How It Works

- **`kernova dev`** — Starts both frontend (port 3000) and agent backend (port 4555)
- **`kernova build`** — Builds frontend + compiles agents for production
- **`kernova deploy`** — Deploys frontend to CDN + agents to Kernova Cloud compute

The React hooks auto-detect the environment:
- In dev: connects to `localhost:4555`
- In production: connects to same-origin `/v1` (Kernova Cloud serves both)

## Packages

| Export | Description |
|--------|-------------|
| `@kernova/framework` | Core APIs: `defineAgent`, `defineTool`, `defineMemory` |
| `@kernova/framework/react` | React hooks: `useAgent`, `useAgentStream`, `useMemory` |
| `@kernova/framework/server` | Server runtime: `createServer`, `DevServer` |
| `@kernova/framework/config` | Config: `defineConfig` |
