# Advanced Modules

Platform-grade capabilities for production AI agent systems.

## Model Fallback Manager

Multi-candidate model routing with cooldown, circuit-breaking, and automatic failover.

```typescript
const kernel = app.getKernel();

// Define a fallback chain
const result = await kernel.fallback.complete(
  { messages: [{ role: 'user', content: 'Hello' }], model: '' },
  {
    candidates: [
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'ollama', model: 'llama3' },
    ],
    cooldownMs: 60_000,
    totalTimeoutMs: 120_000,
  },
);

if (result.success) {
  console.log(result.result.content);
  console.log(`Used: ${result.usedCandidate.provider}/${result.usedCandidate.model}`);
} else {
  console.log(`All ${result.attempts.length} candidates failed`);
}
```

### Features
- Ordered candidate chains with priority
- Per-candidate cooldown with exponential backoff
- Error classification (rate_limit, timeout, auth, billing, etc.)
- Circuit-breaking when all candidates exhaust
- Total timeout enforcement across all attempts

---

## Sub-Agent Manager

Spawn child agents for task delegation with depth limiting.

```typescript
// Spawn a child agent
const child = await kernel.subagents.spawn('parent-agent-id', {
  agentName: 'researcher',
  goal: 'Find the top 5 TypeScript ORMs and compare them',
  mode: 'run',           // one-shot execution
  contextMode: 'isolated', // fresh context
  timeoutMs: 30_000,
});

// Check status later
const status = kernel.subagents.get(child.id);
console.log(status?.result);

// List children of a parent
const children = kernel.subagents.listChildren('parent-id');

// Cancel a running sub-agent
kernel.subagents.cancel(child.id);
```

### Features
- Depth limiting (default: 3 levels deep)
- Per-parent concurrency limits (default: 5 children)
- Timeout enforcement per child
- Isolated or forked context modes
- Event-driven lifecycle (spawned, completed, failed, timeout)

---

## Tool Availability Engine

Declarative DSL for conditional tool visibility.

```typescript
import { ToolAvailabilityEngine } from '@kernova/core';

const engine = new ToolAvailabilityEngine();

const tools = [
  {
    name: 'github-create-pr',
    description: 'Create a pull request',
    availability: {
      allOf: [
        { kind: 'auth', providerId: 'github' },
        { kind: 'env', name: 'GITHUB_TOKEN' },
      ],
    },
  },
  {
    name: 'slack-send',
    description: 'Send a Slack message',
    availability: { kind: 'plugin', pluginId: 'slack' },
  },
  {
    name: 'search',
    description: 'Search the web',
    availability: { kind: 'always' },
  },
];

const plan = engine.buildPlan(tools, {
  authProviders: new Set(['github']),
  env: { GITHUB_TOKEN: 'ghp_...' },
  enabledPlugins: new Set([]),
});

console.log(plan.visible);  // [github-create-pr, search]
console.log(plan.hidden);   // [slack-send: plugin-disabled]
```

---

## Tool Policy Engine

Multi-layer allow/deny pipeline for tool access control.

```typescript
import { ToolPolicyEngine } from '@kernova/core';

const policy = new ToolPolicyEngine();

const allTools = ['read', 'write', 'exec', 'search', 'email'];

const allowed = policy.apply(allTools, [
  { name: 'global', policy: { allow: ['*'] } },
  { name: 'agent', policy: { deny: ['exec'] } },
  { name: 'user', policy: { allow: ['read', 'search', 'write'] } },
]);
// Result: ['read', 'search', 'write']

// Check a single tool
policy.isAllowed('exec', layers); // false
```

---

## Webhook Router

Inbound webhook handling with signature verification and routing.

```typescript
// Register a webhook route
kernel.webhooks.register({
  path: '/hooks/github',
  method: 'POST',
  secret: process.env.GITHUB_WEBHOOK_SECRET,
  transform: {
    signatureHeader: 'x-hub-signature-256',
    signatureAlgorithm: 'sha256',
  },
  target: {
    type: 'intent',
    goal: 'Process GitHub webhook event',
    priority: 'high',
  },
  enabled: true,
});

// Handle incoming request (from your HTTP server)
const result = await kernel.webhooks.handle({
  method: 'POST',
  path: '/hooks/github',
  headers: req.headers,
  body: req.body,
});

if (result.matched) {
  console.log('Webhook processed');
}
```

### Features
- Path-based route matching with wildcards
- HMAC signature verification (SHA-256, SHA-1)
- Multiple target types: intent submission, event emission, agent dispatch
- Recent event history
- Enable/disable per route

---

## Trajectory Recorder

Execution trace recording for debugging AI agent runs.

