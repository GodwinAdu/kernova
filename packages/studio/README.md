# @kernova/studio

The Kernova Studio admin dashboard: a Next.js app for inspecting a running Kernova runtime (agents, events, memory, workflows, logs, monitoring, permissions, plugins, context, and deploys).

> This package is **private** and is not published to npm on its own. It is built as a static export and bundled into [`@kernova/cli`](../cli#kernova-studio), so end users open it with `kernova studio`. This README is for contributors working on Studio.

## Development

From the repository root:

```bash
npm install
npm run dev --workspace=@kernova/studio
```

Studio runs at <http://localhost:4200> and reads data from the Kernova Gateway API. Start a runtime for it to connect to, for example `kernova serve` or `kernova dev` in a sample project. When the gateway is unreachable, Studio shows empty states instead of failing.

### Gateway URL

The API client ([`src/lib/api.ts`](src/lib/api.ts)) picks the gateway in this order:

1. `window.__KERNOVA_GATEWAY__`, injected by `kernova studio --gateway <url>`
2. `NEXT_PUBLIC_KERNOVA_URL` at build time
3. `http://localhost:3000`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server on port 4200 |
| `npm run build` | Static export to `out/` (also copied into `packages/cli/studio` by the CLI build) |
| `npm run start` | Serve the built export through `kernova studio` on port 4200 |

Studio uses `output: 'export'`, so every page must work as a static client-side page: no API routes, server actions, or request-time server rendering.

## Structure

```
src/
├── app/            # One route per dashboard page (agents, events, memory, ...)
├── components/     # Shared UI: sidebar, data table, stat cards
└── lib/api.ts      # Gateway API client
```

Built with Next.js 16, React 19, and Tailwind CSS 4.

## Contributing

See the [contributing guide](../../CONTRIBUTING.md).
