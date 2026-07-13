---
title: Durable Execution
description: Build workflows that survive crashes, restarts, and long-running operations.
---

# Durable Execution

Durable execution ensures that multi-step agent workflows survive process crashes, server restarts, and long-running operations. State is checkpointed to SQLite after each step.

## The Problem

Without durability:
```
Step 1: Extract invoice ✓
Step 2: Validate data ✓
Step 3: Save to database ← CRASH
                           ← Entire workflow lost
                           ← Must restart from step 1
```

With durable execution:
```
Step 1: Extract invoice ✓ (checkpointed)
Step 2: Validate data ✓ (checkpointed)
Step 3: Save to database ← CRASH
                           ← Server restarts
                           ← Resumes from step 3 ✓
```

## Basic Usage

```typescript
import { DurableExecutor, CheckpointStore } from '@kernova/core';

// Create executor (store handles persistence)
const store = new CheckpointStore(db);
const executor = new DurableExecutor(store, eventBus);

// Define a multi-step workflow
const result = await executor.run('process-invoice', [
  {
    name: 'extract',
    execute: async (ctx) => {
      ctx.log('Extracting invoice data...');
      const data = await extractFromPDF(invoice);
      return data;
    },
  },
  {
    name: 'validate',
    execute: async (ctx) => {
      // ctx.previous contains results from previous steps
      const invoiceData = ctx.previous.extract;
      const isValid = validateInvoice(invoiceData);
      if (!isValid) throw new Error('Invalid invoice');
      return { valid: true };
    },
  },
  {
    name: 'save',
    execute: async (ctx) => {
      const data = ctx.previous.extract;
      await database.invoices.create(data);
      return { saved: true, id: 'inv_123' };
    },
  },
  {
    name: 'notify',
    execute: async (ctx) => {
      await sendEmail({
        to: 'finance@company.com',
        subject: `Invoice ${ctx.previous.save.id} processed`,
      });
      return { notified: true };
    },
  },
]);

// result = { extract: {...}, validate: {...}, save: {...}, notify: {...} }
```

## Recovery After Crash

If the process crashes during step 3:

```typescript
// On restart, the executor checks for incomplete tasks
const incomplete = executor.getIncompleteTasks();

for (const task of incomplete) {
  console.log(`Resuming: ${task.name} from step ${task.currentStep}`);
  // Re-run with the same task ID — it resumes from checkpoint
  await executor.run(task.name, steps, { taskId: task.taskId });
}
```

## Human Approval Gates

Add `requiresApproval: true` to any step that needs human confirmation:

```typescript
await executor.run('send-payment', [
  {
    name: 'calculate',
    execute: async (ctx) => {
      return { amount: 10000, recipient: 'vendor@acme.com' };
    },
  },
  {
    name: 'send-money',
    description: 'Send $10,000 to vendor@acme.com',
    requiresApproval: true,  // ← Pauses here until approved
    execute: async (ctx) => {
      await transferFunds(ctx.previous.calculate);
      return { transactionId: 'txn_abc123' };
    },
  },
], {
  onApprovalNeeded: async (step) => {
    // This is called when approval is needed
    // Return true to approve, false to deny
    console.log(`Approval needed: ${step.description}`);
    return await waitForUserApproval(step);
  },
});
```

## Options

```typescript
await executor.run('my-task', steps, {
  // Unique task ID (for recovery)
  taskId: 'invoice-processing-12345',
  
  // Retry failed steps up to 3 times
  maxRetries: 3,
  
  // Each step must complete within 60 seconds
  stepTimeout: 60000,
  
  // Called when a step needs approval
  onApprovalNeeded: async (step) => { ... },
});
```

## Step Context

Each step receives a context object:

```typescript
{
  name: 'my-step',
  execute: async (ctx) => {
    // Results from all previous steps
    ctx.previous; // { step1: result1, step2: result2, ... }
    
    // Save intermediate state (manual checkpoint)
    await ctx.checkpoint({ progress: 50 });
    
    // Log messages (emitted as events)
    ctx.log('Processing item 5/10...');
    
    // Get current task state
    const state = ctx.getState();
    console.log(state.currentStep, state.totalSteps);
  },
}
```

## Events

The durable executor emits events at each stage:

| Event | When |
|-------|------|
| `durable.started` | Task begins (or resumes) |
| `durable.step_completed` | A step finishes successfully |
| `durable.approval_needed` | Waiting for human approval |
| `durable.approval_granted` | Approval received |
| `durable.paused` | Task paused (approval denied or manual) |
| `durable.retry` | Step failed, retrying |
| `durable.failed` | Task failed after all retries |
| `durable.completed` | All steps finished |
| `durable.log` | Log message from a step |

Subscribe to events:

```typescript
kernel.events.subscribe(['durable.*'], (event) => {
  console.log(event.eventType, event.data);
});
```

## Real-World Example: Email Processing Pipeline

```typescript
await executor.run('process-support-email', [
  {
    name: 'parse-email',
    execute: async (ctx) => {
      const email = await fetchEmail(emailId);
      return { from: email.from, subject: email.subject, body: email.body };
    },
  },
  {
    name: 'classify',
    execute: async (ctx) => {
      const classification = await agent.ask(`Classify this email: ${ctx.previous['parse-email'].body}`);
      return { category: classification, priority: 'medium' };
    },
  },
  {
    name: 'create-ticket',
    execute: async (ctx) => {
      const ticket = await createTicket({
        title: ctx.previous['parse-email'].subject,
        category: ctx.previous.classify.category,
        priority: ctx.previous.classify.priority,
      });
      return { ticketId: ticket.id };
    },
  },
  {
    name: 'reply',
    requiresApproval: true,
    description: 'Send auto-reply to customer',
    execute: async (ctx) => {
      await sendReply({
        to: ctx.previous['parse-email'].from,
        body: `We received your request. Ticket #${ctx.previous['create-ticket'].ticketId}`,
      });
      return { replied: true };
    },
  },
]);
```

If the server crashes after creating the ticket but before sending the reply, on restart it resumes from the reply step — the ticket isn't created twice.