```typescript
const kernel = new KernovaKernel({
  environment: 'development',
  debug: true, // Enables trajectory recording
});

// Traces are recorded automatically when debug=true
// You can also manually control traces:
const trace = kernel.trajectory.beginTrace({ goal: 'User query' });
kernel.trajectory.record(trace.id, 'intent.submitted', { goal: 'Hello' });
kernel.trajectory.record(trace.id, 'agent.selected', { agent: 'assistant' });
kernel.trajectory.record(trace.id, 'model.request', { provider: 'openai' });
kernel.trajectory.record(trace.id, 'model.response', { tokens: 150 });
kernel.trajectory.endTrace(trace.id, { totalTokens: 150 });

// Export as JSONL for analysis
const jsonl = kernel.trajectory.exportJsonl(trace.id);

// List recent traces
const traces = kernel.trajectory.listTraces();
```

### Features
- Automatic recording from EventBus (when enabled)
- Manual trace control for custom instrumentation
- Secret redaction (keys, tokens, passwords)
- JSONL export for external tools
- Size-bounded (max events per trace, max age)
- Per-trace metadata (goal, agent, tokens, duration)


---

## MCP Bridge (Model Context Protocol)

Connect to external MCP servers to import their tools into your agent's inventory. Supports stdio (process spawn) and SSE transports.

```typescript
// Register an MCP server
const server = kernel.mcp.register({
  name: 'GitHub Tools',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
  },
  toolPrefix: 'github_',  // Tools become: github_create_issue, github_search, etc.
  enabled: true,
});

// Connect and discover tools
const tools = await kernel.mcp.connect(server.id);
console.log(`Discovered ${tools.length} tools from GitHub MCP server`);

// Tools are automatically available to agents during execution
// They're merged into the tool inventory in the executeIntent() pipeline

// Call a tool directly
const result = await kernel.mcp.callTool(server.id, 'create_issue', {
  repo: 'my-org/my-repo',
  title: 'Bug: login broken',
  body: 'Users cannot log in after the latest deploy.',
});

// List all tools from all connected servers
const allMcpTools = kernel.mcp.getAllTools();

// Disconnect
await kernel.mcp.disconnect(server.id);

// Clean up all connections
await kernel.mcp.dispose();
```

### Multiple Servers

```typescript
// Connect to multiple MCP servers simultaneously
kernel.mcp.register({
  name: 'Database',
  transport: { type: 'stdio', command: 'npx', args: ['-y', '@mcp/server-postgres'] },
  toolPrefix: 'db_',
  enabled: true,
});

kernel.mcp.register({
  name: 'File System',
  transport: { type: 'stdio', command: 'npx', args: ['-y', '@mcp/server-filesystem'] },
  toolPrefix: 'fs_',
  enabled: true,
});

// Connect all
for (const server of kernel.mcp.listServers()) {
  await kernel.mcp.connect(server.id);
}
```

---

## Pluggable Context Engine

Replace Kernova's default context management with a custom implementation. Useful for integrating vector databases, external memory stores, or specialized compaction strategies.

### Using the Default Engine

The default context engine is automatically active. It:
- Queries the memory system for relevant context
- Assembles messages under a token budget
- Auto-compacts when the budget threshold is exceeded
- Uses LLM summarization for compaction

### Registering a Custom Engine

```typescript
import type { ContextEnginePlugin, AssembleResult, CompactResult } from '@kernova/core';

class MyVectorDBEngine implements ContextEnginePlugin {
  readonly info = {
    id: 'my-vector-db',
    name: 'Custom Vector DB Engine',
    version: '1.0.0',
    ownsCompaction: true,
  };

  async assemble(params) {
    // Query your vector DB for relevant context
    const relevant = await myVectorDB.search(params.prompt, params.tokenBudget);
    return {
      messages: relevant.map(doc => ({
        id: doc.id,
        role: 'system',
        content: doc.text,
        timestamp: doc.createdAt,
      })),
      estimatedTokens: relevant.reduce((sum, d) => sum + d.tokens, 0),
    };
  }

  async compact(params) {
    // Your compaction logic
    await myVectorDB.compact(params.sessionId);
    return { compacted: true, tokensBefore: 8000, tokensAfter: 2000 };
  }
}

// Register and activate
kernel.contextEngines.register(new MyVectorDBEngine());
kernel.contextEngines.setDefault('my-vector-db');
```

### Context Engine Lifecycle

```
bootstrap() → ingest() → assemble() → [agent runs] → afterTurn() → compact() → maintain()
```

| Method | When Called | Purpose |
|--------|-----------|---------|
| `bootstrap()` | Session start | Initialize state, import history |
| `ingest()` | After each message | Store new messages |
| `assemble()` | Before agent execution | Build token-budgeted prompt |
| `compact()` | When budget exceeded | Summarize/prune old context |
| `maintain()` | After successful turns | Background maintenance |
| `afterTurn()` | Post-execution | Trigger auto-compaction decisions |
| `dispose()` | Shutdown | Clean up resources |
