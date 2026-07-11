---
title: "Using @kernova/core Directly"
description: Build with the kernel API when you need full control — custom pipelines, advanced agent patterns, and direct subsystem access.
---

A complete working example that bypasses the SDK wrapper and uses `@kernova/core` directly. This gives you full control over the kernel lifecycle, raw access to every subsystem, and the flexibility to build custom frameworks, pipelines, or libraries on top of Kernova.

---

## When to Use Core vs SDK

The SDK (`@kernova/sdk`) is the right choice for most applications — it starts the kernel for you, provides a fluent API, and handles lifecycle automatically. Use `@kernova/core` directly when:

- **You're building a framework** on top of Kernova (your own SDK, a SaaS platform, a multi-tenant system)
- **You need custom intent execution pipelines** — preprocessing, routing, or post-processing that the SDK doesn't support
- **You need direct subsystem access** — raw EventBus subscriptions, manual memory management, programmatic scheduler control
- **You're building a library** that other developers import (you don't want SDK opinions baked in)
- **You need multi-kernel setups** — running multiple isolated kernel instances in a single process

---

## Project Setup

```
core-pipeline/
├── src/
│   └── index.ts          # Full working example
├── package.json
├── tsconfig.json
└── .env
```

```bash
mkdir core-pipeline && cd core-pipeline
npm init -y
npm install @kernova/core @kernova/types
npm install -D typescript @types/node
npx tsc --init
```

### Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-...
```

---

## Full Source Code

```typescript
// src/index.ts
import {
  KernovaKernel,
  defineAgent,
  EventBus,
  MemoryEngine,
  ModelRouter,
  PluginRegistry,
  Scheduler,
  TaskQueue,
} from '@kernova/core';

import type {
  NexusEvent,
  Intent,
  IntentResult,
} from '@kernova/types';

// ─── 1. Manual Kernel Construction ──────────────────────────────────────────

const kernel = new KernovaKernel({
  instanceId: 'pipeline-kernel-01',
  environment: 'development',
  debug: true,
  dataDir: './pipeline-data',

  // Model routing with purpose-based overrides
  models: {
    default: { provider: 'openai', model: 'gpt-4o' },
    purposes: {
      summarization: { provider: 'openai', model: 'gpt-4o-mini' },
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    },
  },

  // Global self-reflection configuration
  reflection: {
    enabled: true,
    threshold: 0.8,
    maxAttempts: 2,
  },
});

// ─── 2. Identity & Budget Constraints ───────────────────────────────────────

// Create a user identity with permissions
kernel.identity.register({
  id: 'pipeline-user',
  name: 'Data Pipeline Service',
  type: 'service',
  permissions: ['intent:submit', 'memory:write', 'memory:read'],
});

// Set a daily token budget
kernel.budget.setBudget('pipeline-user', {
  dailyTokenLimit: 100_000,
  alertThreshold: 0.8, // warn at 80% usage
});

// ─── 3. Plugin Registration with Middleware ─────────────────────────────────

await kernel.plugins.register({
  id: 'data-tools',
  name: 'Data Processing Tools',
  version: '1.0.0',
  type: 'tool',

  tools: [
    {
      id: 'transform-csv',
      name: 'CSV Transformer',
      description: 'Parse and transform CSV data',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Raw CSV content' },
          columns: { type: 'array', items: { type: 'string' } },
        },
        required: ['data'],
      },
      execute: async (params) => {
        const rows = (params.data as string).split('\n').map(r => r.split(','));
        const headers = rows[0];
        const filtered = (params.columns as string[] | undefined)
          ? rows.map(row => row.filter((_, i) => (params.columns as string[]).includes(headers[i])))
          : rows;
        return { rows: filtered.length - 1, headers: filtered[0], sample: filtered.slice(0, 3) };
      },
    },
    {
      id: 'aggregate',
      name: 'Aggregator',
      description: 'Compute statistics on numeric arrays',
      parameters: {
        type: 'object',
        properties: {
          values: { type: 'array', items: { type: 'number' } },
        },
        required: ['values'],
      },
      execute: async (params) => {
        const vals = params.values as number[];
        const sum = vals.reduce((a, b) => a + b, 0);
        return { count: vals.length, sum, mean: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
      },
    },
  ],

  // Middleware hooks — intercept intent execution
  middleware: [
    {
      hook: 'beforeIntentExecution',
      handler: async (context) => {
        console.log(`[middleware] Intent starting: ${context.intent.goal}`);
        // Inject custom metadata
        context.intent.metadata.pipelineVersion = '2.1.0';
        return context;
      },
    },
    {
      hook: 'afterIntentExecution',
      handler: async (context) => {
        console.log(`[middleware] Intent completed in ${context.result.durationMs}ms`);
        return context;
      },
    },
  ],
});

