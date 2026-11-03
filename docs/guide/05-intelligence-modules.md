# Intelligence Modules

Beyond basic autonomy, Kernova provides higher-level intelligence modules that enable agents to plan complex tasks, evaluate their own work, manage conversation history efficiently, and retrieve relevant knowledge.

## Overview

| Module | Purpose | Access |
|--------|---------|--------|
| **AgentPlanner** | Decompose goals into steps | `kernel.planner` |
| **SelfReflection** | Evaluate and revise output | `kernel.reflection` |
| **ConversationManager** | Sliding window + summarization | `kernel.conversation` |
| **RAGPipeline** | Document chunking + retrieval | `kernel.rag` |
| **AgentTestRunner** | Test framework for agents | Import from `@kernova/core` |

---

## Agent Planner (Plan-and-Execute)

Automatically decomposes complex goals into actionable steps, then executes them sequentially with adaptive replanning on failure.

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });
await kernel.start();

// 1. Create a plan
const plan = await kernel.planner.plan(
  'Build a REST API with user authentication',
  'Using Express.js and JWT tokens'
);

console.log(plan.steps);
// [
//   { description: "Set up Express project structure", ... },
//   { description: "Create user model and database schema", ... },
//   { description: "Implement JWT authentication middleware", ... },
//   { description: "Create registration and login endpoints", ... },
//   { description: "Add protected routes with auth guards", ... },
// ]

// 2. Execute the plan with a custom step executor
const result = await kernel.planner.execute(plan, async (step, plan) => {
  // Your execution logic for each step
  console.log(`Executing: ${step.description}`);
  
  // Submit each step as an intent
  const intent = await kernel.submit({ goal: step.description });
  return intent.result;
});

console.log(result.status); // 'completed' or 'failed'
console.log(result.completedSteps); // 5
```

### Configuration

```typescript
const planner = new AgentPlanner(eventBus, modelRouter, {
  maxSteps: 10,              // Maximum steps in a plan
  strategy: 'sequential',    // 'sequential' | 'parallel' | 'adaptive'
  adaptiveReplanning: true,  // Re-plan on step failure
  maxReplanAttempts: 2,      // How many times to re-plan
});
```

### Features
- LLM-powered goal decomposition
- Sequential, parallel, or adaptive strategies
- Adaptive replanning: when a step fails, generates alternative steps
- Dependency tracking between steps
- Full event tracing (`plan.created`, `plan.step.started`, `plan.replanned`, etc.)
- Plan cancellation support

---

## Self-Reflection

Agents evaluate their own output against quality criteria, then iteratively revise until quality passes.

```typescript
// Evaluate and optionally revise an output
const result = await kernel.reflection.reflect(
  agentOutput,        // The output to evaluate
  'Write a clear explanation of async/await',  // Original goal
  'For junior developers'  // Optional context
);

console.log(result.evaluation.score);      // 0.85
console.log(result.evaluation.passed);     // true (>= 0.7 threshold)
console.log(result.evaluation.criteria);   // Per-criterion scores
console.log(result.revisedOutput);         // Improved version (if revision happened)
console.log(result.iterationCount);        // How many evaluate→revise cycles ran
```

### Evaluate-Only Mode

```typescript
// Just score without revision
const evaluation = await kernel.reflection.evaluate(
  'Some output text',
  'Original goal',
);

console.log(evaluation.score);       // 0.72
console.log(evaluation.suggestions); // ["Add more examples", "Clarify terminology"]
```

### Configuration

```typescript
const reflection = new SelfReflection(eventBus, modelRouter, {
  threshold: 0.7,           // Minimum score to pass (0.0–1.0)
  maxIterations: 3,         // Max evaluate→revise cycles
  criteria: ['accuracy', 'completeness', 'clarity'],
});
```

### Features
- Configurable quality criteria
- Iterative improvement loop (evaluate → revise → re-evaluate)
- Custom evaluation prompts
- Graceful handling of unparseable LLM responses
- Event tracing (`reflection.started`, `reflection.evaluated`, `reflection.revised`, `reflection.completed`)

---

## Conversation History Manager

Manages long-running conversations with a sliding window approach — recent messages stay in full, older messages are auto-summarized to stay within token budgets.

```typescript
const conversation = kernel.conversation;

// Add messages
await conversation.addMessage('user', 'Tell me about TypeScript');
await conversation.addMessage('assistant', 'TypeScript is a typed superset of JavaScript...');
await conversation.addMessage('user', 'How does it compare to Flow?');

// Get the prompt-ready message array
const promptMessages = conversation.getPromptMessages();
// Returns: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }, ...]

// When token budget is exceeded, older messages are auto-summarized
// The prompt will look like:
// [
//   { role: 'system', content: 'Previous conversation summary:\n...' },
//   { role: 'user', content: 'Latest question' },
//   { role: 'assistant', content: 'Latest answer' },
// ]

// Manual compaction
await conversation.compact();

// Export/import for persistence
const exported = conversation.export();
// ... later ...
conversation.import(exported);
```

### Configuration

```typescript
const conversation = new ConversationManager(eventBus, modelRouter, {
  maxTokens: 4000,           // Total token budget for the window
  preserveRecent: 10,        // Always keep the last N messages uncompressed
  autoSummarize: true,       // Auto-compact when budget exceeded
  summarizeThreshold: 0.8,   // Compact at 80% of maxTokens
});
```

### Features
- Sliding window with token budget enforcement
- Auto-summarization via LLM when window overflows
- Preserves recent messages in full
- Multiple summaries stack (each compaction adds a new summary)
- Export/import for conversation persistence
- Token estimation for budget tracking
- Event tracing (`conversation.compacting`, `conversation.compacted`)

---

## RAG Pipeline

Document chunking, embedding, and semantic retrieval for Retrieval-Augmented Generation.

```typescript
// Ingest documents
await kernel.rag.ingest(
  'TypeScript adds static typing to JavaScript...',
  'docs/typescript-intro.md',
  { author: 'team', version: '2.0' }
);

