---
title: "Planning, Reflection & RAG"
description: Decompose complex goals into steps, evaluate output quality with self-reflection, and ground responses in documents with retrieval-augmented generation.
---

Simple prompts work for simple tasks. But when an agent needs to accomplish something complex — researching a topic, generating a multi-part deliverable, or answering questions grounded in your documentation — a single LLM call isn't enough. Kernova provides three intelligence modules that elevate agent capabilities from "chat completions" to structured cognitive work:

- **AgentPlanner** — Decomposes complex goals into ordered steps and executes them adaptively
- **SelfReflection** — Evaluates agent output against quality criteria and revises until it passes
- **RAGPipeline** — Ingests documents, chunks them, and retrieves relevant context for queries

These modules work independently or compose together: RAG provides grounding context, the planner breaks goals into manageable steps, and reflection ensures each output meets quality standards before it reaches the user.

---

## Agent Planner

The `AgentPlanner` implements the **plan-and-execute** pattern — a proven approach where complex goals are decomposed into steps before execution begins. Instead of asking an LLM to solve everything in one shot, the planner:

1. **Decomposes** the goal into ordered, actionable steps via the LLM
2. **Executes** each step sequentially using a provided executor function
3. **Replans** adaptively when a step fails, generating alternative steps

This pattern works because LLMs produce better results on focused, narrow tasks than on broad, multi-faceted goals.

### Quick Start

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ ephemeral: true });
await kernel.start();

// Create a plan from a complex goal
const plan = await kernel.planner.plan(
  'Research competitor pricing, analyze gaps, and draft a pricing proposal'
);

console.log(`Plan has ${plan.totalSteps} steps:`);
for (const step of plan.steps) {
  console.log(`  ${step.index + 1}. ${step.description}`);
}

// Execute the plan with a custom executor
const result = await kernel.planner.execute(plan, async (step, currentPlan) => {
  // Your logic for executing each step
  // Could call another agent, run a tool, query an API, etc.
  const output = await myAgentExecute(step.description);
  return output;
});

