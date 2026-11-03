---
title: "Building Agents"
description: Complete guide to creating, configuring, and orchestrating autonomous agents in Kernova — from simple LLM wrappers to complex multi-agent systems.
---

Agents are the core abstraction in Kernova. They receive goals, reason about them, use tools, and produce structured results — all with built-in memory, event tracking, and coordination with other agents.

## What Is a Kernova Agent?

A Kernova agent is an autonomous unit of intelligence with an identity, instructions, capabilities, and access to tools. Unlike a raw LLM call (which is stateless and single-turn), an agent maintains memory across interactions, can call external tools, delegate work to other agents, and track its own performance metrics.

Think of an agent as a specialized worker in an organization. Each worker has a job title (name), a job description (instructions), skills (capabilities), equipment (tools), and a manager that assigns them tasks (the kernel). When a goal arrives, the kernel scores all registered agents and routes the work to the best fit.

There are two ways to create agents:

| Approach | Package | Best For |
|----------|---------|----------|
| `app.agent()` | `@kernova/sdk` | Quick setup, application-level agents |
| `defineAgent()` | `@kernova/core` | Reusable agents, library code, file-based projects |

Both produce identical runtime behavior — the SDK method is syntactic sugar over the Core function.

---

## Creating Your First Agent

### SDK Approach (3 lines)

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create();

app.agent('assistant', {
  instructions: 'You are a helpful assistant. Answer questions clearly and concisely.',
});

const { answer } = await app.ask('What is the capital of France?');
console.log(answer); // "The capital of France is Paris."
```

### Core Approach

```typescript
import { defineAgent, KernovaKernel } from '@kernova/core';

const agent = defineAgent({
  name: 'assistant',
  description: 'General-purpose helpful assistant',
  capabilities: [{ id: 'qa', name: 'Q&A', description: 'Answer questions', confidence: 0.9 }],
  tools: [],
  instructions: 'You are a helpful assistant. Answer questions clearly and concisely.',
});

const kernel = new KernovaKernel({ environment: 'development' });
await kernel.start();

kernel.agentRegistry.register(agent.definition, agent.executor);

const result = await kernel.submit({ goal: 'What is the capital of France?' });
console.log(result.result?.summary);
```

### What Happens Behind the Scenes

When you call `app.ask('What is the capital of France?')`:

1. **Intent creation** — The kernel wraps the goal into an `Intent` object with metadata, priority, and lifecycle tracking.
2. **Agent selection** — The kernel scores all registered agents by matching the goal keywords against their capabilities and descriptions, then picks the highest scorer.
3. **Context computation** — The memory engine retrieves relevant memories for the intent owner and builds a `ComputedContext` object.
4. **Execution** — The selected agent's executor runs, receiving the intent, context, and a `tools` object.
5. **Reflection** — If enabled, the output is evaluated for quality and regenerated if below threshold.
6. **Result** — The structured `IntentResult` is returned with success status, summary text, evidence, and timing.

### Default Executor Behavior

If you don't provide a custom `execute` function, Kernova uses its default LLM executor. This executor:

- Combines the agent's `instructions` (as system prompt) + earlier turns of the intent's thread (when `metadata.threadId` is set) + the intent `goal` + any relevant context memories and retrieved documents
- Checks if tools are registered — if yes, uses `completeWithTools` (multi-turn tool loop); if no, uses plain `complete`
- Returns the LLM response wrapped in a structured `IntentResult`

This means a zero-config agent with registered tools will automatically use those tools when the LLM decides they're needed.

---

## Agent Anatomy (AgentSpec)

The `AgentSpec` interface defines everything about an agent:

```typescript
import { defineAgent } from '@kernova/core';

