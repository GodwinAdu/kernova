# Kernova — Progress Tracker

> Single source of truth for what's been built, what's in progress, and what's next.
> Updated after every significant milestone.

---

## Current Phase: Foundation (v0.1.x)

**Objective:** Working runtime that can receive an intent, route it to an agent, execute it, and return a result with evidence.

---

## Completed ✓

### Infrastructure
- [x] Monorepo structure (npm workspaces + Turborepo)
- [x] TypeScript configuration (base + per-package)
- [x] Build pipeline (types → core → cli)
- [x] Git ignore patterns
- [x] README with project overview

### @kernova/types (Universal Object Model)
- [x] `base.ts` — KernovaObject, Temporal, Evidence, core types
- [x] `intent.ts` — Intent object with full lifecycle
- [x] `agent.ts` — Agent definitions and instances
- [x] `event.ts` — Event system (KernovaEvent, subscriptions, timelines)
- [x] `memory.ts` — Five-layer memory architecture
- [x] `workflow.ts` — Workflow definitions and execution
- [x] `identity.ts` — Identity, roles, organizations, policies

### @kernova/core (Runtime Kernel)
- [x] `kernel.ts` — KernovaKernel with intent submission pipeline
- [x] `event-bus.ts` — In-memory event bus with pattern matching
- [x] `memory-engine.ts` — In-memory implementation of 5-layer memory
- [x] `agent-registry.ts` — Agent registration, selection, execution
- [x] `context-engine.ts` — Computed context assembly
- [x] `define-agent.ts` — Developer-facing agent definition API
- [x] `utils.ts` — ID generation, timestamps, retry logic

### @kernova/cli (Developer Tools)
- [x] `kernova --help` — Help output with banner
- [x] `kernova init <name>` — Project scaffolding
- [x] `kernova dev` — Development runtime startup
- [x] `kernova agent create <name>` — Agent boilerplate generation
- [x] `kernova agent list` — List registered agents
- [x] `kernova status` — Project status display

### Documentation
- [x] `README.md` — Project overview
- [x] `AGENT.md` — AI agent instructions for consistent development
- [x] `docs/VISION.md` — Why Kernova exists
- [x] `docs/PROGRESS.md` — This file
- [x] `docs/ARCHITECTURE.md` — Technical architecture
- [x] `CONTRIBUTING.md` — How to contribute
- [x] `docs/decisions/001-005` — First 5 Architecture Decision Records
- [x] `docs/specs/model-provider-system.md` — Model system specification
- [x] `.kiro/steering/kernova-project.md` — Kiro steering instructions

### Model System (LLM Integration)
- [x] `@kernova/types/model.ts` — Universal Model Protocol types (multimodal-ready)
- [x] `ModelProvider` interface — Abstract contract for any provider
- [x] **Adapter Registry** — Config-driven provider creation (zero code for new providers)
- [x] **Provider Catalog** — 20+ pre-configured providers
- [x] Native adapters:
  - [x] OpenAI (GPT-4o, embeddings, vision)
  - [x] Anthropic (Claude 3.5/4, vision)
  - [x] Google Gemini (2.0 Flash, 1.5 Pro, embeddings, audio)
  - [x] Ollama (any local model — Llama, Mistral, Phi, etc.)
- [x] OpenAI-compatible adapter (covers any provider using that format):
  - [x] DeepSeek, Groq, Cerebras, SambaNova
  - [x] Mistral, Cohere, xAI/Grok
  - [x] Together AI, OpenRouter, Fireworks, Perplexity
  - [x] Azure OpenAI, AWS Bedrock
  - [x] LM Studio, vLLM, llama.cpp (local/self-hosted)
  - [x] Any future OpenAI-compatible API (zero code needed)
- [x] `createProvider()` — One-line provider creation from preset names
- [x] `createProviderFromConfig()` — Create from config object (for kernova.config.json)
- [x] `detectProvidersFromCatalog()` — Auto-detect from environment variables
- [x] `ModelRouter` — Provider selection, fallback chains, token tracking
- [x] Kernel auto-detection — Scans env vars, registers available providers
- [x] Agent integration — `tools.complete()` available to all agents
- [x] Default LLM executor — Agents without custom `execute` use LLM automatically
- [x] Multimodal types — Vision, audio, file content parts (ready for future use)
- [x] Capability declarations — Providers declare what they support
- [x] Working examples — `hello-kernova.ts`, `custom-agent.ts`, `multi-provider.ts`

