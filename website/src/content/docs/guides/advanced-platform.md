---
title: Advanced Platform Features
description: Model fallback, sub-agents, tool policies, MCP integration, webhooks, and execution tracing.
---

These features turn Kernova from a simple agent runtime into a production platform — resilient model routing, hierarchical agent delegation, fine-grained access control, and full observability.

## Model Fallback Chains

When your primary model provider is down or rate-limited, automatically cascade to alternatives.

```typescript
const result = await kernel.fallback.complete(
  {
    messages: [{ role: 'user', content: 'Summarize this document' }],
    model: '',
  },
  {
    candidates: [
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'ollama', model: 'llama3' },    // Local fallback
    ],
    cooldownMs: 60_000,      // Cool down failed candidates for 1 minute
    totalTimeoutMs: 30_000,  // Give up after 30s total
  }
);

if (result.success) {
  console.log(`Response from ${result.usedCandidate.provider}/${result.usedCandidate.model}`);
  console.log(result.result.content);
} else {
  console.log(`All candidates failed after ${result.attempts.length} attempts`);
  for (const attempt of result.attempts) {
    console.log(`  ${attempt.provider}: ${attempt.reason} — ${attempt.error}`);
  }
}
```

### How Cooldown Works

When a candidate fails, it goes on cooldown with exponential backoff:
- 1st failure: 60s cooldown
- 2nd consecutive failure: 120s cooldown
- 3rd: 240s (capped at configurable max)
- After a success: cooldown resets

```typescript
// Check which candidates are available right now
const available = kernel.fallback.getAvailableCandidates(chain);

// Manually reset a cooldown
kernel.fallback.resetCooldown({ provider: 'openai', model: 'gpt-4o' });
```

### Error Classification

The fallback manager classifies errors automatically:

| Reason | Typical Cause | Behavior |
|--------|---------------|----------|
| `rate_limit` | 429 response | Cooldown, try next |
| `timeout` | Request too slow | Cooldown, try next |
| `auth` | Invalid API key | Cooldown, try next |
| `model_not_found` | Model deprecated | Skip permanently |
| `context_overflow` | Prompt too long | Try next (smaller model) |
| `billing` | Payment issue | Cooldown, try next |

---

## Sub-Agent Spawning

Delegate work to child agents. Parents can spawn children that execute independently and report back.

```typescript
// Spawn a research sub-agent
const child = await kernel.subagents.spawn('parent_agent_id', {
  agentName: 'researcher',
  goal: 'Find the top 5 TypeScript testing frameworks and compare their features',
  mode: 'run',              // One-shot: run and return result
  contextMode: 'isolated',  // Fresh context (no parent history)
  timeoutMs: 60_000,        // 1 minute max
});

// The child runs through the full kernel pipeline:
// intent creation → agent selection → execution → result

// Check on it later
const status = kernel.subagents.get(child.id);
if (status?.status === 'completed') {
  console.log('Research result:', status.result);
}

// List all children of a parent
const children = kernel.subagents.listChildren('parent_agent_id');

// Cancel a running child
kernel.subagents.cancel(child.id);
```

### Safety Limits

- **Max depth: 3** — Prevents infinite spawning chains
- **Max children per parent: 5** — Prevents fork bombs
- **Timeout enforcement** — Children are killed after their timeout

---

## Tool Availability DSL

Declaratively control which tools are visible based on runtime conditions.

```typescript
import { ToolAvailabilityEngine } from '@kernova/core';

const engine = kernel.toolAvailability;

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
    name: 'send-email',
    description: 'Send an email',
    availability: { kind: 'plugin', pluginId: 'email-plugin' },
  },
  {
    name: 'web-search',
    description: 'Search the internet',
    availability: { kind: 'always' },  // Always visible
  },
];

const plan = engine.buildPlan(tools, {
  authProviders: new Set(['github']),
  env: { GITHUB_TOKEN: 'ghp_xxx' },
  enabledPlugins: new Set([]),  // email-plugin not enabled
});

console.log(plan.visible);
// [github-create-pr, web-search]

console.log(plan.hidden);
// [{ descriptor: send-email, diagnostics: [{ reason: 'plugin-disabled' }] }]
```

### Availability Signals

| Signal | Passes When |
|--------|-------------|
| `{ kind: 'always' }` | Always visible |
| `{ kind: 'auth', providerId }` | Auth provider is configured |
| `{ kind: 'env', name }` | Environment variable is set |
| `{ kind: 'config', path }` | Config path exists (and is non-empty) |
| `{ kind: 'plugin', pluginId }` | Plugin is enabled |
| `{ kind: 'context', key, equals }` | Context value matches |