// ─── 4. Define Agents with Custom Executors ─────────────────────────────────

const dataIngester = defineAgent({
  name: 'data-ingester',
  description: 'Ingests and validates raw data from external sources',
  capabilities: [
    { id: 'ingest', name: 'Data Ingestion', description: 'Fetch and validate data', confidence: 0.95 },
  ],
  tools: [
    { toolId: 'transform-csv', name: 'transform-csv', purpose: 'Parse CSV data', required: true },
  ],
  instructions: 'You ingest raw data, validate its structure, and prepare it for processing.',

  // Custom executor — full control over agent logic
  async execute(intent, context, tools) {
    const startTime = Date.now();

    tools.log(`Ingesting data for: ${intent.goal}`);

    // Use the model router for analysis
    const analysis = await tools.complete(
      `Analyze this data request and determine what validation is needed: "${intent.goal}"`
    );

    // Store working memory for the current task
    await tools.remember(
      `Ingestion task: ${intent.goal} — Analysis: ${analysis}`,
      'working',
      ['ingestion', 'active']
    );

    // Emit a custom event
    tools.emit('pipeline.ingestion.completed', {
      goal: intent.goal,
      analysis,
    });

    return {
      success: true,
      summary: `Data ingested and validated. ${analysis}`,
      data: { analysis, validatedAt: new Date().toISOString() },
      evidence: {
        sources: [{ type: 'memory', ref: 'llm-analysis', label: 'Validation analysis', consultedAt: new Date().toISOString() }],
        confidence: 0.92,
        reasoning: 'Data structure validated against schema',
      },
      durationMs: Date.now() - startTime,
    };
  },
});

const dataAnalyzer = defineAgent({
  name: 'data-analyzer',
  description: 'Performs statistical analysis and generates insights',
  capabilities: [
    { id: 'analyze', name: 'Data Analysis', description: 'Statistical analysis', confidence: 0.9 },
  ],
  tools: [
    { toolId: 'aggregate', name: 'aggregate', purpose: 'Compute statistics', required: true },
  ],
  instructions: 'You analyze data and produce actionable insights with statistical backing.',
  reflection: {
    enabled: true,
    threshold: 0.85, // Stricter quality for analysis outputs
    maxAttempts: 3,
  },
});

// Register both agents
kernel.agentRegistry.register(dataIngester.definition, dataIngester.executor);
kernel.agentRegistry.register(dataAnalyzer.definition, dataAnalyzer.executor);

// ─── 5. Direct EventBus Subscriptions ───────────────────────────────────────

// Subscribe to all intent lifecycle events
kernel.events.subscribe(['intent.*'], (event: NexusEvent) => {
  console.log(`[event] ${event.eventType} — ${JSON.stringify(event.data)}`);
});

// Subscribe to custom pipeline events
kernel.events.subscribe(['pipeline.*'], (event: NexusEvent) => {
  console.log(`[pipeline] ${event.eventType}:`, event.data);
});

// Subscribe to model usage for cost tracking
kernel.events.subscribe(['model.*'], (event: NexusEvent) => {
  if (event.eventType === 'model.completion') {
    const tokens = event.data.totalTokens as number;
    console.log(`[cost] ${tokens} tokens consumed`);
  }
});

// ─── 6. TaskQueue with Registered Handlers ──────────────────────────────────

