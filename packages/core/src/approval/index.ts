/**
 * Human-in-the-Loop Approval System
 *
 * Allows agents to pause execution and request human approval
 * for sensitive actions before proceeding.
 *
 * Usage:
 *   const approval = new ApprovalManager(store, eventBus);
 *
 *   // In agent execution:
 *   await approval.request({
 *     action: 'Send $10,000 to vendor',
 *     agent: 'finance-agent',
 *     metadata: { amount: 10000, recipient: 'vendor@acme.com' },
 *   });
 *
 *   // From UI/webhook:
 *   await approval.approve(requestId, 'user_123');
 *   // or
 *   await approval.deny(requestId, 'user_123', 'Amount too high');
 */

export { ApprovalManager } from './approval-manager.js';
export type { ApprovalRequest, ApprovalStatus, ApprovalConfig } from './types.js';
