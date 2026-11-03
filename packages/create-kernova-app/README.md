# create-kernova-app

[![npm version](https://img.shields.io/npm/v/create-kernova-app.svg)](https://www.npmjs.com/package/create-kernova-app)
[![npm downloads](https://img.shields.io/npm/dm/create-kernova-app.svg)](https://www.npmjs.com/package/create-kernova-app)
[![license](https://img.shields.io/npm/l/create-kernova-app.svg)](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)

**Create a full-stack AI agent app with Kernova in one command.**

```bash
npx create-kernova-app my-app
```

**[Documentation](https://kernova2026.vercel.app)** · [Create a project](https://kernova2026.vercel.app/framework/create-project/) · [Tutorial](https://kernova2026.vercel.app/framework/tutorial/01-setup/) · [GitHub](https://github.com/GodwinAdu/kernova)

You get a working project: an AI agent backend with file-based routing, a chat UI already wired to it, persistent memory, and hot reload.

---

## Quick start

```bash
npx create-kernova-app my-app
cd my-app
```

Add your model provider key to `.env.local`:

```bash
OPENAI_API_KEY=sk-...
```

Then start it:

```bash
npm run dev
```

| URL | What |
|-----|------|
| <http://localhost:3000> | Your app |
| <http://localhost:3000/chat> | Chat UI, connected to the `assistant` agent |
| <http://localhost:3000/api/agents/assistant> | Agent API (`POST`) |

Requirements: Node.js **22+**.

Other package managers work too:

```bash
npm create kernova-app@latest my-app
pnpm create kernova-app my-app
yarn create kernova-app my-app
```

## Options

Run it without arguments for interactive prompts, or pass flags:

```bash
npx create-kernova-app my-app --template multi-agent --next
```

| Flag | Description |
|------|-------------|
| `--template, -t <name>` | `default`, `minimal`, or `multi-agent` |
| `--next` | Next.js frontend (default) |
| `--react` | Vite + React frontend |
| `--no-frontend` | Agents only, no UI |
| `--no-install` | Skip `npm install` |
| `--no-git` | Skip `git init` |
| `-h, --help` | Show help |

### Templates

| Template | Agents | Extras |
|----------|--------|--------|
| `default` / `minimal` | `assistant` | `web-search` tool |
| `multi-agent` | `support`, `researcher` | `search-kb` and `web-search` tools, plus a team in `agents/teams/` |

## What you get

```
my-app/
├── app/                      # Next.js frontend
│   ├── layout.tsx
│   ├── providers.tsx         # <KernovaProvider>
│   ├── page.tsx
│   ├── chat/page.tsx         # streaming chat UI (useAgentStream)
│   └── globals.css
├── agents/
│   ├── assistant.agent.ts    # → POST /api/agents/assistant
│   └── tools/
│       └── web-search.ts
├── memory/
│   └── conversations.ts
├── kernova.config.ts
├── next.config.ts            # proxies /api/* to the agent server
├── .env.local                # API keys (gitignored)
└── package.json
```

With `--react`, the frontend is a Vite app in `src/` instead of `app/`. With `--no-frontend`, only the agent backend is created, served at <http://localhost:4555>.

## Scripts in the generated project

| Script | Runs | Description |
|--------|------|-------------|
| `npm run dev` | `kernova dev` | Frontend + agents with hot reload |
| `npm run build` | `kernova build` | Production build |
| `npm start` | `kernova start` | Run the production build |
| `npm run deploy` | `kernova deploy` | Deploy to Kernova Cloud |

## Next steps

- Add an agent: create `agents/<name>.agent.ts` with `defineAgent()`. It's live at `/api/agents/<name>`
- Add a tool: create `agents/tools/<name>.ts` with `defineTool()`
- Use it from React: `useAgent('<name>')` or `useAgentStream('<name>')`

Read the [`@kernova/framework` docs](https://www.npmjs.com/package/@kernova/framework) for the full API.

## Related packages

| Package | Use it for |
|---------|-----------|
| [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) | The framework your new app is built on |
| [`@kernova/cli`](https://www.npmjs.com/package/@kernova/cli) | `kernova dev`, `build`, `deploy`, `doctor` |
| [`@kernova/sdk`](https://www.npmjs.com/package/@kernova/sdk) | Backend-only agent services |

## Documentation and support

- [Create a project](https://kernova2026.vercel.app/framework/create-project/)
- [Tutorial: build a support bot](https://kernova2026.vercel.app/framework/tutorial/01-setup/)
- [Framework docs](https://kernova2026.vercel.app/framework/introduction/)
- [Report a bug or request a feature](https://github.com/GodwinAdu/kernova/issues)

## Contributing

Contributions are welcome. See the [contributing guide](https://github.com/GodwinAdu/kernova/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
