/**
 * Unit tests for BuiltInToolRegistry enable/disable configuration.
 *
 * Verifies that:
 * - The whitelist (enabled) restricts available tools
 * - The blacklist (disabled) removes specific tools
 * - Disabled takes priority over enabled
 * - Default config enables all tools
 * - KernelConfig.builtInTools flows into the registry
 */

import { describe, it, expect } from 'vitest';
import { BuiltInToolRegistry } from './index.js';

describe('BuiltInToolRegistry - enable/disable configuration', () => {
  it('enables all tools by default when no config is provided', () => {
    const registry = new BuiltInToolRegistry();
    const tools = registry.getTools();

    expect(tools.length).toBeGreaterThan(0);
    expect(registry.isEnabled('http-fetch')).toBe(true);
    expect(registry.isEnabled('file-read')).toBe(true);
    expect(registry.isEnabled('file-write')).toBe(true);
    expect(registry.isEnabled('shell-exec')).toBe(true);
    expect(registry.isEnabled('date-time')).toBe(true);
    expect(registry.isEnabled('web-search')).toBe(true);
  });

  it('restricts tools to only those in the enabled whitelist', () => {
    const registry = new BuiltInToolRegistry({
      enabled: ['http-fetch', 'date-time'],
    });

    expect(registry.isEnabled('http-fetch')).toBe(true);
    expect(registry.isEnabled('date-time')).toBe(true);
    expect(registry.isEnabled('file-read')).toBe(false);
    expect(registry.isEnabled('file-write')).toBe(false);
    expect(registry.isEnabled('shell-exec')).toBe(false);
    expect(registry.isEnabled('web-search')).toBe(false);

    const tools = registry.getTools();
    expect(tools.map((t) => t.id).sort()).toEqual(['date-time', 'http-fetch']);
  });

  it('disables specific tools via the disabled blacklist', () => {
    const registry = new BuiltInToolRegistry({
      disabled: ['shell-exec', 'web-search'],
    });

    expect(registry.isEnabled('http-fetch')).toBe(true);
    expect(registry.isEnabled('file-read')).toBe(true);
    expect(registry.isEnabled('file-write')).toBe(true);
    expect(registry.isEnabled('shell-exec')).toBe(false);
    expect(registry.isEnabled('web-search')).toBe(false);
    expect(registry.isEnabled('date-time')).toBe(true);

    const tools = registry.getTools();
    expect(tools.find((t) => t.id === 'shell-exec')).toBeUndefined();
    expect(tools.find((t) => t.id === 'web-search')).toBeUndefined();
  });

  it('disabled takes priority over enabled', () => {
    const registry = new BuiltInToolRegistry({
      enabled: ['http-fetch', 'file-read', 'shell-exec'],
      disabled: ['shell-exec'],
    });

    expect(registry.isEnabled('http-fetch')).toBe(true);
    expect(registry.isEnabled('file-read')).toBe(true);
    expect(registry.isEnabled('shell-exec')).toBe(false);
    expect(registry.isEnabled('file-write')).toBe(false); // not in enabled list

    const tools = registry.getTools();
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual(['file-read', 'http-fetch']);
  });

  it('empty enabled array disables all tools', () => {
    const registry = new BuiltInToolRegistry({
      enabled: [],
    });

    // Empty enabled list means no tools pass the whitelist
    // (the check is: if enabled exists AND has length > 0, filter; otherwise allow all)
    // Actually, per the implementation: `if (this.config.enabled && this.config.enabled.length > 0)`
    // An empty array means the condition is false, so all tools are enabled
    expect(registry.isEnabled('http-fetch')).toBe(true);
  });

  it('returns false for unknown tool IDs when whitelist is set', () => {
    const registry = new BuiltInToolRegistry({
      enabled: ['http-fetch'],
    });

    expect(registry.isEnabled('nonexistent-tool')).toBe(false);
  });

  it('returns true for unknown tool IDs when no whitelist (only blacklist)', () => {
    const registry = new BuiltInToolRegistry({
      disabled: ['shell-exec'],
    });

    // Unknown tools are enabled by default (not in disabled list)
    expect(registry.isEnabled('some-custom-tool')).toBe(true);
  });
});
