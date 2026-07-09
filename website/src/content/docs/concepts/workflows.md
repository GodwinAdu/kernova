---
title: Workflows
description: Build multi-step processes with human approval, parallel execution, and error recovery.
---

# Workflows

Real-world AI tasks are rarely one-shot. "Research a topic, write a draft, get approval, then publish" is a **multi-step process** that needs orchestration. That's what the workflow engine does.

## When to Use Workflows

Use workflows when you need:
- **Sequential steps** — Do A, then B, then C
- **Human approval** — Wait for someone to approve before continuing
- **Parallel execution** — Do A and B simultaneously, then C
- **Error recovery** — If step 3 fails, undo steps 1 and 2
- **Long-running processes** — Tasks that take minutes or hours

For simple one-shot tasks, just use `app.ask()`. Workflows are for complex orchestration.

## Example: Content Pipeline

```typescript
import { generateId, now } from '@nexus/core';

kernel.workflows.define({
  id: generateId('wf_def'),
  type: 'workflow_definition',
  version: '1.0.0',
  owner: 'system',
  status: 'active',
  createdAt: now(),
  updatedAt: now(),
  metadata: {},
  name: 'content-pipeline',
  description: 'Research → Write → Approve → Publish',
  steps: [
    {
      id: 'research',
      name: 'Research the topic',
      type: 'agent',
      config: { agentId: 'researcher', input: { goal: 'Research the topic' } },
      onFailure: 'stop',
    },
    {
      id: 'write',
      name: 'Write the article',
      type: 'agent',
      config: { agentId: 'writer' },
      onFailure: 'stop',
    },
    {
      id: 'review',
      name: 'Editorial review',
      type: 'approval',
      config: { approvers: ['editor'] },
      onFailure: 'stop',
    },
    {
      id: 'publish',
      name: 'Publish to CMS',
      type: 'tool',
      config: { toolId: 'cms:publish' },
      onFailure: 'compensate',
      compensation: { toolId: 'cms:unpublish' },
    },
  ],
});
```

## Step Types

| Type | What it does | Example |
|------|-------------|---------|
| `agent` | Delegates to a named agent | Research, write, analyze |
| `tool` | Calls a plugin tool | Publish, send email, deploy |
| `approval` | Waits for human approval | Editorial review, budget sign-off |
| `parallel` | Runs multiple steps concurrently | Research + gather data simultaneously |
| `condition` | Branches based on a condition | If score > 0.8, publish; else revise |
| `wait` | Pauses for a duration | Wait 5 minutes between API calls |
| `transform` | Transforms data between steps | Format output for next step |

## Running a Workflow

```typescript
const instance = await kernel.workflows.execute(
  definitionId,
  { topic: 'AI in healthcare', audience: 'developers' }, // Input data
);

console.log(instance.workflowStatus); // 'completed' or 'failed'
console.log(instance.stepResults);    // Results from each step
```

## Human Approval

### Programmatic handler

Set up a handler that gets called when approval is needed:

```typescript
kernel.workflows.onApproval(async (workflowId, stepId, description) => {
  // This could: show a UI prompt, send a Slack message, send an email
  console.log(`Approval needed: ${description}`);
  
  // Return the decision
  return { approved: true, reason: 'Looks good!' };
});
```

### External approval (from API/UI)

If approval comes from an external system (like a web dashboard):

```typescript
// Check what's waiting for approval
const pending = kernel.workflows.getPendingApprovals();
// [{ workflowId: 'wf_123', stepId: 'review', stepName: 'Editorial review' }]

// Approve or reject from your UI
kernel.workflows.resolveApproval('wf_123', 'review', true, 'Approved by editor');
// or
kernel.workflows.resolveApproval('wf_123', 'review', false, 'Needs more research');
```

## Error Handling

Each step defines what happens if it fails:

```typescript
{
  id: 'publish',
  name: 'Publish',
  type: 'tool',
  config: { toolId: 'cms:publish' },
  onFailure: 'compensate',  // ← what to do on failure
  compensation: { toolId: 'cms:unpublish' }, // ← how to undo
}
```

| `onFailure` | Behavior |
|-------------|----------|
| `stop` | Halt the entire workflow |
| `continue` | Skip this step, continue to next |
| `retry` | Try once more, then fail |
| `compensate` | Undo all completed steps in reverse order |

### Compensation (undo)

When a step with `onFailure: 'compensate'` fails, the engine runs compensation for all previously completed steps **in reverse order**:

```
Step 1: Research  ✓ (completed)
Step 2: Write     ✓ (completed)  
Step 3: Publish   ✗ (failed!)

Compensation runs:
  Undo Step 2: Delete draft
  Undo Step 1: Clear research cache
```

## Parallel Execution

Run multiple steps simultaneously:

```typescript
{
  id: 'gather',
  name: 'Gather data from multiple sources',
  type: 'parallel',
  config: {
    parallel: [
      { id: 'api-data', name: 'Fetch API data', type: 'tool', config: { toolId: 'api:fetch' }, onFailure: 'stop' },
      { id: 'db-data', name: 'Query database', type: 'tool', config: { toolId: 'db:query' }, onFailure: 'stop' },
      { id: 'web-data', name: 'Scrape web', type: 'tool', config: { toolId: 'web:scrape' }, onFailure: 'continue' },
    ],
  },
  onFailure: 'stop',
}
```

All three run concurrently. The step completes when all parallel sub-steps finish.

## Conditional Branching

```typescript
{
  id: 'decide',
  name: 'Quality check',
  type: 'condition',
  config: {
    branches: [
      { condition: 'lastStep.success', steps: [publishStep] },
      { condition: 'true', steps: [reviseStep] }, // Default branch
    ],
  },
  onFailure: 'stop',
}
```

## Timeouts

Every step has a timeout (default: 60 seconds). Prevent steps from hanging:

```typescript
{
  id: 'long-task',
  name: 'Process large dataset',
  type: 'agent',
  config: { agentId: 'processor' },
  timeoutMs: 300000, // 5 minutes
  onFailure: 'stop',
}
```

## Concurrency Control

Limit how many workflows run simultaneously:

```typescript
const engine = new WorkflowEngine(eventBus, agents, plugins, {
  maxConcurrent: 5,           // Max 5 workflows at once
  defaultStepTimeoutMs: 60000, // 60s default per step
});
```

## Events

Workflows emit events at every stage:
- `workflow.defined` — New definition registered
- `workflow.started` — Execution began
- `workflow.step.started` / `workflow.step.completed` / `workflow.step.failed`
- `workflow.approval.requested` — Waiting for human
- `workflow.completed` / `workflow.failed`

Monitor progress in real-time:
```typescript
kernel.events.subscribe(['workflow.*'], (event) => {
  console.log(`Workflow ${event.data.workflowId}: ${event.eventType}`);
});
```

## Best Practices

1. **Keep steps small** — Each step should do one thing
2. **Always define `onFailure`** — Don't leave error handling to chance
3. **Use compensation for side effects** — If a step changes external state, define how to undo it
4. **Set timeouts** — Prevent workflows from hanging forever
5. **Monitor with events** — Subscribe to `workflow.*` for production visibility