export default defineAgent({
  name: 'code-reviewer',
  description: 'Reviews code for bugs, security issues, and style violations',
  capabilities: [
    { id: 'review', name: 'Code Review', description: 'Analyze code quality', confidence: 0.95 },
    { id: 'security', name: 'Security Audit', description: 'Find vulnerabilities', confidence: 0.8 },
  ],
  tools: [{ id: 'file-read' }, { id: 'web-search' }],
  instructions: `You are an expert code reviewer. When reviewing code:
1. Check for bugs and logic errors
2. Identify security vulnerabilities (OWASP Top 10)
3. Suggest improvements for readability
4. Be specific — reference line numbers and provide fixed code.`,
  reflection: {
    enabled: true,
    threshold: 0.8,
    maxAttempts: 2,
  },
  async execute(intent, context, tools) {
    // Custom execution logic (optional)
  },
});
```

### Field Reference

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `name` | `string` | Yes | Unique identifier. Used for delegation (`tools.delegate('code-reviewer', ...)`) |
| `description` | `string` | Yes | What the agent does. Used in agent selection scoring — goal keywords are matched against this |
| `capabilities` | `Capability[]` | Yes | Array of skills with confidence scores. Drives selection and routing |
| `tools` | `ToolReference[]` | Yes | The tools this agent is meant to use (descriptive; pass `[]` if none). To restrict what the agent can call, use `toolPolicy` |
| `toolPolicy` | `{ allow?, deny? }` | No | Which tools this agent may call, on top of `KernelConfig.toolPolicy`. Matches tool IDs such as `'http-fetch'`; `*` globs supported |
| `instructions` | `string` | Yes | The system prompt. This is the single most important field for agent quality |
| `execute` | `Function` | No | Custom executor. If omitted, the default LLM executor is used |
| `reflection` | `object` | No | Per-agent quality control config (overrides global settings) |

### Capabilities In Depth

Each capability has four fields:

```typescript
interface Capability {
  id: string;          // Machine identifier (e.g., 'security', 'writing')
  name: string;        // Human-readable name
  description: string; // What this capability covers
  confidence: number;  // 0.0 to 1.0 — how good is this agent at this?
}
```

Capabilities serve two purposes:
1. **Selection** — Higher confidence = more likely to be selected for matching intents
2. **Routing** — `capability.id` is compared against `intent.intentType` for bonus scoring

Be honest with confidence values. An agent with `confidence: 1.0` for everything will be selected for every intent, even ones it handles poorly.

---

## The Agent Tools Interface

Every agent executor receives a `tools` object with methods for LLM communication, memory, tool access, multi-agent coordination, and logging.

```typescript
async execute(intent, context, tools) {
  // tools.complete, tools.delegate, tools.remember, etc.
}
```

### LLM Communication

#### `tools.complete(prompt)`

Simple text completion. Sends the prompt to the LLM with the agent's instructions as the system message.

```typescript
const summary = await tools.complete('Summarize this article in 3 bullet points: ...');
```

Returns a `string` with the model's response.

#### `tools.stream(prompt)`

Streaming async generator. Yields tokens as they arrive from the model.

```typescript
for await (const chunk of tools.stream('Write a poem about Rust')) {
  process.stdout.write(chunk);
}
```

Useful for real-time output in chat interfaces or long-form generation.

#### `tools.streamToString(prompt)`

Convenience wrapper that streams the response and collects it into a single string.

```typescript
const fullResponse = await tools.streamToString('Explain quantum computing');
```

Same result as `tools.complete()` but uses the streaming endpoint internally — helpful when you want streaming-level latency tracking.

#### `tools.completeWithTools(prompt, toolNames?)`

The multi-turn tool-calling loop. This is where agents become truly powerful.

```typescript
// Let the LLM use any available tool
const answer = await tools.completeWithTools('What is the weather in Tokyo?');

// Restrict to specific tools
const result = await tools.completeWithTools(
  'Find the latest Node.js release',
  ['web-search']
);
```

**How the tool loop works:**

1. Your prompt + agent instructions + tool definitions are sent to the LLM
2. If the LLM responds with `tool_calls`, Kernova executes each tool
3. Tool results are appended to the conversation as `tool` messages
4. The updated conversation is sent back to the LLM
5. Steps 2-4 repeat until the LLM responds with plain text (no more tool calls)
6. Maximum **10 iterations** to prevent runaway loops

Each tool call emits an `agent.tool_call` event so you can trace the chain in Studio.

### Memory

#### `tools.remember(content, layer?)`

Store information in the agent's memory for later retrieval.

```typescript
await tools.remember('User prefers dark mode and TypeScript', 'session');
await tools.remember('Company uses PostgreSQL for all projects', 'longterm');
```

Layers:
- `'session'` (default) — Cleared between sessions. Use for current-task context.
- `'longterm'` — Persistent across sessions. Use for user preferences, facts, patterns.

#### `tools.recall(query)`

Search memories by semantic similarity. Returns matching content as an array of strings.

```typescript
const memories = await tools.recall('user preferences');
// ['User prefers dark mode and TypeScript', 'User timezone is PST']
```

### Tool Access

#### `tools.useTool(toolId, params)`

Invoke a registered tool directly without going through the LLM.

```typescript
const html = await tools.useTool('http-fetch', { url: 'https://api.example.com/data' });
const content = await tools.useTool('file-read', { path: './config.json' });
```

Useful when you know exactly which tool to call and don't need LLM reasoning about it.

#### `tools.listTools()`

Get all tools available to this agent.

```typescript
const available = tools.listTools();
for (const tool of available) {
  tools.log(`Tool: ${tool.id} — ${tool.description}`);
}
```

### Multi-Agent Coordination

#### `tools.delegate(agentName, goal)`

Ask a specific named agent to handle a sub-task. Creates a child intent tracked in the timeline.

```typescript
const research = await tools.delegate('researcher', 'Find recent papers on RAG architectures');