### Event Persistence (SQLite)
- [x] `EventStore` class — SQLite-backed durable event storage
- [x] WAL mode + batched inserts — High-performance writes
- [x] Schema auto-migration — Database created on first run
- [x] Indexed queries — subject, type, correlation, timestamp
- [x] `EventBus` updated — Dual-mode (in-memory + persistent)
- [x] `query()` — Rich event filtering (type, category, actor, time range)
- [x] `getTimeline()` — Full history for any object
- [x] `getCorrelated()` — Trace a complete request flow
- [x] `getStats()` — Event store statistics
- [x] Kernel integration — `dataDir` config, `ephemeral` mode option
- [x] Verified: Events survive process restarts ✓
- [x] Working example — `event-persistence.ts`

### Memory Persistence (SQLite + FTS5 Search)
- [x] `MemoryStore` class — SQLite-backed persistent memory storage
- [x] FTS5 full-text search — Built-in semantic text search (no external deps)
- [x] Five-layer storage — Working, session, long-term, organizational, global
- [x] Memory relations — Links between memories preserved
- [x] Memory decay — Relevance decreases over time for stale memories
- [x] Layer-filtered queries — Query one or multiple layers
- [x] Tag-based filtering — Find memories by category tags
- [x] Owner-scoped queries — Memory isolation per user/agent
- [x] `MemoryEngine` updated — Dual-mode (in-memory + persistent)
- [x] Kernel integration — Shared `kernova.db` with event store
- [x] Verified: Memories survive process restarts ✓
- [x] Verified: Full-text search finds relevant memories ✓
- [x] Verified: Memory decay reduces relevance ✓
- [x] Working example — `memory-persistence.ts`

### Hot Reload (Dev Mode)
- [x] `DevServer` class — Orchestrates kernel + watcher + loader
- [x] `FileWatcher` — Native `fs.watch` with debounce (100ms)
- [x] `AgentLoader` — Dynamic import with cache-bust for fresh loads
- [x] Error isolation — Bad agent code doesn't crash the runtime
- [x] `kernova dev` updated — Uses DevServer, shows persistent status
- [x] Auto-loads agents from `src/agents/` on startup
- [x] Reports loaded agents with timing
- [x] Verified: Agent loaded from disk on `kernova dev` startup ✓
- [x] Verified: File changes trigger reload ✓

### Kernova Studio (Web Dashboard)
- [x] `StudioServer` — Embedded HTTP server (native Node.js, zero deps)
- [x] REST API endpoints:
  - [x] `GET /api/status` — Runtime status, providers, usage
  - [x] `GET /api/agents` — List registered agents
  - [x] `GET /api/events` — Query events with filters
  - [x] `GET /api/events/stream` — Server-Sent Events (real-time)
  - [x] `GET /api/memory` — Query/search memories
  - [x] `POST /api/intents` — Submit intents via API
- [x] Web Dashboard (self-contained HTML, no build step):
  - [x] Real-time event stream (SSE)
  - [x] Event viewer with timestamps and categories
  - [x] Memory browser with full-text search
  - [x] Agent inspector
  - [x] Intent submission form with results display
  - [x] System status panel
  - [x] Dark theme, monospace design
- [x] Auto-starts with `kernova dev` on port 4200
- [x] Verified: API returns correct data ✓
- [x] Verified: Dashboard serves at localhost:4200 ✓

### Plugin System
- [x] `PluginRegistry` — Register, unregister, manage plugins
- [x] `ToolDefinition` — Tools agents can call (with parameter schema)
- [x] `MiddlewareHook` — Intercept intent pipeline (before/after)
- [x] Plugin context — Init function receives registrars + event bus
- [x] Tool execution — `plugins.executeTool(id, params)` with event tracking
- [x] Middleware pipeline — `runMiddleware('before', context)` with halt support
- [x] Kernel integration — `kernel.plugins` accessor

