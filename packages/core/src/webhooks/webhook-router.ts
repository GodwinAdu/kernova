/**
 * Kernova Webhook Router
 *
 * Handles inbound webhook events and routes them to agents/intents.
 * - Route registration with path matching
 * - Signature verification (HMAC SHA-256)
 * - Body transformation (JSONPath extraction)
 * - Target routing (intent submission or event emission)
 *
 * Inspired by OpenClaw's gateway/hooks.ts system.
 */

import type {
  KernovaId,
  KernovaEvent,
  WebhookRoute,
  WebhookTransform,
  WebhookTarget,
  WebhookEvent,
  Priority,
} from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';
import { ValidationError } from '../errors.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header carrying the HMAC signature when a route has a secret but no signatureHeader */
const DEFAULT_SIGNATURE_HEADER = 'x-kernova-signature';

export interface WebhookRouterConfig {
  /** Maximum body size in bytes */
  maxBodyBytes?: number;         // default: 256KB
  /** Handler for routing webhook to intent */
  onIntent?: (goal: string, priority: Priority, metadata?: Record<string, unknown>) => Promise<void>;
}

export class WebhookRouter {
  private readonly eventBus: EventBus;
  private readonly config: WebhookRouterConfig;
  private routes: Map<KernovaId, WebhookRoute> = new Map();
  private recentEvents: WebhookEvent[] = [];

  constructor(eventBus: EventBus, config?: WebhookRouterConfig) {
    this.eventBus = eventBus;
    this.config = config ?? {};
  }

  /**
   * Register a webhook route.
   */
  register(route: Omit<WebhookRoute, 'id' | 'createdAt'>): WebhookRoute {
    if (!route.path || !route.path.startsWith('/')) {
      throw new ValidationError('path', 'Webhook path must start with /');
    }

    const fullRoute: WebhookRoute = {
      id: generateId('hook'),
      ...route,
      enabled: route.enabled !== false,
      createdAt: now(),
    };

    this.routes.set(fullRoute.id, fullRoute);
    return fullRoute;
  }

  /**
   * Remove a webhook route.
   */
  remove(routeId: KernovaId): boolean {
    return this.routes.delete(routeId);
  }

  /**
   * Handle an incoming webhook request.
   */
  async handle(request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
    /** The body exactly as received. Signatures are computed over these bytes. */
    rawBody?: string;
  }): Promise<{ matched: boolean; routeId?: KernovaId; error?: string }> {
    const route = this.findRoute(request.method, request.path);
    if (!route) {
      return { matched: false };
    }

    // Verify the signature whenever the route has a secret
    if (route.secret) {
      const valid = this.verifySignature(
        request.headers,
        request.rawBody ?? request.body,
        route.secret,
        route.transform ?? {},
      );
      if (!valid) {
        return { matched: true, routeId: route.id, error: 'Signature verification failed' };
      }
    }

    // Record the event
    const event: WebhookEvent = {
      id: generateId('whevt'),
      routeId: route.id,
      method: request.method,
      path: request.path,
      headers: request.headers,
      body: request.body,
      receivedAt: now(),
      processed: false,
    };
    this.recentEvents.push(event);
    if (this.recentEvents.length > 100) {
      this.recentEvents.shift();
    }

    // Route to target
    try {
      await this.routeToTarget(route.target, request.body, request.headers);
      event.processed = true;

      this.emitEvent('webhook.processed', route.id, {
        path: route.path,
        target: route.target.type,
      });

      return { matched: true, routeId: route.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emitEvent('webhook.failed', route.id, {
        path: route.path,
        error: msg,
      });
      return { matched: true, routeId: route.id, error: msg };
    }
  }

  /**
   * List all registered routes.
   */
  list(): WebhookRoute[] {
    return Array.from(this.routes.values());
  }

  /**
   * Get recent webhook events.
   */
  getRecentEvents(): WebhookEvent[] {
    return [...this.recentEvents];
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Whether a request to this route is authenticated by its signature.
   * The gateway lets these through without a bearer token, since senders like GitHub can't send one.
   */
  isSignedRoute(method: string, path: string): boolean {
    return Boolean(this.findRoute(method, path)?.secret);
  }

  private findRoute(method: string, path: string): WebhookRoute | undefined {
    for (const route of this.routes.values()) {
      if (!route.enabled) continue;
      if (route.method !== method.toUpperCase()) continue;
      if (this.pathMatches(route.path, path)) return route;
    }
    return undefined;
  }

  private pathMatches(pattern: string, path: string): boolean {
    if (pattern === path) return true;
    // Support trailing wildcard: /hooks/github/*
    if (pattern.endsWith('/*')) {
      return path.startsWith(pattern.slice(0, -2));
    }
    return false;
  }

  private verifySignature(
    headers: Record<string, string>,
    body: unknown,
    secret: string,
    transform: WebhookTransform,
  ): boolean {
    const headerName = (transform.signatureHeader ?? DEFAULT_SIGNATURE_HEADER).toLowerCase();

    const signature = headers[headerName];
    if (!signature) return false;

    const algo = transform.signatureAlgorithm ?? 'sha256';
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = Buffer.from(createHmac(algo, secret).update(payload).digest('hex'));

    // Support "sha256=<hex>" format (GitHub style)
    const normalized = Buffer.from(signature.includes('=') ? signature.split('=').pop()! : signature);
    return normalized.length === expected.length && timingSafeEqual(normalized, expected);
  }

  private async routeToTarget(
    target: WebhookTarget,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<void> {
    switch (target.type) {
      case 'intent':
        if (this.config.onIntent) {
          const goal = target.goal ?? (typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body));
          await this.config.onIntent(goal, target.priority ?? 'medium', { webhookBody: body });
        }
        break;

      case 'event':
        this.eventBus.publish({
          id: generateId('evt'),
          eventType: target.eventType ?? 'webhook.received',
          category: 'system',
          severity: 'info',
          timestamp: now(),
          subjectId: generateId('webhook'),
          subjectType: 'webhook',
          actorId: 'webhook-router',
          correlationId: generateId('cor'),
          data: { body, headers },
          metadata: { schemaVersion: '1.0.0', source: 'webhook-router', environment: 'runtime' },
        });
        break;

      case 'agent':
        if (this.config.onIntent) {
          const goal = target.goal ?? 'Process webhook event';
          await this.config.onIntent(goal, target.priority ?? 'medium', {
            webhookBody: body,
            targetAgent: target.agentName,
          });
        }
        break;
    }
  }

  private emitEvent(eventType: string, subjectId: KernovaId, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: eventType.includes('failed') ? 'warn' : 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'webhook',
      actorId: 'webhook-router',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'webhook-router', environment: 'runtime' },
    });
  }
}