if (research.success) {
  const article = await tools.delegate('writer', `Write a summary based on: ${research.response}`);
  return { success: true, summary: article.response, ... };
}
```

Returns a `DelegationResult`:
```typescript
interface DelegationResult {
  success: boolean;      // Did the delegated agent succeed?
  response: string;      // The agent's output text
  agentName: string;     // Which agent handled it
  durationMs: number;    // How long it took
  intentId: string;      // The sub-intent ID (for tracing)
}
```

#### `tools.ask(goal)`

Let the kernel select the best agent for the task. You don't specify which agent — the kernel's scoring algorithm picks one.

```typescript
const answer = await tools.ask('What is the current BTC price?');
// Kernel routes to whichever agent has the best capability match
```

#### `tools.broadcast(goal)`

Try all registered agents in order. Return the first successful response.

```typescript
const translation = await tools.broadcast('Translate "hello" to Japanese');
// Tries each agent until one succeeds
```

### Events & Logging

#### `tools.emit(eventType, data)`

Publish a custom event on the event bus. Events are visible in Studio timeline.

```typescript
tools.emit('analysis.started', { fileCount: 12, language: 'typescript' });
// Published as: agent.analysis.started
```

The event type is automatically prefixed with `agent.` when published.

#### `tools.log(message)`

Log a message. It's always published as an `agent.log` event (visible in Studio), and printed to the console with the agent's name prefix when the kernel runs with `debug: true`.

```typescript
tools.log('Processing 5 files...');
// Output: [Agent:code-reviewer] Processing 5 files...
```

---

## Agent Selection Algorithm

When an intent arrives, the kernel scores every registered agent and picks the highest scorer.

### Scoring Formula

```
score = sum(capability.confidence for each capability)
      + 0.2 * (number of goal words found in agent.description)
      + 0.5 * (if any capability.id === intent.intentType)
```

### Scoring Walkthrough

Given these agents:

```typescript
app.agent('weather-bot', {
  description: 'Fetches weather data and forecasts',
  capabilities: [
    { id: 'weather', name: 'Weather', description: 'Weather queries', confidence: 0.95 },
  ],
  instructions: '...',
});

app.agent('translator', {
  description: 'Translates text between languages',
  capabilities: [
    { id: 'translation', name: 'Translation', description: 'Language translation', confidence: 0.9 },
  ],
  instructions: '...',
});
```

For the intent `"What is the weather in London?"`:

| Agent | Base (confidence) | Keyword matches | Type match | Total |
|-------|------------------|----------------|------------|-------|
| weather-bot | 0.95 | 0.2 ("weather") | 0 | **1.15** |
| translator | 0.9 | 0 | 0 | 0.9 |

The kernel selects `weather-bot`.

### Tips for Effective Selection

- Use descriptive agent `description` values with domain keywords
- Set `confidence` honestly — 0.7-0.8 for "can do it", 0.9-1.0 for "excels at it"
- Match `capability.id` to common intent types your system generates
- Words shorter than 4 characters are ignored in keyword matching

---

## Multi-Agent Patterns

Three coordination patterns let agents collaborate on complex tasks.

### Pattern 1: Delegate

Explicitly route a sub-task to a specific agent by name.

```typescript
app.agent('editor', {
  instructions: 'You coordinate content production pipelines.',
  async execute(intent, context, tools) {
    // Step 1: Research
    const research = await tools.delegate('researcher', `Find sources about: ${intent.goal}`);
    if (!research.success) {
      return { success: false, summary: `Research failed: ${research.response}`, evidence: { sources: [], confidence: 0, reasoning: 'Delegation failed' }, durationMs: research.durationMs };
    }

    // Step 2: Write
    const draft = await tools.delegate('writer', `Write an article using: ${research.response}`);

    // Step 3: Review
    const reviewed = await tools.delegate('reviewer', `Check this for accuracy: ${draft.response}`);

    return {
      success: true,
      summary: reviewed.response,
      evidence: {
        sources: [
          { type: 'memory', ref: research.intentId, label: 'Research', consultedAt: new Date().toISOString() },
          { type: 'memory', ref: draft.intentId, label: 'Draft', consultedAt: new Date().toISOString() },
        ],
        confidence: 0.9,
        reasoning: 'Research → Write → Review pipeline',
      },
      durationMs: research.durationMs + draft.durationMs + reviewed.durationMs,
    };
  },
});
```

**When to use:** You know exactly which agent should handle each step.

### Pattern 2: Ask

Let the kernel's scoring algorithm decide which agent is best.

```typescript
app.agent('orchestrator', {
  instructions: 'You break tasks into sub-goals and dispatch them.',
  async execute(intent, context, tools) {
    const answer = await tools.ask('What is the current BTC price?');
    // Kernel picks the agent with best capability match
    return { success: answer.success, summary: answer.response, evidence: { sources: [], confidence: 0.8, reasoning: `Handled by ${answer.agentName}` }, durationMs: answer.durationMs };
  },
});
```

**When to use:** You don't know (or care) which agent handles it — just that it gets done.

### Pattern 3: Broadcast

Try all agents in order. Return the first successful response.

```typescript
app.agent('dispatcher', {
  instructions: 'You try multiple approaches to solve problems.',
  async execute(intent, context, tools) {
    const result = await tools.broadcast('Translate this to Japanese: Hello world');
    // Tries every agent until one succeeds
    if (result.success) {
      return { success: true, summary: result.response, evidence: { sources: [], confidence: 0.85, reasoning: `Handled by ${result.agentName}` }, durationMs: result.durationMs };
    }
    return { success: false, summary: 'No agent could handle this.', evidence: { sources: [], confidence: 0, reasoning: 'All agents failed' }, durationMs: result.durationMs };
  },
});
```

**When to use:** You have multiple agents that might handle a task, and you want redundancy.

### Coordination Rules

| Rule | Default | Configurable |
|------|---------|-------------|
| Max delegation depth | 5 levels | `CoordinatorConfig.maxDepth` |
| Delegation timeout | 30 seconds | `CoordinatorConfig.delegationTimeoutMs` |
| Delegation failure | Returns `success: false` with error message | N/A |
| Agent not found | Returns error listing available agents | N/A |
| Depth limit reached | Returns error, does not execute | N/A |

### Error Handling

Always check `result.success` after delegation:

```typescript
const result = await tools.delegate('specialist', 'Analyze this data');