### Workflow Engine
- [x] `WorkflowEngine` — Multi-step execution orchestrator
- [x] Step types: agent, tool, condition, approval, parallel, wait, transform
- [x] Sequential execution with step results tracking
- [x] Parallel execution (`Promise.all` for concurrent steps)
- [x] Conditional branching (expression-based)
- [x] Human-in-the-loop approval gates (`onApproval` handler)
- [x] Compensation — undo completed steps on failure (reverse order)
- [x] Retry on failure (per-step policy)
- [x] Event emission at every lifecycle point
- [x] Kernel integration — `kernel.workflows` accessor

### Tool Calling (Agent ↔ Plugin Integration)
- [x] `ToolSpec` and `ToolCall` types — Model-level tool definitions
- [x] OpenAI provider updated — Sends tools, parses tool_calls in response
- [x] `tools.completeWithTools()` — LLM-driven tool-calling loop (max 10 iterations)
- [x] `tools.useTool()` — Direct tool execution from agent code
- [x] `tools.listTools()` — Discover available tools
- [x] Default executor updated — Auto-uses tools when plugins are registered
- [x] Event emission — `agent.tool_call` events for observability
- [x] Kernel wiring — PluginRegistry connected to AgentRegistry
- [x] Verified: Direct tool execution works ✓
- [x] Working example — `tool-calling.ts`

### Testing
- [x] Vitest configured (v4.x)
- [x] `kernel.test.ts` — 7 tests (lifecycle, intents, agents, error handling)
- [x] `event-bus.test.ts` — 6 tests (pub/sub, wildcards, timeline, query)
- [x] `memory.test.ts` — 7 tests (store, query, layers, search, delete, stats)
- [x] `plugins.test.ts` — 8 tests (register, tools, middleware, halt, unregister)
- [x] All 28 tests passing ✓

### Vector Embeddings (Semantic Memory Search)
- [x] `EmbeddingEngine` — Provider-agnostic embedding generation
- [x] Cosine similarity search — In-memory vector comparison
- [x] SQLite BLOB storage — Vectors stored as Float32 buffers
- [x] Hybrid search — Semantic (vector) + keyword (FTS5) with fallback
- [x] Lazy embedding generation — On store, non-blocking
- [x] `MemoryStore.storeEmbedding()` — Persist vector for a memory
- [x] `MemoryStore.getEmbeddings()` — Retrieve vectors for search
- [x] Schema migration — Adds `embedding` column to existing databases
- [x] Graceful degradation — Falls back to FTS5 when no embedding provider

### @kernova/sdk (High-Level Developer API)
- [x] `Kernova.create()` — One-line runtime initialization
- [x] `app.agent(name, { instructions })` — Minimal agent definition
- [x] `app.tool(name, { execute })` — Minimal tool registration
- [x] `app.ask(goal)` — Submit intents, get answers
- [x] `app.remember(content, layer)` — Store memories
- [x] `app.recall(query)` — Search memories
- [x] `app.workflow(definition)` — Register workflows
- [x] `app.close()` — Graceful shutdown
- [x] Helper functions: `agent()`, `tool()`, `workflow()`
- [x] Re-exports common types for convenience

### Identity & Auth System
- [x] `IdentityManager` — Central identity management (users, agents, services)
- [x] `ApiKeyManager` — Generate, validate, revoke API keys (SHA-256 hashed, `nxs_` prefix)
- [x] `SessionManager` — Token-based sessions with TTL and cleanup
- [x] `PermissionEngine` — Role-based access control with wildcard matching
- [x] Built-in roles: admin (`*`), developer, agent, viewer
- [x] Permission format: `resource:action` with wildcard support
- [x] Organization support — Create orgs, add members, scope resources
- [x] Authentication methods: API key, session token
- [x] `kernel.identity` accessor — Full auth system on the kernel
- [x] Event emission — All auth events logged (register, deny, etc.)
- [x] 18 tests covering: registration, API keys, sessions, permissions, organizations ✓

