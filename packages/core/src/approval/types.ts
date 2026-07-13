/**
 * Types for Human-in-the-Loop Approval.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  /** What action needs approval */
  action: string;
  /** Description of why approval is needed */
  description?: string;
  /** Which agent is requesting */
  agent: string;
  /** Who should approve (user ID, role, or 'any') */
  approver?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
  /** Current status */
  status: ApprovalStatus;
  /** Who approved/denied */
  resolvedBy?: string;
  /** Denial reason */
  reason?: string;
  /** When the request was created */
  createdAt: string;
  /** When it was resolved */
  resolvedAt?: string;
  /** Expires after this time (auto-deny) */
  expiresAt?: string;
  /** Task/workflow ID this is associated with */
  taskId?: string;
}

export interface ApprovalConfig {
  /** Default timeout for approval requests (ms) */
  defaultTimeout?: number;
  /** Callback when approval is requested (for notifications) */
  onRequest?: (request: ApprovalRequest) => Promise<void>;
  /** Auto-approve in development mode */
  autoApproveInDev?: boolean;
}
