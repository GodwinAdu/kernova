# @kernova/framework

[![npm version](https://img.shields.io/npm/v/@kernova/framework.svg)](https://www.npmjs.com/package/@kernova/framework)
[![npm downloads](https://img.shields.io/npm/dm/@kernova/framework.svg)](https://www.npmjs.com/package/@kernova/framework)
[![license](https://img.shields.io/npm/l/@kernova/framework.svg)](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@kernova/framework.svg)](https://nodejs.org)

**Full-stack AI agent framework. Build a React frontend and AI agents in one project and deploy both with one command.**

**[Documentation](https://kernova2026.vercel.app)** · [Create a project](https://kernova2026.vercel.app/framework/create-project/) · [React hooks](https://kernova2026.vercel.app/framework/react-hooks/) · [GitHub](https://github.com/GodwinAdu/kernova)

- **File-based agent routing.** `agents/support.agent.ts` becomes `POST /api/agents/support`
- **React hooks.** `useAgent`, `useAgentStream`, `useMemory`, `useThread`, `useTeam`
- **Tools, memory, teams, triggers, MCP, and skills**, each declared with a `define*()` helper
- **26 model providers**, including Azure OpenAI, AWS Bedrock, and Google Vertex AI, switchable with an environment variable
- **Hot reload** for both agents and UI

---

## Quick start

```bash
npx create-kernova-app my-app
cd my-app
npm run dev        # runs `kernova dev`
```

Open <http://localhost:3000/chat>. The scaffolded chat page is already wired to your `assistant` agent. Add your model API key to `.env.local` first.

To add the framework to an existing project instead:

```bash
npm install @kernova/framework @kernova/cli
npm install react next   # only if you use the React hooks
```

Requirements: Node.js **22+**, an ESM project, and an API key for at least one [model provider](#environment-variables). React 19+ and Next.js 16+ are optional peer dependencies.

## Project structure

```
my-app/
├── app/                        # Frontend (Next.js App Router)
│   ├── layout.tsx
│   ├── providers.tsx           # <KernovaProvider>
│   └── chat/page.tsx           # uses useAgentStream('assistant')
├── agents/                     # Agent backend, file-based routing
│   ├── assistant.agent.ts      # → POST /api/agents/assistant
│   ├── sales/qualify.agent.ts  # → POST /api/agents/sales/qualify
│   ├── tools/                  # Custom tools (auto-discovered)
│   │   └── web-search.ts
│   ├── teams/                  # Multi-agent teams
│   └── triggers/               # Event-driven triggers
├── memory/                     # Memory schemas / Memory v2 config
├── middleware/                 # Request pipeline middleware
├── kernova.config.ts           # Project configuration
└── .env.local                  # API keys (never commit this)
```

Agent files must end in `.agent.ts`, `.agent.js`, or `.agent.mjs`. The path relative to `agents/` becomes the route.

## Define an agent

```typescript
// agents/support.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  description: 'Answers customer questions',
  model: 'gpt-4o',
  instructions: 'You help customers with their issues. Be concise and friendly.',
  tools: ['search-kb', 'create-ticket'],
  memory: { type: 'conversational', ttl: '7d' },
});
```

### Agent options

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | **Required.** Display name |
| `instructions` | `string` | **Required.** System instructions |
| `description` | `string` | Human-readable description |
| `model` | `string` | A named model from `models` in the config, or a model ID (defaults to the project model) |
| `tools` | `string[]` | Tool names this agent may call |
| `memory` | `{ type, ttl? }` | `'conversational'` (default), `'persistent'`, or `'none'` |
| `temperature` | `number` | Default: the provider's |
| `maxTokens` | `number` | Default: the provider's |
| `reasoning` | `{ effort?, budgetTokens?, includeThoughts? }` | How much reasoning models think |
| `responseFormat` | `{ type: 'json' }` or `{ type: 'json_schema', schema }` | Answer with JSON |
| `promptCache` | `boolean` | Prompt caching (Claude, Bedrock) |
| `handler` | `(ctx) => Promise<AgentResponse \| string>` | Custom logic in place of the default LLM call |
| `middleware` | `string[]` | Names of the middleware to run (default: all; `[]` = none) |
| `skills` | `string[]` | Skills to load (instructions, knowledge, tools, MCP servers) |
| `mcp` | `string[]` | MCP servers whose tools (`<server>_<tool>`) this agent can call |
| `schedule` | `string \| { cron, goal }[]` | Run autonomously on a schedule |
| `triggers` | `{ event, goal, priority?, cooldown? }[]` | Run when kernel events match `event` (a glob), on a cron expression, or an interval (`schedule.5m`) |
| `budget` | `{ maxTokens?, maxCostUsd?, maxRequestsPerMinute? }` | Per-agent limits (429 when exceeded; tokens and cost per calendar month, saved in `kernova-data/agent-budgets.json`) |
| `reflection` | `{ enabled, threshold?, maxAttempts? }` | Grade each answer with an extra model call and regenerate weak ones (default: the project's `reflection`, off) |
| `loop` | `{ enabled, maxIterations?, timeout?, ... }` | Keep working until the goal is achieved |
| `dynamicInstructions` | `boolean` | Send only the instruction sections relevant to each message |

### Custom handlers

```typescript
export default defineAgent({
  name: 'Router',
  instructions: 'Route requests to the right specialist.',
  handler: async (ctx) => {
    const history = await ctx.recall(ctx.input, { limit: 3 });
    const reply = await ctx.delegate('support', ctx.input);
    await ctx.remember(`User asked: ${ctx.input}`);
    return reply;
  },
});
```

`ctx` includes `input`, `threadId`, `user`, `recall`, `remember`, `delegate`, `delegateTo`, `askRemote`, `workspace`, `emit`, `log`, and `env`.

## Define a tool

Files in `agents/tools/` or `tools/` are discovered automatically.

```typescript
// agents/tools/search-kb.ts
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'search-kb',
  description: 'Search the knowledge base', // shown to the model
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
    limit: { type: 'number', description: 'Max results', default: 5 },
  },
  execute: async ({ query, limit }, ctx) => {
    ctx.log(`searching for ${query}`);
    return db.search(query, limit);
  },
});
```

## React hooks

Wrap your app in `KernovaProvider` once:

```tsx
// app/providers.tsx
'use client';
import { KernovaProvider } from '@kernova/framework/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return <KernovaProvider>{children}</KernovaProvider>;
}
```

Then talk to any agent by its route name:

```tsx
// app/chat/page.tsx
'use client';
import { useAgentStream } from '@kernova/framework/react';

export default function Chat() {
  const { messages, send, isStreaming, streamingContent, abort } = useAgentStream('support');

  return (
    <div>
      {messages.map((m) => <p key={m.id}><b>{m.role}:</b> {m.content}</p>)}
      {isStreaming && <p>{streamingContent}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(e.currentTarget.prompt.value); }}>
        <input name="prompt" />
        {isStreaming ? <button type="button" onClick={abort}>Stop</button> : <button>Send</button>}
      </form>
    </div>
  );
}
```

| Hook | Returns |
|------|---------|
| `useAgent(name, options?)` | `{ messages, send, isLoading, error, threadId, clear, retry }` |
| `useAgentStream(name, options?)` | `{ messages, send, isStreaming, streamingContent, error, threadId, clear, abort }` |
| `useMemory(namespace, options?)` | `{ entries, search, store, remove, isLoading, error }` |
| `useThread()` | `{ threads, activeId, create, switchTo, remove, refresh, isLoading }` |
| `useTeam(name, options?)` | `{ execute, isRunning, progress, result, error, cancel, reset }` |
| `useConnectionStatus(pollMs?)` | `{ isConnected, latency, check, lastCheck }` |

Also exported: `KernovaErrorBoundary` (error UI with retry) and `useKernovaContext()`.

### How the frontend reaches the agents

By default the hooks call your own origin under `/api`, which a Next.js rewrite proxies to the agent server on port `4555`. There are no CORS issues and no second URL. To point them somewhere else:

```tsx
<KernovaProvider baseUrl="https://agents.example.com" apiKey={token}>
```

or set `NEXT_PUBLIC_KERNOVA_URL`.

## Configuration

```typescript
// kernova.config.ts
import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: 'my-support-app',
  model: { provider: 'openai', model: 'gpt-4o' },
  memory: { provider: 'sqlite', autoRecall: true },
  gateway: {
    cors: ['https://myapp.com'],
    rateLimit: { requests: 100, window: '1m' },  // per caller
    openaiCompat: true,                          // POST /v1/chat/completions
    websocket: true,
  },
  builtInTools: { enabled: ['http-fetch', 'date-time', 'file-read'] }, // unsafe tools are opt-in
  toolPolicy: { deny: ['shell-exec'] },
  app: { framework: 'next', port: 3000 },
});
```

Without `model`, the first provider with an API key in the environment is used. Local servers (`ollama`, `lmstudio`, `vllm`, `llamacpp`) and custom endpoints work with `baseUrl`; `google` is an alias for `gemini`. Cloud platforms take their settings in `options`: `{ provider: 'bedrock', model, options: { region } }`, `{ provider: 'vertex', model, options: { project } }`, `{ provider: 'azure', model: 'my-deployment', options: { endpoint } }`.

Memory providers: `sqlite` (default), `postgres`, `memory`, `redis`, `pinecone`, `supabase`, `custom`. For the Memory v2 engine (pgvector, scoring, compaction), use `defineMemoryConfig()`.

## More building blocks

Every helper is exported from `@kernova/framework` and validates its input when your project loads.

| Helper | Purpose |
|--------|---------|
| `defineAgent` | An agent (file-routed) |
| `defineTool` | A function agents can call |
| `defineMemory` / `defineMemoryConfig` | Memory schemas / Memory v2 engine config |
| `defineMiddleware` | `before` / `after` hooks around agent calls (auth, logging, ...) |
| `defineTeam` | Multi-agent team (`sequential`, `hierarchical`, `collaborative`, ...) |
| `defineTrigger` | Run an agent when an event pattern matches |
| `defineWorkflow` | Durable multi-step workflow with approval gates |
| `defineTask` | Background task for the persistent queue |
| `definePlan` | Goal-decomposition strategy |
| `defineChannel` | Slack, email, webhook, WebSocket, Telegram, Discord, ... |
| `defineMCP` | Declare a Model Context Protocol server |
| `defineSkill` | Reusable bundle of instructions, tools, and MCP requirements |
| `defineRemoteAgent` | Call agents in other organizations (Kernova Agent Protocol) |
| `defineLoop` | Loop configuration for goal-oriented agents |

## HTTP API

The agent server (port `4555`, or `/api/*` through the Next.js app) exposes:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/agents/:name` | Send `{ input, threadId?, context?, user? }`, get a JSON response |
| `POST` | `/agents/:name/stream` | Same, streamed as Server-Sent Events |
| `GET` | `/health` | Health check |
| `POST` | `/memory` | Store a memory |
| `GET` | `/memory/search` | Search memory |
| `DELETE` | `/memory/:id` | Delete a memory |
| `GET` / `POST` / `DELETE` | `/threads`, `/threads/:id`, `/threads/:id/messages` | Conversation threads |
| `POST` | `/v1/teams/:name/execute` | Run a team |
| `GET` / `POST` | `/approvals`, `/approvals/:id/(approve\|deny)` | Human-in-the-loop approvals |
| `GET` | `/tasks`, `/logs`, `/metrics` | Operations |

Set `KERNOVA_API_KEY` to require `Authorization: Bearer <key>` on requests.

## Entry points

| Import | Contents |
|--------|----------|
| `@kernova/framework` | `define*` helpers and types |
| `@kernova/framework/react` | React hooks, `KernovaProvider`, `KernovaErrorBoundary` |
| `@kernova/framework/server` | `createServer`, `DevServer`, `discoverAgents`, `discoverTools`, `loadConfig` |
| `@kernova/framework/config` | `defineConfig` |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, ... | Model provider keys (set at least one) |
| `OPENAI_BASE_URL` | Use any OpenAI-compatible endpoint |
| `KERNOVA_PORT` | Agent server port (default `4555`) |
| `KERNOVA_URL` | Agent server URL used by the Next.js rewrite and on the server side |
| `NEXT_PUBLIC_KERNOVA_URL` | Override the URL the browser hooks call |
| `KERNOVA_API_KEY` | Require a bearer token on agent requests |

See the [`@kernova/sdk` README](https://www.npmjs.com/package/@kernova/sdk#configure-a-model-provider) for the full provider list.

## CLI

```bash
kernova dev       # frontend + agents with hot reload
kernova build     # production build
kernova start     # run the production build
kernova deploy    # deploy to Kernova Cloud, or `kernova deploy docker` to self-host
kernova doctor    # test your configured AI providers
```

See [`@kernova/cli`](https://www.npmjs.com/package/@kernova/cli) for all commands.

## Related packages

| Package | Use it for |
|---------|-----------|
| [`create-kernova-app`](https://www.npmjs.com/package/create-kernova-app) | Scaffold a new project |
| [`@kernova/cli`](https://www.npmjs.com/package/@kernova/cli) | Dev server, build, deploy |
| [`@kernova/sdk`](https://www.npmjs.com/package/@kernova/sdk) | Backend-only agent services |
| [`@kernova/core`](https://www.npmjs.com/package/@kernova/core) | The runtime kernel |

## Documentation and support

- [Framework introduction](https://kernova2026.vercel.app/framework/introduction/)
- [Defining agents](https://kernova2026.vercel.app/framework/agents/) · [Custom tools](https://kernova2026.vercel.app/framework/tools/) · [Memory](https://kernova2026.vercel.app/framework/memory/)
- [React hooks](https://kernova2026.vercel.app/framework/react-hooks/)
- [Config reference](https://kernova2026.vercel.app/framework/config-reference/) · [Environment variables](https://kernova2026.vercel.app/framework/environment-variables/)
- [Deploy to Kernova Cloud](https://kernova2026.vercel.app/framework/deploy/) · [Self-hosting](https://kernova2026.vercel.app/framework/self-hosting/)
- [Troubleshooting](https://kernova2026.vercel.app/framework/troubleshooting/)
- [Report a bug or request a feature](https://github.com/GodwinAdu/kernova/issues)

## Contributing

Contributions are welcome. See the [contributing guide](https://github.com/GodwinAdu/kernova/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
