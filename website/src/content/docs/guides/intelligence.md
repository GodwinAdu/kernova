---
title: Intelligence Modules
description: Give your agents planning, reflection, memory management, and knowledge retrieval.
---

These modules add higher-level cognitive capabilities to your agents — the ability to plan multi-step tasks, evaluate their own work, manage long conversations, and retrieve relevant knowledge.

## Agent Planner (Plan-and-Execute)

Automatically decompose complex goals into manageable steps, then execute them one by one.

```typescript
const kernel = app.getKernel();

// Create a plan for a complex goal
const plan = await kernel.planner.plan(
  'Build a REST API with user authentication and deploy it',
  'Using Express.js, JWT, and Docker' // Optional context
);

console.log(`Plan: ${plan.steps.length} steps`);
for (const step of plan.steps) {
  console.log(`  ${step.index + 1}. ${step.description}`);
}
// Output:
//   1. Set up Express.js project with TypeScript
//   2. Create user model and database schema
//   3. Implement JWT authentication middleware
//   4. Build registration and login endpoints
//   5. Add protected routes with auth guards
//   6. Write Dockerfile and docker-compose.yml
//   7. Test the complete flow

// Execute the plan step by step
const result = await kernel.planner.execute(plan, async (step) => {
  // Your logic for each step — could call the kernel, run tools, etc.
  const intent = await kernel.submit({ goal: step.description });
  return intent.result;
});

console.log(result.status);        // 'completed'
console.log(result.completedSteps); // 7
```

### Adaptive Replanning

If a step fails, the planner can generate alternative steps automatically:

```typescript
const planner = kernel.planner; // Adaptive replanning is on by default

// If step 3 fails, the planner will:
// 1. Analyze why it failed
// 2. Generate new steps to work around the failure
// 3. Continue execution with the revised plan
```

### Configuration

```typescript
import { AgentPlanner } from '@kernova/core';

const planner = new AgentPlanner(eventBus, modelRouter, {
  maxSteps: 10,              // Maximum plan size
  strategy: 'sequential',    // Execute one at a time
  adaptiveReplanning: true,  // Re-plan on failure
  maxReplanAttempts: 2,      // How many re-plans to try
});
```

---

## Self-Reflection

Agents evaluate their own output and iteratively improve it until quality passes a threshold.

```typescript
// Evaluate and optionally revise an agent's output
const result = await kernel.reflection.reflect(
  agentResponse,                    // The output to evaluate
  'Write a clear guide to async/await for beginners', // The original goal
  'Target audience: junior developers'               // Optional context
);

if (result.evaluation.passed) {
  console.log('Output quality is good!');
  console.log(`Score: ${result.evaluation.score}`); // e.g., 0.87
} else {
  console.log('Output was revised:');
  console.log(result.revisedOutput);
}

// Detailed feedback per criterion
for (const criterion of result.evaluation.criteria) {
  console.log(`  ${criterion.name}: ${criterion.score} — ${criterion.feedback}`);
}
// Output:
//   accuracy: 0.9 — Information is correct
//   completeness: 0.8 — Missing error handling examples
//   clarity: 0.85 — Clear for the target audience
```

### How It Works

1. Agent produces output
2. Reflection evaluates it against configurable criteria
3. If score < threshold (default 0.7), it generates improvement suggestions
4. The LLM revises the output based on feedback
5. Steps 2-4 repeat until quality passes or max iterations reached

### Evaluate Without Revision

```typescript
// Just score the output — no automatic revision
const evaluation = await kernel.reflection.evaluate(output, goal);
console.log(evaluation.score);       // 0.72
console.log(evaluation.suggestions); // ["Add examples", "Explain edge cases"]
```

---

## Conversation History Manager

Keeps long conversations within token budgets by automatically summarizing older messages.