### Streaming Responses
- [x] `StreamChunk` type — Content, done flag, usage, finish reason
- [x] `ModelProvider.stream()` — Optional async generator on provider interface
- [x] `OpenAIProvider.stream()` — Full SSE parsing, token-by-token yield
- [x] `ModelRouter.stream()` — Routes to provider, simulates if not supported
- [x] `tools.stream(prompt)` — AsyncGenerator yielding text chunks in agent executors
- [x] `tools.streamToString(prompt)` — Convenience collect-all wrapper
- [x] Token tracking — Usage reported from final stream chunk
- [x] Fallback — Non-streaming providers simulated as word-by-word chunks

### Multi-Agent Coordination
- [x] `AgentCoordinator` — Delegation, ask, and broadcast patterns
- [x] `tools.delegate(agentName, goal)` — Delegate to a specific named agent
- [x] `tools.ask(goal)` — Let kernel select the best agent
- [x] `tools.broadcast(goal)` — Try all agents, return first success
- [x] `selectAgentByName()` — Route delegation to the correct agent
- [x] Sub-intents — Delegated tasks tracked as child intents with parent reference
- [x] Delegation depth limit (default: 5) — Prevents infinite recursion
- [x] Delegation timeout — Prevents hung delegations
- [x] Event trail — All delegation events logged (started, completed, failed)
- [x] 4 tests: delegation, ask, depth limit, agent-not-found ✓

### Rate Limiting & Cost Control
- [x] `BudgetManager` — Token budgets, rate limits, cost caps
- [x] Global budget — `maxTokens`, `maxCostUsd`, `maxTokensPerIntent`, `requestsPerMinute`
- [x] Per-identity budget — `maxTokensPerDay`, `maxTokensPerHour`, `requestsPerMinute`, `maxCostPerDayUsd`
- [x] Sliding window rate limiting — Counts requests in last 60 seconds
- [x] Cost estimation — $3/1M tokens default, tracks estimated USD spend
- [x] `budget.check(identityId, tokens)` — Pre-check before LLM calls
- [x] `budget.record(identityId, tokens)` — Record usage after LLM calls
- [x] `budget.getUsage(identityId)` — Query usage per identity
- [x] `budget.getGlobalUsage()` — Query total runtime usage
- [x] `resetHourly()` / `resetDaily()` — Counter resets for rolling windows
- [x] Event emission — `governance.budget.exceeded` events when denied
- [x] Kernel integration — `kernel.budget` accessor
- [x] 13 tests: global budget, identity budget, rate limiting, usage tracking ✓

### Kernova Protocol Specification
- [x] `NP-000` — Overview: goals, conformance levels, wire format
- [x] `NP-001` — Intent Protocol: object schema, lifecycle, operations, events
- [x] `NP-002` — Agent Protocol: definition, registration, delegation, states
- [x] `NP-003` — Memory Protocol: five layers, entry schema, search modes, context computation
- [x] `NP-004` — Event Protocol: object schema, query, timeline, SSE streaming, categories
- [x] `NP-005` — Tool Protocol: definition, execution, LLM tool-calling flow, plugins, middleware
- [x] `NP-006` — Identity Protocol: auth methods, permissions, roles, organizations, governance

### Documentation Site
- [x] `docs/guide/01-getting-started.md` — Zero to working app in 5 minutes
- [x] `docs/guide/02-api-reference.md` — Full SDK + Core + CLI reference
- [x] `docs/guide/03-configuration.md` — Config file, env vars, custom providers
- [x] `CHANGELOG.md` — Full v0.1.0 changelog (Keep a Changelog format)

### NPM Publish Setup
- [x] `LICENSE` — MIT
- [x] `.npmrc` — Public access for scoped packages
- [x] All packages have: license, repository, keywords, files, prepublishOnly
- [x] `npm run build:all` — Ordered build script
- [x] `npm run publish:all` — Publish all packages in dependency order
- [x] Package files restricted to `dist/` + `README.md` (no source in npm)
- [x] Individual README.md for each package (@kernova/types, core, sdk, cli)