console.log(`Plan ${result.status}: ${result.completedSteps}/${result.totalSteps} steps completed`);
```

### API Reference

#### `plan(goal, context?)`

Decomposes a goal into an ordered list of steps using the LLM.

```typescript
const plan = await kernel.planner.plan(
  'Build a REST API for user management',
  'We use Express.js and PostgreSQL. Auth is handled by JWT tokens.'
);
```

**Parameters:**
- `goal` (string, required) — The high-level objective to decompose
- `context` (string, optional) — Additional context to inform step generation

**Returns:** `ExecutionPlan` with status `'planning'` and generated steps.

#### `execute(plan, executor)`

Runs a plan step-by-step, calling the executor function for each step.

```typescript
const completed = await kernel.planner.execute(plan, async (step, plan) => {
  // step.description — what needs to be done
  // step.index — position in the plan (0-based)
  // Return the step's result (any value)
  return await processStep(step.description);
});
```

**Parameters:**
- `plan` (ExecutionPlan, required) — The plan to execute (from `plan()`)
- `executor` (StepExecutor, required) — Async function called for each step

**Returns:** The updated `ExecutionPlan` with final status and step results.

The executor receives the current step and the full plan. If the executor throws, the step is marked as failed and adaptive replanning kicks in (if enabled).

#### `cancel(planId)`

Cancels an active plan. Pending steps are marked as skipped.

```typescript
kernel.planner.cancel(plan.id);
```

#### `getPlan(planId)` / `listPlans()`

Retrieve active plans for inspection or monitoring.

```typescript
const activePlans = kernel.planner.listPlans();
const specific = kernel.planner.getPlan('plan_abc123');
```

### Adaptive Replanning

When a step fails, the planner doesn't give up immediately. With `adaptiveReplanning: true` (the default), it asks the LLM to generate alternative steps that work around the failure:

```typescript
// Step 3 fails: "Query the production database for user stats"
// Planner replans: generates alternative steps like:
//   - "Query the analytics API for user stats instead"
//   - "Use the cached report from yesterday"
```

Replanning is limited by `maxReplanAttempts` (default: 2) to prevent infinite retry loops. If replanning also fails or produces no alternatives, the plan status becomes `'failed'`.

### Configuration

```typescript
const kernel = new KernovaKernel({
  ephemeral: true,
  planning: {
    maxSteps: 10,              // Maximum steps per plan (default: 10)
    strategy: 'sequential',    // 'sequential' | 'parallel' | 'adaptive'
    adaptiveReplanning: true,  // Re-plan on step failure (default: true)
    maxReplanAttempts: 2,      // Max times to re-plan (default: 2)
  },
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxSteps` | 10 | Maximum steps the LLM can generate per plan |
| `strategy` | `'sequential'` | Step execution order: sequential, parallel, or adaptive |
| `adaptiveReplanning` | `true` | Whether to re-plan on step failure |
| `maxReplanAttempts` | 2 | Maximum replanning attempts before marking plan as failed |

### Events

The planner emits events through the kernel's event bus for observability:

| Event | When | Key Data |
|-------|------|----------|
| `plan.created` | Plan initiated | `goal`, `strategy` |
| `plan.decomposed` | LLM produced steps | `stepCount`, `steps[]` |
| `plan.step.started` | Step execution begins | `stepId`, `index`, `description` |
| `plan.step.completed` | Step succeeds | `stepId`, `index` |
| `plan.step.failed` | Step throws | `stepId`, `error` |
| `plan.replanned` | New steps generated after failure | `failedStep`, `newStepCount`, `attempt` |
| `plan.completed` | All steps done | `totalSteps`, `completedSteps` |
| `plan.failed` | Plan cannot continue | `error`, `phase`, `failedStepIndex` |
| `plan.cancelled` | Plan was cancelled | `goal` |

```typescript
kernel.events.subscribe('plan.step.completed', (event) => {
  console.log(`Step ${event.data.index} done`);
});

kernel.events.subscribe('plan.replanned', (event) => {
  console.log(`Replanned after "${event.data.failedStep}" — ${event.data.newStepCount} new steps`);
});
```

---

## Self-Reflection

The `SelfReflection` module gives agents the ability to evaluate their own output and iteratively improve it. After an agent produces a response, reflection scores the output against configurable criteria (accuracy, completeness, clarity) and triggers revision if the score falls below threshold.

This is wired into Kernova's execution pipeline — when reflection is enabled, it runs **automatically** after every agent produces output. No manual intervention required.

### How It Works

```
Agent produces output
        │
        ▼
┌─────────────────────┐
│  Evaluate output    │ ← LLM scores against criteria
│  Score: 0.0 – 1.0  │
└─────────┬───────────┘
          │
    Score ≥ threshold? ──── Yes ──→ Return output (passed)
          │
          No
          │
          ▼
┌─────────────────────┐
│  Revise output      │ ← LLM rewrites based on feedback
└─────────┬───────────┘
          │
    Attempts remaining? ── No ──→ Return best output (graceful fallback)
          │
          Yes
          │
          └──→ Re-evaluate (loop)
```

### Quick Start

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ ephemeral: true });
await kernel.start();

// Reflect on any output
const result = await kernel.reflection.reflect(
  'TypeScript is a typed language.',          // output to evaluate
  'Explain TypeScript in detail for a beginner', // original goal
);

console.log(`Score: ${result.evaluation.score}`);
console.log(`Passed: ${result.evaluation.passed}`);

if (result.revisedOutput) {
  console.log('Revised output:', result.revisedOutput);
} else {
  console.log('Original output accepted:', result.originalOutput);
}
```

### API Reference

#### `reflect(output, goal, context?, agentId?)`

Full reflection cycle: evaluate, then revise iteratively until quality passes or max attempts reached.

```typescript
const result = await kernel.reflection.reflect(
  agentOutput,
  'Write a technical blog post about WebSockets',
  'Target audience: senior engineers',
  'blog-writer-agent'
);
```

**Parameters:**
- `output` (string, required) — The agent's output to evaluate
- `goal` (string, required) — The original goal that produced the output
- `context` (string, optional) — Additional context for evaluation
- `agentId` (string, optional) — Agent identifier for event correlation

**Returns:** `ReflectionResult` containing:

```typescript
interface ReflectionResult {
  id: string;
  originalOutput: string;
  evaluation: ReflectionEvaluation;
  revisedOutput?: string;        // Only set if output was revised
  reflectedAt: string;
  iterationCount: number;        // Total passes (1 = no revision needed)
}

interface ReflectionEvaluation {
  score: number;                 // 0.0 – 1.0
  passed: boolean;               // score >= threshold
  criteria: ReflectionCriterion[];
  reasoning: string;
  suggestions: string[];
}
```

#### `evaluate(output, goal, context?)`

Evaluate an output without triggering the revision loop. Useful for scoring/grading.

```typescript
const evaluation = await kernel.reflection.evaluate(
  'Here is my draft...',
  'Write a concise summary of the Q3 results'
);

console.log(`Score: ${evaluation.score}`);
console.log(`Criteria:`);
for (const c of evaluation.criteria) {
  console.log(`  ${c.name}: ${c.score} — ${c.feedback}`);
}
```

### Configuration

#### Global Configuration

```typescript
const kernel = new KernovaKernel({
  ephemeral: true,
  reflection: {
    enabled: true,        // Enable/disable globally (default: true)
    threshold: 0.7,       // Minimum passing score (default: 0.7)
    maxAttempts: 2,       // Max revision attempts (default: 2)
  },
});
```

#### Per-Agent Configuration

Per-agent config overrides global settings. An agent can opt out of reflection even when it's globally enabled, or configure a stricter threshold:

```typescript
import { defineAgent } from '@kernova/core';

const agent = defineAgent({
  name: 'creative-writer',
  description: 'Writes creative content',
  instructions: 'Write engaging, creative content.',
  capabilities: [{ id: 'write', name: 'Write', description: 'Creative writing', confidence: 0.9 }],
  tools: [],
  reflection: {
    enabled: true,
    threshold: 0.8,      // Higher bar for this agent
    maxAttempts: 3,      // More revision attempts allowed
  },
});
```

**Resolution rules:**
- Global `enabled: false` + agent doesn't specify → reflection is off
- Agent `enabled: true` → overrides global disable
- Agent `enabled: false` → overrides global enable
- Agent `threshold` / `maxAttempts` → overrides global values when specified

#### Evaluation Criteria

The default criteria are `['accuracy', 'completeness', 'clarity']`. Customize them globally or per-evaluation:

```typescript
const kernel = new KernovaKernel({
  ephemeral: true,
  reflection: {
    enabled: true,
    threshold: 0.7,
    maxAttempts: 2,
    criteria: ['accuracy', 'completeness', 'tone', 'actionability'],
  },
});
```

### Graceful Fallback

If the LLM fails to produce a valid evaluation (network error, malformed response), reflection degrades gracefully:

- **Model failure during evaluation** — Returns a neutral 0.5 score with "Could not parse evaluation" feedback
- **Model failure during revision** — Keeps the original output
- **All attempts exhausted** — Returns the best-scoring output seen across all attempts (not necessarily the last one)

The agent's output is never lost. Worst case, the original output passes through unchanged.

### Automatic Integration

When reflection is enabled, Kernova's kernel execution pipeline automatically reflects on agent output:

```typescript
// This triggers reflection automatically after the agent responds
const result = await kernel.submit({
  goal: 'Explain how DNS resolution works',
  owner: 'user-123',
});
// result.response has already been through reflection
// If the agent's initial output scored below threshold, it was revised
```

No extra code needed — enable reflection in config and all agent outputs get quality-checked.

### Events

| Event | When | Key Data |
|-------|------|----------|
| `reflection.started` | Reflection begins | `goal`, `agentId`, `threshold`, `maxAttempts` |
| `reflection.evaluated` | Output scored | `iteration`, `score`, `passed`, `criteria[]` |
| `reflection.regenerated` | Output was revised | `originalScore`, `newScore`, `attempt`, `maxReached` |
| `reflection.completed` | Reflection finished | `passed`, `finalScore`, `iterations`, `wasRevised` |

```typescript
kernel.events.subscribe('reflection.regenerated', (event) => {
  console.log(
    `Attempt ${event.data.attempt}: score improved from ` +
    `${event.data.originalScore.toFixed(2)} → ${event.data.newScore.toFixed(2)}`
  );
});
```

---

## RAG Pipeline

The `RAGPipeline` handles document ingestion, intelligent chunking, embedding generation, and semantic retrieval — giving agents access to your documentation and knowledge bases without stuffing everything into every prompt.

### How It Works

```
Documents ingested → Chunked → Embedded (vectors)
                                    │
Query arrives → Embedded → Cosine similarity → Top-K chunks returned
                              │
                    (fallback: keyword matching if embedding fails)
```

### Quick Start

```typescript
import { KernovaKernel } from '@kernova/core';
import fs from 'fs';

const kernel = new KernovaKernel({ ephemeral: true });
await kernel.start();

// Ingest documentation
await kernel.rag.ingest(
  fs.readFileSync('./docs/architecture.md', 'utf-8'),
  'architecture.md',
  { category: 'engineering' }
);

// Retrieve relevant context
const results = await kernel.rag.retrieve('How is authentication handled?');
for (const r of results) {
  console.log(`[${r.document.source}] score=${r.score.toFixed(2)}`);
  console.log(`  ${r.chunk.content.slice(0, 100)}...`);
}

// Or get a pre-formatted context string for prompt injection
const context = await kernel.rag.getContext('authentication flow', { topK: 3 });
console.log(context);
```

### API Reference

#### `ingest(content, source, metadata?)`

Ingest a document: chunk it according to the configured strategy and generate embeddings for each chunk.

```typescript
const doc = await kernel.rag.ingest(
  documentContent,
  'api-reference.md',
  { category: 'api-docs', version: '2.1' }
);
console.log(`Ingested ${doc.id} from ${doc.source}`);
```

**Parameters:**
- `content` (string, required) — Full document text
- `source` (string, required) — Identifier/filename for the document
- `metadata` (Record<string, unknown>, optional) — Arbitrary metadata attached to chunks

**Returns:** `Document` object with generated `id`, `source`, and `createdAt`.

#### `retrieve(query, options?)`

Find relevant chunks for a query using semantic search with keyword fallback.

```typescript
const results = await kernel.rag.retrieve('database migration strategy', {
  topK: 10,
  scoreThreshold: 0.6,
});
```

**Parameters:**
- `query` (string, required) — The search query
- `options.topK` (number, optional) — Maximum results to return (default: 5)
- `options.scoreThreshold` (number, optional) — Minimum similarity score (default: 0.7)

**Returns:** `RetrievalResult[]` sorted by score descending:

```typescript
interface RetrievalResult {
  chunk: DocumentChunk;   // The matching chunk (content, index, tokenEstimate)
  score: number;          // Similarity score (0.0 – 1.0)
  document: Document;     // Parent document (source, metadata)
}
```

#### `getContext(query, options?)`

Retrieve and format chunks into a single string ready for prompt injection.

```typescript
const ragContext = await kernel.rag.getContext('how webhooks work', {
  topK: 5,
  maxTokens: 2000,
});
// Returns formatted string: "[Source: webhooks.md]\n<chunk content>\n\n---\n\n..."
```

#### `remove(documentId)` / `clear()`

Remove specific documents or clear the entire pipeline.

```typescript
kernel.rag.remove('doc_abc123');   // Remove one document and its chunks
kernel.rag.clear();                // Remove everything
```

#### `stats()`

Get pipeline statistics.

```typescript
const stats = kernel.rag.stats();
console.log(`${stats.documents} docs, ${stats.chunks} chunks, ${stats.embeddedChunks} with embeddings`);
```

### Chunking Strategies

The RAG pipeline supports four chunking strategies, configured at initialization:

| Strategy | Behavior | Best For |
|----------|----------|----------|
| `fixed` | Split at fixed token boundaries with overlap | Uniform sizes, unstructured text |
| `recursive` | Split by paragraph → sentence → fixed (preserves structure) | **Default** — Markdown, technical docs |
| `sentence` | Group sentences until chunk budget is reached | Prose, articles, natural language |
| `paragraph` | Group paragraphs until chunk budget is reached | Well-structured documents |

The `recursive` strategy (default) is the most versatile — it respects document structure by trying larger splits first (paragraphs), then falling back to finer splits (sentences, then fixed) for oversized segments.

### Search: Semantic + Keyword Fallback

The pipeline uses a two-tier search strategy:

1. **Semantic search (primary)** — Embeds the query via the ModelRouter, computes cosine similarity against all chunk embeddings, and returns chunks above the score threshold.

2. **Keyword fallback** — If embedding generation fails (model unavailable, network error), falls back to term-matching: splits the query into words and scores chunks by the fraction of query terms they contain.

This means RAG always works — even without an embedding model configured, you get basic keyword retrieval.

### Configuration

```typescript
const kernel = new KernovaKernel({
  ephemeral: true,
  rag: {
    chunkSize: 512,           // Tokens per chunk (default: 512)
    chunkOverlap: 50,         // Overlap between chunks in tokens (default: 50)
    topK: 5,                  // Default results per query (default: 5)
    scoreThreshold: 0.7,      // Minimum similarity score (default: 0.7)
    chunkStrategy: 'recursive', // Chunking strategy (default: 'recursive')
  },
});
```

---

## How They Compose

The real power of these modules emerges when they work together. The natural composition is:

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│ RAG provides │ ──→ │ Planner uses │ ──→ │ Reflection     │
│ grounding    │     │ context to   │     │ ensures each   │
│ context      │     │ plan steps   │     │ step's output  │
└─────────────┘     └──────────────┘     │ meets quality  │
                                          └────────────────┘
```

### End-to-End Example

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';
import fs from 'fs';

const kernel = new KernovaKernel({
  ephemeral: false,
  dataDir: './kernova-data',
  reflection: { enabled: true, threshold: 0.75, maxAttempts: 2 },
  planning: { maxSteps: 8, adaptiveReplanning: true },
  rag: { chunkStrategy: 'recursive', chunkSize: 512 },
});
await kernel.start();

// 1. RAG: Ingest domain knowledge
await kernel.rag.ingest(
  fs.readFileSync('./docs/pricing-guide.md', 'utf-8'),
  'pricing-guide.md',
  { category: 'business' }
);
await kernel.rag.ingest(
  fs.readFileSync('./docs/competitor-analysis.md', 'utf-8'),
  'competitor-analysis.md',
  { category: 'business' }
);

// 2. Planner: Decompose a complex goal using RAG context
const ragContext = await kernel.rag.getContext('pricing strategy and competitor gaps');

const plan = await kernel.planner.plan(
  'Analyze our pricing against competitors and draft a proposal for the enterprise tier',
  ragContext  // RAG context informs the planning step
);

// 3. Execute: Each step benefits from RAG + reflection
const result = await kernel.planner.execute(plan, async (step) => {
  // Retrieve step-specific context from RAG
  const stepContext = await kernel.rag.getContext(step.description, { topK: 3 });

  // Submit to an agent (reflection runs automatically on the output)
  const response = await kernel.submit({
    goal: step.description,
    owner: 'user-product-team',
    context: stepContext,
  });

  return response;
});

console.log(`Plan ${result.status} — ${result.completedSteps} steps completed`);
```

In this flow:
- **RAG** grounds the planner and each execution step in real documentation
- **Planner** breaks the complex goal into focused, manageable steps
- **Reflection** ensures each step's output meets quality criteria before the plan continues

### Composition Patterns

#### RAG-Informed Planning

Pass RAG context into `plan()` so the decomposition is grounded in your documents:

```typescript
const context = await kernel.rag.getContext(goal);
const plan = await kernel.planner.plan(goal, context);
```

#### Reflection Per Step

Each step's output goes through reflection automatically (if enabled). This catches low-quality intermediate results before they compound:

```typescript
await kernel.planner.execute(plan, async (step) => {
  const result = await kernel.submit({ goal: step.description, owner });
  // result is already reflected upon — revision happened if needed
  return result;
});
```

#### Quality Gate Pattern

Use `evaluate()` without revision as a gate — only proceed if output passes:

```typescript
const evaluation = await kernel.reflection.evaluate(draft, goal);
if (!evaluation.passed) {
  // Route to a different agent, escalate, or request human review
  return await escalateToHuman(draft, evaluation.suggestions);
}
```

---

## Best Practices

### Planning

- **Keep goals specific** — "Implement user auth with JWT" plans better than "Make the app secure"
- **Provide context** — The more context the planner has, the more relevant the steps
- **Set appropriate maxSteps** — Complex goals need more steps; simple goals should be capped low
- **Handle partial completion** — Plans can hit `maxSteps` limit; design executors to handle partial results
- **Use events for monitoring** — Subscribe to `plan.step.failed` and `plan.replanned` for observability

### Reflection

- **Start with defaults** — The 0.7 threshold and 2 max attempts work well for most use cases
- **Raise thresholds for critical output** — Customer-facing content, legal text, or code generation may need 0.8+
- **Disable for speed-sensitive paths** — Reflection adds 2-3 LLM calls; disable for real-time chat
- **Use `evaluate()` for analytics** — Score outputs without revision to measure agent quality over time
- **Trust graceful fallback** — If reflection fails, the original output passes through; this is by design

### RAG

- **Ingest at startup** — Load core documentation when the kernel starts, not on every query
- **Use recursive chunking for Markdown** — It respects headers and structure
- **Keep chunks focused** — 512 tokens is a good default; smaller chunks (256) for FAQ-style content
- **Re-ingest on doc updates** — Remove old version, ingest new one
- **Monitor with `stats()`** — Track document and chunk counts to catch ingestion issues

### Composition

- **RAG first, then plan** — Always retrieve context before planning; plans based on real data are better
- **Reflection on every step** — Don't skip reflection for intermediate steps; errors compound
- **Use events for debugging** — The full event stream (`plan.*`, `reflection.*`, `rag.*`) tells the complete story
- **Test each module independently** — Verify RAG retrieval quality, planner decomposition, and reflection scoring separately before composing

### Anti-Patterns

- ❌ Planning without context (produces generic, unhelpful steps)
- ❌ Setting maxAttempts too high (wastes tokens on diminishing returns)
- ❌ Ingesting entire codebases without filtering (dilutes retrieval quality)
- ❌ Using reflection for deterministic outputs (code compilation, math — just validate directly)
- ❌ Ignoring plan events (you lose visibility into why a plan failed)

---

## Next Steps

- [Context & Memory](/guides/context-memory) — The memory system that feeds into RAG and planning
- [Building Agents](/guides/agents) — How agents use planning and reflection
- [Multi-Agent Systems](/guides/multi-agent) — Planning across coordinating agents
- [Events & Observability](/guides/events) — Full event reference for monitoring