```typescript
const conversation = kernel.conversation;

// Messages are tracked automatically during intent execution,
// but you can also manage manually:

await conversation.addMessage('user', 'Tell me about TypeScript generics');
await conversation.addMessage('assistant', 'Generics let you write reusable...');
await conversation.addMessage('user', 'Can you show me an example with arrays?');

// Get messages formatted for an LLM prompt
const promptMessages = conversation.getPromptMessages();
// Returns: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]

// After many messages, older ones are auto-summarized:
// [
//   { role: 'system', content: 'Previous conversation summary:\nDiscussed TypeScript generics...' },
//   { role: 'user', content: 'Most recent question' },
//   { role: 'assistant', content: 'Most recent answer' },
// ]

// Check the current state
console.log(conversation.totalMessages);     // 47
console.log(conversation.activeMessageCount); // 10 (most recent, unsummarized)
console.log(conversation.getWindowTokenCount()); // 3200 tokens
```

### Configuration

```typescript
import { ConversationManager } from '@kernova/core';

const conversation = new ConversationManager(eventBus, modelRouter, {
  maxTokens: 4000,           // Total budget
  preserveRecent: 10,        // Always keep last 10 messages in full
  autoSummarize: true,       // Auto-compact when budget exceeded
  summarizeThreshold: 0.8,   // Compact at 80% of budget
});
```

---

## RAG Pipeline

Ingest documents, chunk them, generate embeddings, and retrieve relevant context for any query.

```typescript
// Ingest documents
await kernel.rag.ingest(
  'TypeScript adds static type checking to JavaScript...',
  'docs/typescript.md',
  { category: 'language', version: '5.0' }
);

await kernel.rag.ingest(
  'Express is a minimal web framework for Node.js...',
  'docs/express.md'
);

await kernel.rag.ingest(readFileSync('large-doc.md', 'utf-8'), 'docs/architecture.md');

// Retrieve relevant chunks for a query
const results = await kernel.rag.retrieve('How to add middleware in Express?');
for (const result of results) {
  console.log(`[${result.score.toFixed(2)}] ${result.document.source}`);
  console.log(`  ${result.chunk.content.slice(0, 100)}...`);
}

// Get a formatted context string ready for injection into a prompt
const context = await kernel.rag.getContext('Express middleware', { topK: 3 });
// Returns: "[Source: docs/express.md]\nExpress middleware functions..."

// Use it in an agent call
const intent = await kernel.submit({
  goal: `Using this context:\n${context}\n\nHow do I add auth middleware?`,
});
```

### Chunking Strategies

| Strategy | Best For |
|----------|---------|
| `recursive` (default) | General documents — tries paragraph, then sentence, then fixed |
| `paragraph` | Well-structured documents with clear paragraphs |
| `sentence` | Dense text where sentences are self-contained |
| `fixed` | Uniform chunks regardless of content structure |

### Pipeline Stats

```typescript
const stats = kernel.rag.stats();
// { documents: 15, chunks: 234, embeddedChunks: 234 }
```

---

## Agent Testing Framework

Test your agents with mock providers and scenario-based assertions.

```typescript
import { NexusKernel, defineAgent, AgentTestRunner, MockModelProvider } from '@kernova/core';

// Create a kernel with deterministic mock responses
const mock = new MockModelProvider({
  responses: {
    'weather': 'The weather in Seattle is 65°F and cloudy.',
    'translate': 'Hola, ¿cómo estás?',
  },
  defaultResponse: 'I can help with that.',
});

const kernel = new NexusKernel({
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

// Run test scenarios
const result = await runner.run(
  AgentTestRunner.scenario('Weather query', 'What is the weather in Seattle?', {
    shouldContain: ['Seattle', '65'],
    shouldNotContain: ['error'],
    maxDurationMs: 5000,
  })
);

expect(result.passed).toBe(true);
```

### Mock Provider Features

```typescript
const mock = new MockModelProvider();

// Pattern-based responses (substring or regex matching)
mock.setResponse('weather', 'It is sunny.');
mock.setResponse('/translate .+ to spanish/i', 'Translated!');

// Simulate failures
mock.setFailure(true, 'Rate limit exceeded');

// Simulate latency
mock.setLatency(500); // 500ms delay

// Inspect calls made
console.log(mock.callCount);      // 5
console.log(mock.getCallLog());   // Array of { request, timestamp }

// Reset between tests
mock.reset();
```
