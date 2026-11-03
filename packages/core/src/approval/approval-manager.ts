/**
 * ApprovalManager — Human-in-the-Loop for sensitive agent actions.
 *
 * Agents can request approval before executing dangerous operations.
 * Approvals are persisted and can be managed via API/UI.
 */

import type { ApprovalRequest, ApprovalStatus, ApprovalConfig } from './types.js';
import { setLongTimeout } from '../utils.js';

export class ApprovalManager {
  private requests: Map<string, ApprovalRequest> = new Map();
  private waiters: Map<string, { resolve: (approved: boolean) => void }> = new Map();
  private eventBus: any;
  private config: ApprovalConfig;

  constructor(eventBus?: any, config: ApprovalConfig = {}) {
    this.eventBus = eventBus;
    this.config = {
      defaultTimeout: config.defaultTimeout || 30 * 60 * 1000, // 30 minutes
      autoApproveInDev: config.autoApproveInDev ?? false,
      ...config,
    };
  }

  /**
   * Request approval for an action. Blocks until approved/denied/expired.
   */
  async request(params: {
    action: string;
    description?: string;
    agent: string;
    approver?: string;
    metadata?: Record<string, unknown>;
    taskId?: string;
    timeout?: number;
  }): Promise<boolean> {
    // Auto-approve in dev mode if configured
    if (this.config.autoApproveInDev && process.env.NODE_ENV === 'development') {
      console.log(`[Approval] Auto-approved (dev mode): ${params.action}`);
      return true;
    }

    const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeout = params.timeout || this.config.defaultTimeout!;
    const expiresAt = new Date(Date.now() + timeout).toISOString();

    const request: ApprovalRequest = {
      id,
      action: params.action,
      description: params.description,
      agent: params.agent,
      approver: params.approver || 'any',
      metadata: params.metadata,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt,
      taskId: params.taskId,
    };

    this.requests.set(id, request);
    this.emit('approval.requested', { requestId: id, action: params.action, agent: params.agent });

    // Notify via callback
    if (this.config.onRequest) {
      await this.config.onRequest(request);
    }

    // Wait for approval or timeout
    return new Promise<boolean>((resolve) => {
      this.waiters.set(id, { resolve });

      // Auto-expire after timeout (which may be longer than setTimeout's ~24.8-day limit)
      setLongTimeout(() => {
        const req = this.requests.get(id);
        if (req && req.status === 'pending') {
          req.status = 'expired';
          this.requests.set(id, req);
          this.waiters.delete(id);
          this.emit('approval.expired', { requestId: id });
          resolve(false);
        }
      }, timeout);
    });
  }

  /**
   * Approve a pending request.
   */
  approve(requestId: string, approvedBy: string): boolean {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = 'approved';
    request.resolvedBy = approvedBy;
    request.resolvedAt = new Date().toISOString();
    this.requests.set(requestId, request);

    this.emit('approval.approved', { requestId, approvedBy, action: request.action });

    const waiter = this.waiters.get(requestId);
    if (waiter) {
      waiter.resolve(true);
      this.waiters.delete(requestId);
    }

    return true;
  }

  /**
   * Deny a pending request.
   */
  deny(requestId: string, deniedBy: string, reason?: string): boolean {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = 'denied';
    request.resolvedBy = deniedBy;
    request.reason = reason;
    request.resolvedAt = new Date().toISOString();
    this.requests.set(requestId, request);

    this.emit('approval.denied', { requestId, deniedBy, reason, action: request.action });

    const waiter = this.waiters.get(requestId);
    if (waiter) {
      waiter.resolve(false);
      this.waiters.delete(requestId);
    }

    return true;
  }

  /**
   * Get all pending requests.
   */
  getPending(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(r => r.status === 'pending');
  }

  /**
   * Get all requests (with optional status filter).
   */
  getAll(status?: ApprovalStatus): ApprovalRequest[] {
    const all = Array.from(this.requests.values());
    return status ? all.filter(r => r.status === status) : all;
  }

  /**
   * Get a specific request.
   */
  get(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  private emit(eventType: string, data: Record<string, unknown>): void {
    if (this.eventBus?.publish) {
      this.eventBus.publish({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        eventType,
        category: 'approval',
        severity: eventType.includes('denied') ? 'warn' : 'info',
        timestamp: new Date().toISOString(),
        subjectId: data.requestId as string,
        subjectType: 'approval_request',
        actorId: (data.approvedBy || data.deniedBy || 'system') as string,
        correlationId: data.requestId as string,
        data,
        metadata: { schemaVersion: '1.0.0', source: 'approval-manager', environment: 'production' },
      });
    }
  }
}