### Boolean Composition

```typescript
// All conditions must pass
{ allOf: [{ kind: 'auth', providerId: 'github' }, { kind: 'env', name: 'GITHUB_TOKEN' }] }

// At least one must pass
{ anyOf: [{ kind: 'env', name: 'OPENAI_KEY' }, { kind: 'env', name: 'ANTHROPIC_KEY' }] }

// Nested
{ allOf: [
  { kind: 'auth', providerId: 'slack' },
  { anyOf: [
    { kind: 'context', key: 'channel', equals: 'support' },
    { kind: 'context', key: 'role', equals: 'admin' },
  ]}
]}
```

---

## Tool Policy Engine

Multi-layer allow/deny pipeline for restricting tool access per agent, user, or role.

The kernel applies two layers automatically on every intent: `KernelConfig.toolPolicy`, then the agent's own `toolPolicy` from `defineAgent()`. Tools that don't pass are neither offered to the model nor runnable through `tools.useTool()`. Patterns match a tool's own ID (`'shell-exec'`, `'github_create_issue'`) as well as its registered ID, and a `deny` match on any of them wins.

```typescript
const kernel = new KernovaKernel({
  environment: 'production',
  toolPolicy: { deny: ['github_delete_*'] },
});

const support = defineAgent({
  name: 'support',
  // ...
  toolPolicy: { allow: ['http-fetch', 'github_*'] },
});
```

You can also run the engine directly:

```typescript
const allowed = kernel.toolPolicy.apply(
  ['read', 'write', 'exec', 'search', 'delete', 'email'],
  [
    { name: 'global', policy: { allow: ['*'] } },           // Start with all
    { name: 'production', policy: { deny: ['exec', 'delete'] } }, // Remove dangerous
    { name: 'user-role', policy: { allow: ['read', 'search', 'email'] } }, // Further restrict
  ]
);
// Result: ['read', 'search', 'email']

// Check a single tool
kernel.toolPolicy.isAllowed('exec', layers); // false
```

Glob patterns are supported: `'github_*'`, `'*_admin'`, `'*'`.

---

## MCP Bridge (Model Context Protocol)

Connect to any MCP server and import its tools into your agent's toolkit.

```typescript
// Register an MCP server
const server = kernel.mcp.register({
  name: 'GitHub',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
  },
  toolPrefix: 'github_',
  enabled: true,
});

// Connect and discover tools
const tools = await kernel.mcp.connect(server.id);
console.log(`Discovered ${tools.length} tools`);
// Discovered 12 tools

// Once connected, the server's tools are registered as plugin tools (with toolPrefix),
// so agents can call them and tool policies apply. They're removed on disconnect.
// Call directly if needed:
const result = await kernel.mcp.callTool(server.id, 'create_issue', {
  repo: 'my-org/my-repo',
  title: 'Bug report',
  body: 'Details...',
});

// List all connected servers
kernel.mcp.listServers();
```

---

## Webhook Router

Accept inbound webhooks and route them to agents.

```typescript
kernel.webhooks.register({
  path: '/hooks/github',
  method: 'POST',
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  transform: {
    signatureHeader: 'x-hub-signature-256',
    signatureAlgorithm: 'sha256',
  },
  target: {
    type: 'intent',
    goal: 'Process GitHub webhook event and take appropriate action',
    priority: 'high',
  },
  enabled: true,
});

// Webhooks are handled by the gateway at /hooks/*
// The body is verified, parsed, and routed to kernel.submit()
```

---

## Trajectory Recorder

Record every step of agent execution for debugging and auditing.

```typescript
// Enable with debug mode
const kernel = new KernovaKernel({ environment: 'development', debug: true });

// After running some intents...
const traces = kernel.trajectory.listTraces();
for (const trace of traces) {
  console.log(`Trace: ${trace.id}`);
  console.log(`  Goal: ${trace.metadata.intentGoal}`);
  console.log(`  Duration: ${trace.metadata.durationMs}ms`);
  console.log(`  Events: ${trace.events.length}`);
}

// Export a trace as JSONL for external analysis
const jsonl = kernel.trajectory.exportJsonl(traces[0].id);
writeFileSync('trace.jsonl', jsonl);
```

Each trace records: intent submission → agent selection → tool calls → model requests → completion. Sensitive data (API keys, tokens) is automatically redacted.