// Register a handler for data processing tasks
kernel.taskQueue.registerHandler('process-batch', async (task) => {
  const { batchId, records } = task.payload as { batchId: string; records: unknown[] };
  console.log(`[task] Processing batch ${batchId} with ${records.length} records`);

  // Process each record
  for (const record of records) {
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  return { processed: records.length, batchId };
});

// Register a handler for notifications
kernel.taskQueue.registerHandler('send-notification', async (task) => {
  const { channel, message } = task.payload as { channel: string; message: string };
  console.log(`[notify] Sending to ${channel}: ${message}`);
  return { sent: true, channel };
});

// Enqueue tasks with priority
kernel.taskQueue.enqueue({
  handler: 'process-batch',
  payload: { batchId: 'batch-001', records: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  priority: 'high',
});

kernel.taskQueue.enqueue({
  handler: 'send-notification',
  payload: { channel: 'slack', message: 'Pipeline started' },
  priority: 'low',
});

// ─── 7. Scheduler — Programmatic Job Registration ───────────────────────────

// Schedule a recurring cleanup job
kernel.scheduler.register({
  name: 'memory-decay',
  cronExpression: '0 */6 * * *', // Every 6 hours
  target: {
    type: 'intent',
    goal: 'Run memory decay to expire old working and session memories',
  },
});

// Schedule a daily report
kernel.scheduler.register({
  name: 'daily-pipeline-report',
  cronExpression: '0 8 * * 1-5', // Weekdays at 8:00 AM
  target: {
    type: 'agent',
    id: 'data-analyzer',
    goal: 'Generate a summary report of yesterday\'s pipeline activity',
  },
});

// One-shot delayed job
kernel.scheduler.register({
  name: 'warmup-check',
  delayMs: 30_000, // 30 seconds after start
  oneShot: true,
  target: {
    type: 'intent',
    goal: 'Verify all pipeline connections are healthy',
  },
});

// ─── 8. Direct Memory Engine Access ─────────────────────────────────────────

// Store organizational knowledge
kernel.memoryEngine.store({
  content: 'Pipeline SLA: data must be processed within 5 minutes of ingestion',
  layer: 'organizational',
  tags: ['sla', 'pipeline', 'policy'],
});

kernel.memoryEngine.store({
  content: 'Preferred output format: JSON with ISO 8601 timestamps',
  layer: 'organizational',
  tags: ['format', 'standard'],
});

// Store long-term facts about the system
kernel.memoryEngine.store({
  content: 'The data-ingester agent handles CSV, JSON, and XML formats',
  layer: 'longterm',
  tags: ['agent-capability', 'data-ingester'],
});

// Query memories semantically
const relevantMemories = kernel.memoryEngine.query({
  query: 'data processing policies',
  layers: ['organizational', 'longterm'],
  limit: 5,
});
console.log(`Found ${relevantMemories.length} relevant memories`);

// ─── 9. Model Router — Direct Embeddings ────────────────────────────────────

// Generate embeddings for custom vector storage
const embedding = await kernel.models.embed('data pipeline processing');
console.log(`Embedding dimension: ${embedding.length}`);

// Direct completion (bypassing agents)
const response = await kernel.models.complete({
  messages: [
    { role: 'system', content: 'You are a data classification engine. Respond with a single category.' },
    { role: 'user', content: 'Classify: quarterly revenue figures by region' },
  ],
});
console.log(`Classification: ${response.content}`);

// ─── 10. Manual Lifecycle Management ────────────────────────────────────────

async function main() {
  try {
    // Start the kernel (initializes all subsystems)
    await kernel.start();
    console.log('Kernel started:', kernel.getStatus());

    // Submit intents directly
    const result = await kernel.submit({
      goal: 'Ingest and validate the latest sales data CSV',
      intentType: 'action',
      priority: 'high',
      owner: 'pipeline-user',
      metadata: { source: 'scheduled-pipeline' },
    });

    console.log(`Intent result: ${result.result?.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Summary: ${result.result?.summary}`);

    // Query events after execution
    const recentEvents = kernel.events.query({
      category: 'intent',
      limit: 10,
      order: 'desc',
    });
    console.log(`Recent events: ${recentEvents.length}`);

    // Check task queue stats
    const stats = kernel.taskQueue.stats();
    console.log(`Queue: pending=${stats.pending}, active=${stats.active}, completed=${stats.completed}`);

    // Check scheduled jobs
    const jobs = kernel.scheduler.list();
    console.log(`Scheduled jobs: ${jobs.length}`);

  } catch (error) {
    console.error('Pipeline error:', error);
  } finally {
    // Always stop gracefully
    await kernel.stop();
    console.log('Kernel stopped');
  }
}

main();
```

---

## Core vs SDK Comparison

The same operations expressed both ways:

| Task | SDK (`@kernova/sdk`) | Core (`@kernova/core`) |
|------|---------------------|------------------------|
| Create instance | `await Kernova.create()` | `new KernovaKernel(config)` + `await kernel.start()` |
| Register agent | `app.agent('name', { ... })` | `kernel.agentRegistry.register(def, exec)` |
| Submit intent | `await app.ask('goal')` | `await kernel.submit({ goal })` |
| Store memory | `await app.remember('x')` | `kernel.memoryEngine.store({ content, layer, tags })` |
| Search memory | `await app.recall('query')` | `kernel.memoryEngine.query({ query, layers, limit })` |
| Register tool | `app.tool('name', { ... })` | `await kernel.plugins.register(plugin)` |
| Schedule job | `app.schedule('name', cron, fn)` | `kernel.scheduler.register({ name, cronExpression, target })` |
| Enqueue task | `await app.enqueue('handler', payload)` | `kernel.taskQueue.enqueue({ handler, payload, priority })` |
| Subscribe events | (not exposed) | `kernel.events.subscribe(['pattern.*'], handler)` |
| Set budget | (not exposed) | `kernel.budget.setBudget(owner, config)` |
| Create identity | (not exposed) | `kernel.identity.register({ id, name, type, permissions })` |
| Direct completion | (not exposed) | `await kernel.models.complete({ messages })` |
| Generate embedding | (not exposed) | `await kernel.models.embed('text')` |
| Run workflow | `await app.runWorkflow(id, input)` | `await kernel.workflows.execute(id, input)` |
| Shutdown | `await app.close()` | `await kernel.stop()` |

---

## Advanced Patterns

### Custom Intent Preprocessing (Middleware)

Build a pipeline that transforms intents before they reach agents:

```typescript
import { KernovaKernel } from '@kernova/core';

// Register middleware that enriches intents with context
await kernel.plugins.register({
  id: 'intent-enricher',
  name: 'Intent Enricher',
  version: '1.0.0',
  type: 'middleware',
  middleware: [
    {
      hook: 'beforeIntentExecution',
      handler: async (context) => {
        // Enrich the intent with relevant memories
        const memories = kernel.memoryEngine.query({
          query: context.intent.goal,
          layers: ['organizational'],
          limit: 3,
        });

        context.intent.metadata.enrichedContext = memories.map(m => m.content);
        context.intent.metadata.processedAt = new Date().toISOString();
        return context;
      },
    },
    {
      hook: 'afterIntentExecution',
      handler: async (context) => {
        // Auto-store successful results as long-term memory
        if (context.result.success) {
          kernel.memoryEngine.store({
            content: `Completed: ${context.intent.goal} — ${context.result.summary}`,
            layer: 'longterm',
            tags: ['completed-intent', 'auto-stored'],
          });
        }
        return context;
      },
    },
  ],
});
```

### Multi-Kernel Setup

Run multiple isolated kernel instances for multi-tenant or multi-environment scenarios:

```typescript
import { KernovaKernel } from '@kernova/core';

// Production kernel — strict budgets, reflection enabled
const prodKernel = new KernovaKernel({
  instanceId: 'prod-kernel',
  environment: 'production',
  dataDir: './data/production',
  models: {
    default: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    fallback: ['openai', 'gemini'],
  },
  reflection: { enabled: true, threshold: 0.9 },
});

// Development kernel — ephemeral, debug mode, cheaper models
const devKernel = new KernovaKernel({
  instanceId: 'dev-kernel',
  environment: 'development',
  ephemeral: true,
  debug: true,
  models: {
    default: { provider: 'openai', model: 'gpt-4o-mini' },
  },
  reflection: { enabled: false },
});

// Start both
await Promise.all([prodKernel.start(), devKernel.start()]);

// Route requests to the appropriate kernel
function getKernel(env: string): KernovaKernel {
  return env === 'production' ? prodKernel : devKernel;
}

const kernel = getKernel(process.env.TARGET_ENV || 'development');
await kernel.submit({ goal: 'Process the incoming request' });

// Shutdown both
await Promise.all([prodKernel.stop(), devKernel.stop()]);
```

### Event-Driven Architecture

Build reactive systems using the EventBus as the backbone:

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });
await kernel.start();

// Build a metrics dashboard from events
const metrics = { intents: 0, failures: 0, tokens: 0 };

kernel.events.subscribe(['intent.completed'], () => { metrics.intents++; });
kernel.events.subscribe(['intent.failed'], () => { metrics.failures++; });
kernel.events.subscribe(['model.*'], (event) => {
  metrics.tokens += (event.data.totalTokens as number) || 0;
});

// React to pipeline stages
kernel.events.subscribe(['pipeline.ingestion.completed'], async (event) => {
  // Automatically trigger analysis when ingestion completes
  await kernel.submit({
    goal: `Analyze the ingested data: ${event.data.goal}`,
    intentType: 'action',
    priority: 'medium',
  });
});

// Audit trail — persist all events for compliance
kernel.events.subscribe(['*'], (event) => {
  // Write to external audit system
  console.log(`[audit] ${event.timestamp} ${event.eventType} actor=${event.actorId}`);
});

// Query historical events
const last24h = kernel.events.query({
  category: 'intent',
  since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  order: 'desc',
});
console.log(`Events in last 24h: ${last24h.length}`);
```

### Building Your Own SDK / Framework

Use `@kernova/core` as the engine behind your own developer-facing API:

```typescript
import { KernovaKernel, defineAgent } from '@kernova/core';
import type { Intent, IntentResult } from '@kernova/types';

/**
 * MyFramework — A domain-specific wrapper around Kernova
 * for building customer support systems.
 */
export class SupportFramework {
  private kernel: KernovaKernel;

  constructor(private config: { apiKey: string; orgId: string }) {
    this.kernel = new KernovaKernel({
      environment: 'production',
      dataDir: `./data/${config.orgId}`,
      models: { default: { provider: 'openai', model: 'gpt-4o' } },
    });
  }

  async initialize(): Promise<void> {
    await this.kernel.start();

    // Pre-register domain-specific agents
    const triageAgent = defineAgent({
      name: 'triage',
      description: 'Categorizes and routes support tickets',
      capabilities: [
        { id: 'triage', name: 'Triage', description: 'Ticket categorization', confidence: 0.95 },
      ],
      tools: [],
      instructions: 'You categorize support tickets into: billing, technical, account, general.',
    });

    this.kernel.agentRegistry.register(triageAgent.definition, triageAgent.executor);

    // Set up org-level budget
    this.kernel.budget.setBudget(this.config.orgId, {
      dailyTokenLimit: 500_000,
    });
  }

  /** Handle a support ticket */
  async handleTicket(message: string, userId: string): Promise<string> {
    const result = await this.kernel.submit({
      goal: `Handle this support request: ${message}`,
      owner: this.config.orgId,
      priority: 'high',
      metadata: { userId, channel: 'support' },
    });

    // Auto-store interaction in memory
    kernel.memoryEngine.store({
      content: `User ${userId}: ${message} → ${result.result?.summary}`,
      layer: 'session',
      tags: ['support', userId],
      owner: userId,
    });

    return result.result?.summary || 'Unable to process your request.';
  }

  async shutdown(): Promise<void> {
    await this.kernel.stop();
  }
}

// Consumer usage:
// const support = new SupportFramework({ apiKey: '...', orgId: 'acme' });
// await support.initialize();
// const reply = await support.handleTicket('I can\'t access my account', 'user-456');
```

---

## Error Handling Patterns

When working with the kernel directly, handle errors at each layer:

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'production', dataDir: './data' });

try {
  await kernel.start();
} catch (error) {
  // Startup failure — a module failed to initialize
  console.error('Kernel failed to start:', error);
  process.exit(1);
}

// Wrap intent submission with retry logic
async function submitWithRetry(goal: string, maxRetries = 3): Promise<Intent> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await kernel.submit({ goal, priority: 'medium' });
      if (result.result?.success) return result;

      // Intent executed but failed — check if retryable
      lastError = new Error(result.result?.summary || 'Unknown failure');
    } catch (error) {
      lastError = error as Error;

      // Budget exceeded or rate limited — don't retry
      if ((error as Error).message.includes('Budget exceeded')) throw error;
      if ((error as Error).message.includes('Rate limit')) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

// Graceful shutdown on signals
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await kernel.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await kernel.stop();
  process.exit(0);
});
```
