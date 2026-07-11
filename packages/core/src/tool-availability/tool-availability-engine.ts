/**
 * Kernova Tool Availability Engine
 *
 * Evaluates tool descriptors against runtime context to
 * determine which tools are visible vs hidden.
 * Uses a declarative DSL with allOf/anyOf boolean expressions.
 *
 * Inspired by OpenClaw's tools/availability.ts system.
 */

import type {
  ToolDescriptor,
  ToolAvailabilityExpression,
  ToolAvailabilitySignal,
  ToolAvailabilityContext,
  ToolAvailabilityDiagnostic,
  ToolPlan,
} from '@kernova/types';

export class ToolAvailabilityEngine {
  /**
   * Build a tool plan: evaluate all descriptors against context.
   * Returns visible tools and hidden tools with diagnostics.
   */
  buildPlan(
    descriptors: ToolDescriptor[],
    context: ToolAvailabilityContext = {},
  ): ToolPlan {
    const visible: ToolDescriptor[] = [];
    const hidden: Array<{
      descriptor: ToolDescriptor;
      diagnostics: ToolAvailabilityDiagnostic[];
    }> = [];

    for (const descriptor of descriptors) {
      const diagnostics = this.evaluate(descriptor, context);
      if (diagnostics.length === 0) {
        visible.push(descriptor);
      } else {
        hidden.push({ descriptor, diagnostics });
      }
    }

    return { visible, hidden };
  }

  /**
   * Evaluate a single tool descriptor against context.
   * Returns empty array if available, diagnostics array if not.
   */
  evaluate(
    descriptor: ToolDescriptor,
    context: ToolAvailabilityContext = {},
  ): ToolAvailabilityDiagnostic[] {
    const availability = descriptor.availability;
    if (!availability) return []; // No availability constraint = always visible

    return this.evaluateExpression(descriptor.name, availability, context);
  }

  /**
   * Check if a specific tool is available in the given context.
   */
  isAvailable(descriptor: ToolDescriptor, context: ToolAvailabilityContext = {}): boolean {
    return this.evaluate(descriptor, context).length === 0;
  }

  // ─── Private ───────────────────────────────────────────────

  private evaluateExpression(
    toolName: string,
    expr: ToolAvailabilityExpression,
    ctx: ToolAvailabilityContext,
  ): ToolAvailabilityDiagnostic[] {
    if ('kind' in expr) {
      return this.evaluateSignal(toolName, expr, ctx);
    }
    if ('allOf' in expr) {
      // All must pass — collect all diagnostics
      const diagnostics: ToolAvailabilityDiagnostic[] = [];
      for (const sub of expr.allOf) {
        diagnostics.push(...this.evaluateExpression(toolName, sub, ctx));
      }
      return diagnostics;
    }
    if ('anyOf' in expr) {
      // At least one must pass
      const allDiagnostics: ToolAvailabilityDiagnostic[][] = [];
      for (const sub of expr.anyOf) {
        const d = this.evaluateExpression(toolName, sub, ctx);
        if (d.length === 0) return []; // One passed
        allDiagnostics.push(d);
      }
      // None passed — return all diagnostics
      return allDiagnostics.flat();
    }
    return [];
  }

  private evaluateSignal(
    toolName: string,
    signal: ToolAvailabilitySignal,
    ctx: ToolAvailabilityContext,
  ): ToolAvailabilityDiagnostic[] {
    switch (signal.kind) {
      case 'always':
        return [];

      case 'auth':
        if (ctx.authProviders?.has(signal.providerId)) return [];
        return [{ tool: toolName, reason: 'auth-missing', message: `Missing auth provider: ${signal.providerId}` }];

      case 'config': {
        const value = this.resolveConfigPath(ctx.config, signal.path);
        if (value === undefined || value === null) {
          return [{ tool: toolName, reason: 'config-missing', message: `Missing config: ${signal.path.join('.')}` }];
        }
        if (signal.check === 'non-empty') {
          if (typeof value === 'string' && value.trim().length === 0) {
            return [{ tool: toolName, reason: 'config-missing', message: `Empty config: ${signal.path.join('.')}` }];
          }
        }
        return [];
      }

      case 'env':
        if (ctx.env?.[signal.name]?.trim()) return [];
        return [{ tool: toolName, reason: 'env-missing', message: `Missing env: ${signal.name}` }];

      case 'plugin':
        if (ctx.enabledPlugins?.has(signal.pluginId)) return [];
        return [{ tool: toolName, reason: 'plugin-disabled', message: `Plugin not enabled: ${signal.pluginId}` }];

      case 'context': {
        const value = ctx.contextValues?.[signal.key];
        if (signal.equals !== undefined) {
          if (value === signal.equals) return [];
          return [{ tool: toolName, reason: 'context-mismatch', message: `Context ${signal.key} !== ${signal.equals}` }];
        }
        if (value !== undefined) return [];
        return [{ tool: toolName, reason: 'context-mismatch', message: `Missing context: ${signal.key}` }];
      }

      default:
        return [];
    }
  }

  private resolveConfigPath(
    config: Record<string, unknown> | undefined,
    path: string[],
  ): unknown {
    if (!config) return undefined;
    let current: unknown = config;
    for (const segment of path) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }
}