if (!result.success) {
  // Handle gracefully
  tools.log(`Delegation failed: ${result.response}`);

  // Possible reasons:
  // - "Agent "specialist" not found. Available: assistant, reviewer"
  // - "Delegation depth limit (5) reached. Cannot delegate further."
  // - "Delegation timed out after 30000ms"
  // - "Delegation failed: <agent-internal-error>"
}
```

### Sub-Intent Tracking

Every delegation creates a child intent linked to the parent:

```
intent_abc (editor)
├── intent_def (researcher)  ← depth 1
├── intent_ghi (writer)      ← depth 1
└── intent_jkl (reviewer)    ← depth 1
    └── intent_mno (fact-checker)  ← depth 2
```

Events emitted:
- `agent.delegation.started` — `{ parentIntentId, subIntentId, targetAgent, goal, depth }`
- `agent.delegation.completed` — `{ parentIntentId, subIntentId, targetAgent, success, durationMs }`
- `agent.delegation.failed` — `{ parentIntentId, subIntentId, targetAgent, error }`

---

## Custom Executors (Advanced)

The default LLM executor handles most cases. Write a custom `execute` function when:

- You need multi-step orchestration with conditional logic
- You want programmatic control over which tools are used and when
- You need to post-process LLM output before returning
- You're building a pipeline that chains multiple operations

### Example 1: Code Reviewer

Reads files, analyzes them with the LLM, stores findings in memory.

```typescript
app.agent('code-reviewer', {
  description: 'Reviews code files for bugs, security, and style',
  capabilities: [
    { id: 'review', name: 'Code Review', description: 'Analyze code quality', confidence: 0.95 },
  ],
  tools: [{ id: 'file-read' }],
  instructions: `You are a senior code reviewer. Focus on:
- Logic errors and bugs
- Security vulnerabilities
- Performance issues
- Naming and readability`,
  async execute(intent, context, tools) {
    const startTime = Date.now();

    // Step 1: Read the target file
    const filePath = intent.goal.match(/review\s+(.+)/i)?.[1] || intent.goal;
    tools.log(`Reading file: ${filePath}`);

    let code: string;
    try {
      code = await tools.useTool('file-read', { path: filePath }) as string;
    } catch (err) {
      return {
        success: false,
        summary: `Could not read file: ${(err as Error).message}`,
        evidence: { sources: [], confidence: 0, reasoning: 'File read failed' },
        durationMs: Date.now() - startTime,
      };
    }

    // Step 2: Analyze with LLM
    const analysis = await tools.complete(`
Review this code and provide findings as JSON:
\`\`\`
${code}
\`\`\`

Respond with: { "issues": [{ "severity": "high"|"medium"|"low", "line": number, "description": string }], "summary": string }
    `);

    // Step 3: Store findings in memory for future reference
    await tools.remember(`Review of ${filePath}: ${analysis}`, 'session');

    tools.emit('review.completed', { filePath, issueCount: analysis.length });

    return {
      success: true,
      summary: analysis,
      evidence: {
        sources: [{ type: 'tool', ref: 'file-read', label: filePath, consultedAt: new Date().toISOString() }],
        confidence: 0.9,
        reasoning: `Analyzed ${code.split('\n').length} lines of code`,
      },
      durationMs: Date.now() - startTime,
    };
  },
});
```

### Example 2: Data Pipeline Agent

Queries a database, transforms results, writes output.

```typescript
app.agent('data-pipeline', {
  description: 'Extracts data, transforms it, and generates reports',
  capabilities: [
    { id: 'data', name: 'Data Processing', description: 'ETL and reporting', confidence: 0.9 },
  ],
  tools: [{ id: 'sql-query' }, { id: 'file-write' }],
  instructions: 'You process data requests. Extract → Transform → Load.',
  async execute(intent, context, tools) {
    const startTime = Date.now();

    // Step 1: Query the database
    tools.log('Querying database...');
    const rawData = await tools.useTool('sql-query', {
      query: 'SELECT user_id, event, timestamp FROM events WHERE timestamp > NOW() - INTERVAL 24 HOUR',
    }) as Array<{ user_id: string; event: string; timestamp: string }>;

    // Step 2: Transform with LLM
    const analysis = await tools.complete(`
Analyze this event data and produce a summary report:
${JSON.stringify(rawData.slice(0, 100))}

Total records: ${rawData.length}
Report should include: top events, peak hours, anomalies.
    `);

    // Step 3: Write output
    const outputPath = `./reports/daily-${new Date().toISOString().split('T')[0]}.md`;
    await tools.useTool('file-write', {
      path: outputPath,
      content: `# Daily Report\n\n${analysis}`,
    });

    tools.emit('pipeline.completed', { records: rawData.length, outputPath });

    return {
      success: true,
      summary: `Report generated: ${outputPath}\n\n${analysis}`,
      evidence: {
        sources: [
          { type: 'tool', ref: 'sql-query', label: `${rawData.length} records`, consultedAt: new Date().toISOString() },
        ],
        confidence: 0.95,
        reasoning: `Processed ${rawData.length} events into daily report`,
      },
      durationMs: Date.now() - startTime,
    };
  },
});
```

### Example 3: Escalation Agent

Tries a simple response first. If the task is too complex, delegates to a specialist.

```typescript
app.agent('frontline', {
  description: 'First-line support agent that escalates complex issues',
  capabilities: [
    { id: 'support', name: 'Support', description: 'Customer support', confidence: 0.85 },
  ],
  tools: [{ id: 'web-search' }],
  instructions: `You are a first-line support agent.
- Answer simple questions directly
- If the question requires deep technical knowledge, escalate to a specialist
- If you're unsure, say so and escalate`,
  async execute(intent, context, tools) {
    const startTime = Date.now();

    // Step 1: Try a simple response
    const simpleAnswer = await tools.complete(`
Can you answer this question with confidence? If not, respond EXACTLY with "ESCALATE".
Question: ${intent.goal}
    `);

    // Step 2: Check if escalation is needed
    if (simpleAnswer.trim().toUpperCase().includes('ESCALATE')) {
      tools.log('Escalating to specialist...');

      // Try the best specialist
      const specialist = await tools.ask(intent.goal);

      if (specialist.success) {
        return {
          success: true,
          summary: specialist.response,
          evidence: {
            sources: [{ type: 'memory', ref: specialist.intentId, label: `Escalated to ${specialist.agentName}`, consultedAt: new Date().toISOString() }],
            confidence: 0.9,
            reasoning: `Escalated to ${specialist.agentName}`,
          },
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Step 3: Return simple answer
    return {
      success: true,
      summary: simpleAnswer,
      evidence: {
        sources: [{ type: 'memory', ref: 'llm-response', label: 'Direct answer', consultedAt: new Date().toISOString() }],
        confidence: 0.8,
        reasoning: 'Handled directly without escalation',
      },
      durationMs: Date.now() - startTime,
    };
  },
});
```

---

## Self-Reflection Integration

Self-reflection lets agents evaluate their own output and iteratively improve it before returning a result.

### How It Works in the Pipeline

```
Intent arrives
    → Agent executes (produces output)
    → Reflection evaluates output against goal
    → If score < threshold: agent regenerates
    → Repeat up to maxAttempts
    → Return best output
```

### Global Configuration

Set reflection defaults in `KernelConfig`:

```typescript
const kernel = new KernovaKernel({
  environment: 'production',
  reflection: {
    enabled: true,      // Enable for all agents
    threshold: 0.7,     // Minimum quality score (0.0 - 1.0)
    maxAttempts: 2,     // Max regeneration attempts
  },
});
```

### Per-Agent Overrides

Individual agents can override the global config:

```typescript
app.agent('creative-writer', {
  instructions: 'Write creative, engaging content.',
  reflection: {
    enabled: true,
    threshold: 0.85,    // Higher bar for creative work
    maxAttempts: 3,     // More attempts allowed
  },
});

app.agent('quick-responder', {
  instructions: 'Provide fast, brief answers.',
  reflection: {
    enabled: false,     // Skip reflection for speed
  },
});
```

### Resolution Order

1. If the agent has `reflection` config → use it
2. Else → use global `KernelConfig.reflection`
3. If neither is set → reflection is off. When enabled, the defaults are threshold 0.7 and maxAttempts 2

Each reflection costs at least one extra model call per answer, plus up to two rewrites when the score is below the threshold. If the grader's reply can't be parsed, the answer is kept as is.

### Graceful Fallback

If the reflection model call fails (network error, rate limit, timeout), the original output is kept. Reflection is non-critical — a valid agent response is always better than a reflection error.

### What Gets Evaluated

The reflection module scores the output against the original goal using criteria like:
- **Accuracy** — Is the information correct?
- **Completeness** — Does it fully address the goal?
- **Clarity** — Is it understandable for the target audience?

If the score passes the threshold, the output is returned unchanged. If not, the system generates improvement suggestions and asks the LLM to revise.

---

## Agent Config Files (Declarative Agents)

For agents that don't need custom execution logic, you can define them declaratively in YAML or JSON files.

### YAML Format

```yaml
# agents/researcher.agent.yaml
name: researcher
description: Finds accurate information from the web and documents
instructions: |
  You are a research specialist. When given a topic:
  1. Search for authoritative sources
  2. Cross-reference multiple sources
  3. Summarize findings with citations
  Always cite your sources with URLs.

capabilities:
  - id: research
    name: Research
    description: Find and synthesize information
    confidence: 0.95

tools:
  - id: web-search
  - id: http-fetch

model: gpt-4o

reflection:
  enabled: true
  threshold: 0.8
```

### JSON Format

```json
{
  "name": "researcher",
  "description": "Finds accurate information from the web and documents",
  "instructions": "You are a research specialist...",
  "capabilities": [
    { "id": "research", "name": "Research", "description": "Find and synthesize information", "confidence": 0.95 }
  ],
  "tools": [{ "id": "web-search" }, { "id": "http-fetch" }],
  "model": "gpt-4o"
}
```

### Config Inheritance with `extends`

Share common configuration across agents:

```yaml
# agents/base.agent.yaml
name: base
instructions: |
  You are part of the Kernova system. Be concise, accurate, and helpful.
reflection:
  enabled: true
  threshold: 0.7

# agents/writer.agent.yaml
extends: ./base.agent.yaml
name: writer
description: Writes clear, engaging content
instructions: |
  ${parent.instructions}
  You specialize in writing. Focus on clarity and engagement.
capabilities:
  - id: writing
    name: Writing
    description: Create written content
    confidence: 0.9
```

### Hot-Reload

During development, config file changes are picked up automatically:

```bash
kernova serve --watch
# Editing agents/researcher.agent.yaml → agent reloaded automatically
```

### When to Use Config Files vs Code

| Use Config Files | Use Code |
|-----------------|----------|
| Simple instruction-based agents | Custom execution logic |
| Non-developers defining agents | Multi-step pipelines |
| Rapid iteration on prompts | Conditional tool usage |
| Declarative, version-controlled agents | Integration with external systems |

---

## File-Based Agents (CLI Projects)

The Kernova CLI supports a file-based agent convention for larger projects.

### Directory Convention

```
my-project/
├── src/
│   └── agents/
│       ├── researcher.ts
│       ├── writer.ts
│       └── reviewer.ts
├── kernova.config.yaml
└── package.json
```

### Agent File Structure

Each file exports a `defineAgent()` result as its default export:

```typescript
// src/agents/researcher.ts
import { defineAgent } from '@kernova/core';

export default defineAgent({
  name: 'researcher',
  description: 'Finds and synthesizes information from multiple sources',
  capabilities: [
    { id: 'research', name: 'Research', description: 'Web research and synthesis', confidence: 0.95 },
  ],
  tools: [{ id: 'web-search' }, { id: 'http-fetch' }],
  instructions: `You are a research specialist. When given a topic:
1. Search for authoritative sources
2. Cross-reference claims across multiple sources
3. Summarize findings with inline citations
4. Note confidence level for each claim`,
});
```

### Hot-Reload During Development

```bash
kernova dev
# Watches src/agents/ for changes
# Automatically re-registers agents when files change
```

### Scaffolding New Agents

```bash
kernova agent create data-analyst
# Creates src/agents/data-analyst.ts with boilerplate
```

Generated file:

```typescript
// src/agents/data-analyst.ts
import { defineAgent } from '@kernova/core';

export default defineAgent({
  name: 'data-analyst',
  description: 'TODO: Describe what this agent does',
  capabilities: [
    { id: 'data-analyst', name: 'data-analyst', description: 'TODO', confidence: 0.8 },
  ],
  tools: [],
  instructions: 'TODO: Add agent instructions here.',
});
```

---

## Agent Lifecycle & States

Every agent goes through a defined lifecycle, managed by the kernel.

### States

```
┌──────────────────────────────────────────┐
│                                          │
│  idle ──→ executing ──→ idle             │
│              │                           │
│              ├──→ error (recoverable)    │
│              │                           │
│              └──→ offline (shutdown)     │
│                                          │
└──────────────────────────────────────────┘
```

| State | Description |
|-------|-------------|
| `idle` | Ready to accept work. Instance is recycled for new intents. |
| `executing` | Currently processing one or more intents. |
| `error` | Execution failed. Instance returns to `idle` after cleanup. |
| `offline` | Kernel is stopping. No new work accepted. |

### Instance Reuse

The kernel reuses idle instances rather than creating new ones. When an intent arrives:

1. Look for an existing instance in `idle` state for the selected agent definition
2. If found → reuse it (update state to `executing`)
3. If not found → create a new `AgentInstance`

This keeps memory usage stable under load.

### Metrics Tracking

Every agent instance tracks performance metrics:

```typescript
interface AgentMetrics {
  intentsProcessed: number;    // Total intents handled
  successRate: number;         // 0.0 - 1.0 success ratio
  avgResponseMs: number;       // Average response time
  tokensConsumed: number;      // Total LLM tokens used
  uptimeMs: number;            // Time since creation
}
```

Access metrics programmatically:

```typescript
const kernel = app.getKernel();
const status = kernel.getStatus();
console.log(`Agents: ${status.registeredAgents}`);
console.log(`Active intents: ${status.activeIntents}`);
console.log(`Tokens used: ${status.modelUsage.usage.totalTokens}`);
```

### Events Emitted

| Event | When | Data |
|-------|------|------|
| `agent.registered` | Agent definition added | `{ name, capabilities }` |
| `agent.tool_call` | Agent invokes a tool | `{ toolName, toolCallId, arguments }` |
| `agent.delegation.started` | Delegation begins | `{ parentIntentId, subIntentId, targetAgent, depth }` |
| `agent.delegation.completed` | Delegation finishes | `{ parentIntentId, subIntentId, targetAgent, success, durationMs }` |
| `agent.delegation.failed` | Delegation errors | `{ parentIntentId, subIntentId, targetAgent, error }` |

---

## Best Practices

### 1. Write Clear, Specific Instructions

Instructions are the single most important factor in agent quality. Be explicit about:
- What the agent should do
- How it should format responses
- What it should NOT do
- Edge cases and fallback behavior

```typescript
// ❌ Vague
instructions: 'Help the user.'

// ✅ Specific
instructions: `You are a SQL query generator.

Given a natural language question about data, produce a valid PostgreSQL query.

Rules:
- Always use parameterized queries (never interpolate user values)
- Include a LIMIT clause unless explicitly asked for all rows
- Add comments explaining complex joins
- If the question is ambiguous, ask for clarification instead of guessing

Output format: Return ONLY the SQL query in a code block. No explanation unless asked.`
```

### 2. Keep Agents Focused

One agent = one responsibility. A "do-everything" agent performs worse than specialized ones.

```typescript
// ❌ One mega-agent
app.agent('assistant', {
  instructions: 'You can search, write, review, translate, debug...',
  capabilities: [{ id: 'everything', confidence: 0.5 }], // Low confidence in everything
});

// ✅ Specialized agents
app.agent('searcher', { ... });
app.agent('writer', { ... });
app.agent('reviewer', { ... });
app.agent('translator', { ... });
```

### 3. Set Confidence Honestly

Confidence drives selection. Inflated values cause routing errors.

```typescript
// ❌ Overconfident
capabilities: [{ id: 'anything', confidence: 1.0 }]

// ✅ Honest
capabilities: [
  { id: 'typescript', name: 'TypeScript', description: 'TypeScript code generation', confidence: 0.95 },
  { id: 'python', name: 'Python', description: 'Python basics', confidence: 0.6 },
]
```

### 4. Prefer Delegation Over Monolithic Agents

Break complex workflows into stages with clear handoffs.

```typescript
// Instead of one agent that researches + writes + reviews:
// Use three agents with a coordinator that delegates to each
```

### 5. Always Return Evidence with Sources

Evidence makes agent outputs traceable and debuggable.

```typescript
return {
  success: true,
  summary: result,
  evidence: {
    sources: [
      { type: 'tool', ref: 'web-search', label: 'Google search', consultedAt: new Date().toISOString() },
      { type: 'memory', ref: 'mem_abc123', label: 'Previous research', consultedAt: new Date().toISOString() },
    ],
    confidence: 0.9,
    reasoning: 'Cross-referenced 3 sources, all agree',
  },
  durationMs: Date.now() - startTime,
};
```

### 6. Use Memory Strategically

- **Session memory** — Current task context. Cleared between sessions.
- **Long-term memory** — User preferences, learned patterns, important facts.

```typescript
// Store task-specific findings (session)
await tools.remember(`Analysis result for ticket #${ticketId}: ${finding}`, 'session');

// Store user preference (longterm)
await tools.remember('User prefers concise bullet-point responses', 'longterm');
```

### 7. Register Tools That Match Agent Purpose

Don't give a writer `shell-exec` or a reviewer `file-write`.

```typescript
app.agent('researcher', {
  tools: [{ id: 'web-search' }, { id: 'http-fetch' }],  // Read-only tools
  ...
});

app.agent('deployer', {
  tools: [{ id: 'shell-exec' }, { id: 'file-write' }],  // Write tools for ops
  ...
});
```

### 8. Test with MockModelProvider

Use deterministic responses for reliable test suites.

```typescript
import { MockModelProvider, KernovaKernel, defineAgent } from '@kernova/core';

const mock = new MockModelProvider({
  responses: { 'weather': 'Sunny, 72°F' },
  defaultResponse: 'I can help with that.',
});

const kernel = new KernovaKernel({
  environment: 'development',
  ephemeral: true,
  providers: [mock],
});
await kernel.start();

// Register your agent and test it
const agent = defineAgent({ name: 'assistant', ... });
kernel.agentRegistry.register(agent.definition, agent.executor);

const result = await kernel.submit({ goal: 'What is the weather?' });
assert(result.result?.summary.includes('72°F'));
```

---

## Troubleshooting

### "No suitable agent found"

**Cause:** No agents are registered, or no agent's capabilities match the intent.

**Fix:**
- Verify agents are registered before submitting intents
- Check that the agent's `description` contains keywords related to your goals
- Ensure at least one capability has `confidence > 0`

```typescript
// Debug: list registered agents
const kernel = app.getKernel();
const agents = kernel.agentRegistry.list();
console.log(`Registered agents: ${agents.map(a => a.name).join(', ')}`);
```

### "Max tool iterations reached"

**Cause:** The LLM keeps calling tools in a loop without producing a final text answer. Happens after 10 iterations.

**Fix:**
- Add explicit instructions telling the agent when to stop using tools and respond
- Check if tools are returning errors that cause the LLM to retry endlessly
- Reduce the number of available tools (fewer choices = less confusion)

```typescript
instructions: `...
IMPORTANT: After gathering information, synthesize your findings into a final answer.
Do not keep searching if you already have enough information to respond.`
```

### "Delegation depth limit reached"

**Cause:** Agent A delegates to Agent B which delegates to Agent C... up to 5 levels.

**Fix:**
- Review your delegation chain for circular references
- Restructure to reduce nesting (flatten the hierarchy)
- If legitimate, increase the depth limit:

```typescript
// In the coordinator config (advanced — access via kernel internals)
// Default max depth is 5
```

### Agent Always Selected (Even for Unrelated Tasks)

**Cause:** Agent has `confidence: 1.0` or a very generic description that matches everything.

**Fix:**
- Lower confidence to reflect actual capability
- Make the description more specific
- Add multiple agents so the scoring has meaningful competition

```typescript
// ❌ Too generic
{ id: 'general', description: 'Helps with anything', confidence: 1.0 }

// ✅ Specific
{ id: 'sql', description: 'Generates SQL queries for PostgreSQL databases', confidence: 0.9 }
```

### Tool Not Found Errors

**Cause:** Agent tries to use a tool that isn't registered or has a typo in the ID.

**Fix:**
- Verify the tool is registered with the exact ID you're referencing
- Check tool registration order (tools must be registered before agents use them)
- List available tools for debugging:

```typescript
const kernel = app.getKernel();
const tools = kernel.plugins.listTools();
console.log('Available tools:', tools.map(t => `${t.id} (${t.name})`));
```

### Agent Produces Empty or Generic Responses

**Cause:** Instructions are too vague, or the model is defaulting to generic behavior.

**Fix:**
- Add detailed, structured instructions with examples
- Include output format specifications
- Set the right model for the task complexity

```typescript
instructions: `You are an expert data analyst.

When asked to analyze data:
1. State the key metrics
2. Identify trends (up/down/stable)
3. Flag anomalies with explanation
4. Provide 2-3 actionable recommendations

Format your response with markdown headers for each section.`
```

### Delegation Timeout

**Cause:** The delegated agent takes longer than 30 seconds (default timeout).

**Fix:**
- Optimize the delegated agent's execution
- Check for external tool latency (slow API calls)
- If the task legitimately takes long, break it into smaller sub-tasks

---

## Next Steps

- [Multi-Agent Systems](/guides/multi-agent) — Deep dive into coordination patterns
- [Intelligence Modules](/guides/intelligence) — Planning, reflection, RAG
- [Testing](/guides/testing) — Test agents with mock providers
- [Autonomy Modules](/guides/autonomy) — Schedules, queues, triggers
- [Streaming](/guides/streaming) — Real-time token streaming
