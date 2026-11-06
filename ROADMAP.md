# Roadmap

Where Kernova is going, so you can see where help is most useful. This is a plan, not a promise: priorities change as people use Kernova and tell us what they need. The longer-term direction is in [`docs/VISION.md`](docs/VISION.md).

Want to help? Pick an issue labeled [`good first issue`](https://github.com/GodwinAdu/kernova/labels/good%20first%20issue) or [`help wanted`](https://github.com/GodwinAdu/kernova/labels/help%20wanted), or open an issue to propose something. For anything large, read [how significant changes are made](GOVERNANCE.md#how-changes-are-made) first.

## Where Kernova is today (2.0)

- **`@kernova/core`:** the runtime kernel. Intents, agents, tools, events, memory, workflows, triggers, channel adapters, identity, and a gateway. It talks to 26 model providers, with structured output, reasoning controls, prompt caching, and audio/file input
- **`@kernova/framework`:** full-stack agent apps. File-based agents, tools, and triggers (`defineAgent`, `defineTool`, `defineTrigger`), skills, MCP servers, and React hooks
- **`@kernova/sdk`:** the high-level API (`Kernova.create()`, `app.ask()`)
- **`@kernova/cli`, `create-kernova-app`, and `kernova`:** scaffolding, `kernova dev`, `kernova doctor`, deploys, and Kernova Studio
- **`sdks/`:** small HTTP clients for Python, Go, Java, C#, Rust, and Swift

## Now: autonomous agents you can rely on (2.x)

Agents that act on their own (triggers, schedules, channels) are what Kernova is for. These make them dependable:

- **Schedules that survive restarts.** Interval triggers (`schedule.6h`) restart their timer whenever the server restarts, which `kernova dev` does on every file change, so long intervals may never fire. Save when each trigger last fired
- **Trigger runs with context.** Memory recall and conversation history are added to HTTP agent requests but not to trigger runs, so autonomous runs start without knowing the user
- **Memory search that finds things.** The Postgres `/memory/search` requires every word of a query to match, so natural questions often return nothing
- **Correct `memory.autoSave`.** It saves the parameters of any tool whose name contains "save", "note", or "remember" (duplicating what those tools store), and saves raw messages that merely contain phrases like "I am"
- **Error messages that say what to do**, especially for provider setup and configuration

## Next

- **Observability:** a trace of each run (model calls, tool calls, tokens, cost) that you can inspect in Studio or export through OpenTelemetry
- **Examples and tutorials:** small, runnable examples for each major feature, kept working by CI
- **Language SDKs:** tests and documentation for the clients in `sdks/`, and publishing them to their package registries
- **More integrations:** channel adapters and tools that people ask for. Open an issue to suggest one

## Later: Kernova 3.0

Breaking changes wait for the next major version and are collected under the [`breaking change`](https://github.com/GodwinAdu/kernova/labels/breaking%20change) label. Planned so far:

- Remove the deprecated `Nexus*` aliases (`NexusKernel`, `Nexus`, `NexusId`, `NexusEvent`, `NexusObject`, `NexusPlugin`, `NexusConfig`)

## Areas

| Area | Where | What it covers |
|------|-------|----------------|
| Core engine | `packages/core` | Kernel, intents, execution, events, persistence |
| Agents and tools | `packages/core`, `packages/framework` | Agent lifecycle, tool calling, built-in tools, skills, MCP |
| Memory | `packages/core` | Memory layers, search, embeddings, autoSave |
| Models | `packages/core/src/models` | Providers, model catalog, `kernova doctor` |
| Triggers and channels | `packages/core` (`src/channels`), `packages/framework` | Schedules, events, webhooks, channel adapters |
| Developer experience | `packages/cli`, `packages/create-kernova-app`, `packages/studio`, `website/` | CLI, scaffolding, Studio, documentation |
| Language SDKs | `sdks/` | Clients for other languages |

The detailed history of what was built when is in [`CHANGELOG.md`](CHANGELOG.md).