### Gap Closures (v0.1 Completion)
- [x] Studio auth enforcement — API routes check Bearer token (API key or session)
- [x] `kernova deploy` command — Generates Dockerfile, production entry, .dockerignore
- [x] `tools.remember()` wired to kernel memory engine (not a stub)
- [x] `tools.recall()` wired to kernel memory engine (not a stub)
- [x] Budget enforced in `kernel.submit()` — checks before processing
- [x] Permissions enforced in `kernel.submit()` — checks for non-system identities
- [x] SDK `app.stream()` — AsyncGenerator for token-by-token streaming
- [x] SDK `app.runWorkflow()` — Execute registered workflows
- [x] Integration test: full pipeline (tools + memory + events + budgets)
- [x] Integration test: budget enforcement blocks over-budget requests
- [x] Integration test: memory recall within agents
- [x] Integration test: delegation pipeline with memory sharing
- [x] Total: 68 tests across 8 files, all passing ✓

---

## In Progress 🔄

*Nothing currently in progress — ready for next task.*

---

## Next Up (Priority Order) 📋

### Phase 1: Make It Real (v0.1.x)
- [x] Connect LLM provider (OpenAI/Anthropic) to agent executor
- [x] Persist events to local SQLite database
- [x] Persist memory to local SQLite + full-text search
- [x] Hot reload agents in `kernova dev` mode
- [ ] Proper error handling and recovery in kernel
- [ ] Add first integration test (init → dev → submit intent → get result)

### Phase 2: Memory (v0.2.x)
- [ ] SQLite-backed memory persistence
- [ ] Vector embeddings for semantic memory search
- [ ] Memory decay (relevance decreases over time)
- [ ] Memory consolidation (merge related memories)
- [ ] Session memory with TTL
- [ ] Memory import/export

### Phase 3: Models (v0.3.x)
- [ ] Model abstraction layer (provider-agnostic)
- [ ] OpenAI provider implementation
- [ ] Anthropic provider implementation
- [ ] Local model support (Ollama)
- [ ] Model routing (choose best model per intent type)
- [ ] Fallback chains (if primary fails, try secondary)
- [ ] Token tracking and budget management

### Phase 4: Workflows (v0.4.x)
- [ ] Workflow definition DSL
- [ ] Sequential step execution
- [ ] Parallel step execution
- [ ] Conditional branching
- [ ] Human-in-the-loop approval
- [ ] Compensation (undo on failure)
- [ ] Long-running process support

### Phase 5: Identity & Governance (v0.5.x)
- [ ] User authentication
- [ ] API key management
- [ ] Role-based permissions
- [ ] Organization/team support
- [ ] Policy engine
- [ ] Audit logging
- [ ] Rate limiting

### Phase 6: Studio (v0.6.x)
- [ ] Web UI for intent inspection
- [ ] Event timeline visualization
- [ ] Memory browser
- [ ] Agent debugger
- [ ] Real-time event streaming
- [ ] Performance dashboard

---

## Known Technical Debt

None remaining. All previous limitations have been resolved:

| Previously | Resolution |
|---|---|
| Anthropic native tool calling | ✓ Implemented — parses `tool_use` blocks, sends `input_schema` |
| Agent selection first-match | ✓ Fixed — capability scoring with description + intent matching |
| Event store grows indefinitely | ✓ Fixed — `applyRetention(days)` deletes old events |
| Workflow approval needs external trigger | ✓ Fixed — `resolveApproval()` + `getPendingApprovals()` |
| Session/key in-memory only | ✓ Fixed — `IdentityStore` persists to SQLite |
| No HTTPS in Studio | ✓ Fixed — TLS cert/key config option |
| No health check | ✓ Fixed — `/health` endpoint (no auth required) |

---

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| First successful `kernova init` | July 2026 | ✓ Done |
| First intent processed by LLM | July 2026 | ✓ Done |
| First persistent memory retrieval | July 2026 | ✓ Done |
| First multi-step workflow | July 2026 | ✓ Done |
| First external developer usage | — | Pending |
| v1.0.0 stable release | — | Pending |

---

*Last updated: July 8, 2026*
