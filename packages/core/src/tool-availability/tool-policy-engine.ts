/**
 * Kernova Tool Policy Engine
 *
 * Multi-layer allow/deny policy pipeline for tools.
 * Each layer can restrict or permit tools. Layers are applied
 * in order — later layers can only further restrict.
 *
 * Inspired by OpenClaw's 8-layer tool-policy-pipeline.
 */

import type { ToolPolicy, ToolPolicyLayer } from '@kernova/types';

export class ToolPolicyEngine {
  /**
   * Apply a policy pipeline to a list of tool names.
   * Returns the filtered set of allowed tools.
   */
  apply(tools: string[], layers: ToolPolicyLayer[]): string[] {
    let filtered = tools;
    for (const layer of layers) {
      filtered = this.applyLayer(filtered, layer.policy);
    }
    return filtered;
  }

  /**
   * Check if a specific tool is allowed by a policy pipeline.
   */
  isAllowed(toolName: string, layers: ToolPolicyLayer[]): boolean {
    const result = this.apply([toolName], layers);
    return result.includes(toolName);
  }

  /**
   * Check a tool that has several names (e.g. "shell-exec" and its registered ID).
   * In each layer the tool is denied if any name matches `deny`, and must have
   * some name that matches `allow` when an allow list is given.
   */
  isToolAllowed(names: string[], layers: ToolPolicyLayer[]): boolean {
    return layers.every(({ policy }) => {
      if (policy.deny?.length && names.some(n => this.matchesAny(n, policy.deny!))) return false;
      if (policy.allow?.length && !names.some(n => this.matchesAny(n, policy.allow!))) return false;
      return true;
    });
  }

  /**
   * Apply a single policy layer.
   */
  private applyLayer(tools: string[], policy: ToolPolicy): string[] {
    let result = tools;

    // Deny list takes precedence: remove denied tools
    if (policy.deny && policy.deny.length > 0) {
      result = result.filter(t => !this.matchesAny(t, policy.deny!));
    }

    // Allow list: if specified, only keep allowed tools
    if (policy.allow && policy.allow.length > 0) {
      result = result.filter(t => this.matchesAny(t, policy.allow!));
    }

    return result;
  }

  /**
   * Check if a tool name matches any pattern in a list.
   * Supports exact match and glob patterns (* wildcard).
   */
  private matchesAny(toolName: string, patterns: string[]): boolean {
    return patterns.some(p => this.matchPattern(toolName, p));
  }

  private matchPattern(name: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return name === pattern;

    // Convert glob to regex
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return regex.test(name);
  }
}
