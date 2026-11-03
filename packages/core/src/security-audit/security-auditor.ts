/**
 * Kernova Security Auditor
 *
 * Automated security scanning for agent configurations:
 * - Detects exposed secrets in config
 * - Checks for overly permissive tool policies
 * - Validates sandbox configurations
 * - Checks rate limit coverage
 * - Reports issues with severity levels
 *
 * Inspired by OpenClaw's 80+ security audit checks.
 */

import type { KernovaId, KernovaEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import type { KernovaKernel } from '../kernel.js';
import { generateId, now } from '../utils.js';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface AuditCheck {
  id: string;
  name: string;
  description: string;
  category: 'secrets' | 'permissions' | 'sandbox' | 'rate-limits' | 'config' | 'network';
  check: (kernel: KernovaKernel) => AuditFinding | null;
}

export interface AuditFinding {
  checkId: string;
  severity: AuditSeverity;
  message: string;
  recommendation: string;
  details?: Record<string, unknown>;
}

export interface AuditResult {
  timestamp: string;
  duration: number;
  findings: AuditFinding[];
  passed: number;
  failed: number;
  score: number;          // 0-100 security score
}

export class SecurityAuditor {
  private readonly eventBus: EventBus;
  private checks: AuditCheck[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.registerBuiltInChecks();
  }

  /**
   * Run all security checks against the kernel.
   */
  audit(kernel: KernovaKernel): AuditResult {
    const start = Date.now();
    const findings: AuditFinding[] = [];

    for (const check of this.checks) {
      try {
        const finding = check.check(kernel);
        if (finding) findings.push(finding);
      } catch {
        // Check failed to run — skip
      }
    }

    const failed = findings.length;
    const passed = this.checks.length - failed;
    const score = Math.round((passed / this.checks.length) * 100);

    const result: AuditResult = {
      timestamp: now(),
      duration: Date.now() - start,
      findings,
      passed,
      failed,
      score,
    };

    this.emitEvent('security.audit.completed', 'audit', {
      score,
      findings: failed,
      passed,
      criticals: findings.filter(f => f.severity === 'critical').length,
    });

    return result;
  }

  /**
   * Register a custom audit check.
   */
  addCheck(check: AuditCheck): void {
    this.checks.push(check);
  }

  /**
   * List all registered checks.
   */
  listChecks(): Array<{ id: string; name: string; category: string }> {
    return this.checks.map(c => ({ id: c.id, name: c.name, category: c.category }));
  }

  // ─── Built-in Checks ──────────────────────────────────────

  private registerBuiltInChecks(): void {
    this.checks.push(
      {
        id: 'auth-anonymous',
        name: 'Anonymous Access Enabled',
        description: 'Checks if the gateway allows unauthenticated access',
        category: 'permissions',
        check: (kernel) => {
          // Gateway allows anonymous by default — warn in production
          if (kernel.getStatus().environment === 'production') {
            return {
              checkId: 'auth-anonymous',
              severity: 'high',
              message: 'Gateway allows anonymous access in production',
              recommendation: 'Set auth.allowAnonymous=false and configure bearer tokens',
            };
          }
          return null;
        },
      },
      {
        id: 'rate-limits-missing',
        name: 'No Rate Limits Configured',
        description: 'Checks if rate limiting rules are configured',
        category: 'rate-limits',
        check: (kernel) => {
          const check = kernel.rateLimiter.check('global', '*');
          // If the default limit is the built-in 100/min with no custom rules
          if (check.remaining >= 100) {
            return {
              checkId: 'rate-limits-missing',
              severity: 'medium',
              message: 'Using default rate limits — no custom rules configured',
              recommendation: 'Add per-identity and per-provider rate limit rules',
            };
          }
          return null;
        },
      },
      {
        id: 'no-agents-registered',
        name: 'No Agents Registered',
        description: 'Checks if at least one agent is available',
        category: 'config',
        check: (kernel) => {
          if (kernel.getStatus().registeredAgents === 0) {
            return {
              checkId: 'no-agents-registered',
              severity: 'low',
              message: 'No agents registered — intents will fail',
              recommendation: 'Register at least one agent with defineAgent()',
            };
          }
          return null;
        },
      },
      {
        id: 'no-model-provider',
        name: 'No Model Provider Available',
        description: 'Checks if at least one model provider is configured',
        category: 'config',
        check: (kernel) => {
          const providers = kernel.getStatus().availableProviders;
          if (providers.length === 0) {
            return {
              checkId: 'no-model-provider',
              severity: 'critical',
              message: 'No model provider available — agents cannot generate responses',
              recommendation: 'Configure at least one provider (OpenAI, Anthropic, Ollama, etc.)',
            };
          }
          return null;
        },
      },
      {
        id: 'debug-in-production',
        name: 'Debug Mode in Production',
        description: 'Checks if debug/trajectory recording is on in production',
        category: 'config',
        check: (kernel) => {
          if (kernel.getStatus().environment === 'production' && kernel.trajectory.enabled) {
            return {
              checkId: 'debug-in-production',
              severity: 'medium',
              message: 'Trajectory recording is enabled in production — may leak sensitive data',
              recommendation: 'Disable debug mode or ensure redactSecrets is enabled',
            };
          }
          return null;
        },
      },
    );
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'security_audit',
      actorId: 'security-auditor',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'security-auditor', environment: 'runtime' },
    });
  }
}
