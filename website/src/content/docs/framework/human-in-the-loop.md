---
title: Human-in-the-Loop
description: Add approval checkpoints for sensitive agent actions.
---

# Human-in-the-Loop

Agents sometimes need human approval before executing sensitive actions — sending money, deleting data, or making external API calls with real consequences.

## The Concept

```
Agent wants to send $10,000
  ↓
PAUSE — Request approval
  ↓
Human reviews in dashboard/API
  ↓
Approved ✓ → Agent continues
Denied ✗ → Agent stops
Timeout → Auto-deny
```

## Using the Approval Manager

```typescript
import { ApprovalManager } from '@kernova/core';

const approval = new ApprovalManager(kernel.events, {
  defaultTimeout: 30 * 60 * 1000, // 30 minutes
  autoApproveInDev: true,          // Skip approvals when NODE_ENV=development
});

// Request approval (blocks until resolved)
const approved = await approval.request({
  action: 'Delete all user data for account #12345',
  description: 'User requested account deletion via support chat',
  agent: 'support-agent',
  metadata: { userId: '12345', reason: 'user_request' },
});

if (approved) {
  await deleteUserData('12345');
} else {
  await agent.respond('Account deletion was not approved by a supervisor.');
}
```

## Resolving Approvals

From your API or dashboard:

```typescript
// Approve
approval.approve('approval_abc123', 'admin_user_456');

// Deny with reason
approval.deny('approval_abc123', 'admin_user_456', 'Amount exceeds daily limit');
```

## In Agent Definitions

Use `requiresConfirmation` on tools:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'transfer-funds',
  description: 'Transfer money between accounts',
  requiresConfirmation: true,  // ← Agent must get approval before executing
  parameters: {
    amount: { type: 'number', description: 'Amount in USD', required: true },
    to: { type: 'string', description: 'Recipient account', required: true },
  },
  execute: async ({ amount, to }, ctx) => {
    // This only runs after approval
    return await bankAPI.transfer({ amount, to });
  },
});
```

## With Durable Execution

Combine with durable execution for workflows that pause at approval gates:

```typescript
await executor.run('refund-customer', [
  {
    name: 'calculate-refund',
    execute: async (ctx) => {
      return { amount: 299.99, orderId: 'ord_123' };
    },
  },
  {
    name: 'process-refund',
    description: 'Refund $299.99 for order #ord_123',
    requiresApproval: true,  // ← Workflow pauses here
    execute: async (ctx) => {
      const { amount, orderId } = ctx.previous['calculate-refund'];
      await stripe.refunds.create({ amount: amount * 100 });
      return { refunded: true };
    },
  },
  {
    name: 'notify-customer',
    execute: async (ctx) => {
      await sendEmail({ subject: 'Your refund has been processed' });
      return { notified: true };
    },
  },
]);
```

The workflow:
1. Calculates the refund amount
2. **Pauses** — waits for human approval
3. Once approved, processes the refund
4. Notifies the customer

If the server restarts while waiting for approval, the workflow resumes in the "awaiting_approval" state.

## Listing Pending Approvals

```typescript
// Get all pending approvals
const pending = approval.getPending();

pending.forEach(req => {
  console.log(`[${req.id}] ${req.action} — requested by ${req.agent}`);
});
```

## API Endpoint for Approvals

Add an API route in your project to expose approvals to a dashboard:

```typescript
// app/api/approvals/route.ts (Next.js)
import { approval } from '@/lib/kernel';

export async function GET() {
  return Response.json({ approvals: approval.getPending() });
}

export async function POST(req: Request) {
  const { requestId, action, userId } = await req.json();
  
  if (action === 'approve') {
    approval.approve(requestId, userId);
  } else {
    approval.deny(requestId, userId);
  }
  
  return Response.json({ ok: true });
}
```

## Configuration

```typescript
const approval = new ApprovalManager(kernel.events, {
  // How long to wait before auto-denying (default: 30 min)
  defaultTimeout: 60 * 60 * 1000, // 1 hour
  
  // Skip approvals in development (default: false)
  autoApproveInDev: true,
  
  // Callback for notifications (email, Slack, push)
  onRequest: async (request) => {
    await sendSlackMessage({
      channel: '#agent-approvals',
      text: `🤖 Agent "${request.agent}" needs approval: ${request.action}`,
    });
  },
});
```

## Events

| Event | When |
|-------|------|
| `approval.requested` | New approval request created |
| `approval.approved` | Request was approved |
| `approval.denied` | Request was denied |
| `approval.expired` | Request timed out |

```typescript
kernel.events.subscribe(['approval.*'], (event) => {
  if (event.eventType === 'approval.requested') {
    // Send push notification to admin
    notifyAdmin(event.data);
  }
});
```

## Best Practices

1. **Be specific in descriptions** — "Delete user #123's data" not "Delete something"
2. **Set appropriate timeouts** — Financial operations: short. Content review: longer.
3. **Use auto-approve in dev** — Don't slow down development with approvals
4. **Log all decisions** — The approval manager emits events for audit trails
5. **Provide context** — Include metadata (amounts, recipients, IDs) so reviewers can decide quickly