await kernel.rag.ingest(
  'React is a library for building user interfaces...',
  'docs/react-guide.md'
);

// Retrieve relevant context for a query
const results = await kernel.rag.retrieve('How does TypeScript improve code quality?');
// Returns ranked chunks with similarity scores

// Get formatted context string for LLM prompts
const context = await kernel.rag.getContext('TypeScript benefits', { topK: 3 });
// Returns: "[Source: docs/typescript-intro.md]\nTypeScript adds static typing..."

// Use in an agent prompt
const intent = await kernel.submit({
  goal: `Answer this question using the following context:\n${context}\n\nQuestion: What are TypeScript's benefits?`,
});
```

### Chunking Strategies

```typescript
const rag = new RAGPipeline(eventBus, modelRouter, {
  chunkSize: 512,         // Tokens per chunk
  chunkOverlap: 50,       // Overlap between chunks
  topK: 5,                // Results per query
  scoreThreshold: 0.7,    // Minimum similarity
  chunkStrategy: 'recursive', // 'fixed' | 'recursive' | 'sentence' | 'paragraph'
});
```

| Strategy | Description |
|----------|-------------|
| `fixed` | Split at fixed token boundaries with overlap |
| `sentence` | Group sentences until chunk budget is filled |
| `paragraph` | Group paragraphs until chunk budget is filled |
| `recursive` | Try paragraph → sentence → fixed (preserves structure) |

### Features
- Multiple chunking strategies
- Embedding via ModelRouter (any supported provider)
- Cosine similarity semantic search
- Keyword fallback when embeddings are unavailable
- Token-budgeted context assembly
- Document management (ingest, remove, list, clear)
- Event tracing (`rag.ingesting`, `rag.ingested`, `rag.retrieving`, `rag.retrieved`)

---

## Agent Testing Framework

Test your agents with mock providers and conversation simulation.

```typescript
import { AgentTestRunner, MockModelProvider, KernovaKernel, defineAgent } from '@kernova/core';

// Create a kernel with mock provider
const mock = new MockModelProvider({
  responses: {
    'weather': 'The weather is sunny and 72°F.',
    'translate': 'Hola, ¿cómo estás?',
  },
  defaultResponse: 'I can help with that.',
});

const kernel = new KernovaKernel({
  environment: 'development',
  ephemeral: true,
  providers: [mock],
});
await kernel.start();

// Register your agent
const agent = defineAgent({ name: 'assistant', ... });
kernel.agentRegistry.register(agent.definition, agent.executor);

// Create test runner
const runner = new AgentTestRunner(kernel);

// Define and run scenarios
const result = await runner.run(
  AgentTestRunner.scenario(
    'Weather query',
    'What is the weather like?',
    {
      shouldContain: ['sunny', '72'],
      shouldNotContain: ['error', 'sorry'],
      maxDurationMs: 5000,
    },
  )
);

console.log(result.passed);       // true
console.log(result.assertions);   // Detailed assertion results

// Run multiple scenarios
const results = await runner.runAll(scenarios);
const summary = runner.getSummary();
console.log(`${summary.passed}/${summary.total} passed`);
```

### MockModelProvider

```typescript
const mock = new MockModelProvider();

// Add responses
mock.setResponse('pattern', 'response for that pattern');
mock.setDefaultResponse('fallback response');

// Simulate failures
mock.setFailure(true, 'Rate limit exceeded');

// Simulate latency
mock.setLatency(200);

// Inspect calls
console.log(mock.callCount);
console.log(mock.getCallLog());

// Reset between tests
mock.reset();
```

### ConversationSimulator

```typescript
import { ConversationSimulator } from '@kernova/core';

const sim = new ConversationSimulator(kernel);

// Multi-turn simulation
const result = await sim.simulate([
  { role: 'user', content: 'Hello' },
  { role: 'user', content: 'What can you do?', delay: 100 },
  { role: 'user', content: 'Help me with TypeScript' },
]);

console.log(result.turns);        // Each turn with response
console.log(result.success);      // Overall success
console.log(result.totalDurationMs);

// Quick chat mode
const responses = await sim.chat(['Hello', 'How are you?']);
```

### Integration with Vitest

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KernovaKernel, defineAgent, AgentTestRunner, MockModelProvider } from '@kernova/core';

describe('My Agent', () => {
  let kernel: KernovaKernel;
  let runner: AgentTestRunner;

  beforeEach(async () => {
    const mock = new MockModelProvider({ ... });
    kernel = new KernovaKernel({ environment: 'development', ephemeral: true, providers: [mock] });
    await kernel.start();
    // Register agent...
    runner = new AgentTestRunner(kernel);
  });

  afterEach(async () => {
    await kernel.stop();
  });

  it('should answer questions accurately', async () => {
    const result = await runner.run(
      AgentTestRunner.scenario('Q&A', 'What is 2+2?', { shouldContain: ['4'] })
    );
    expect(result.passed).toBe(true);
  });
});
```
