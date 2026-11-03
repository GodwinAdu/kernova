/**
 * Kernova Plugin Marketplace
 *
 * Registry for discovering, installing, and managing plugins:
 * - Browse available plugins from a registry
 * - Install plugins by name/version
 * - Track installed plugins and versions
 * - Uninstall plugins cleanly
 * - Update plugins to latest versions
 *
 * Inspired by OpenClaw's ClawhHub plugin management.
 */

import type { KernovaId, KernovaEvent } from '@kernova/types';
import type { EventBus } from '../events/event-bus.js';
import { generateId, now } from '../utils.js';

export interface PluginListing {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  keywords: string[];
  repository?: string;
  installedVersion?: string;
  installed: boolean;
}

export interface MarketplaceConfig {
  /** Registry URL for plugin discovery */
  registryUrl?: string;
  /** Local directory for installed plugins */
  pluginsDir?: string;
}

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  installedAt: string;
  path?: string;
}

export class PluginMarketplace {
  private readonly eventBus: EventBus;
  private readonly config: MarketplaceConfig;
  private installed: Map<string, InstalledPlugin> = new Map();
  private registry: PluginListing[] = [];

  constructor(eventBus: EventBus, config?: MarketplaceConfig) {
    this.eventBus = eventBus;
    this.config = config ?? {};
  }

  /**
   * Search the plugin registry.
   */
  async search(query?: string): Promise<PluginListing[]> {
    // In a real implementation, this would fetch from registryUrl
    // For now, return the local registry with installed status
    let results = [...this.registry];
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.keywords.some(k => k.toLowerCase().includes(q))
      );
    }
    return results.map(p => ({
      ...p,
      installed: this.installed.has(p.id),
      installedVersion: this.installed.get(p.id)?.version,
    }));
  }

  /**
   * Install a plugin by ID.
   */
  async install(pluginId: string, version?: string): Promise<InstalledPlugin> {
    const listing = this.registry.find(p => p.id === pluginId);
    const resolvedVersion = version ?? listing?.version ?? '0.0.0';

    const plugin: InstalledPlugin = {
      id: pluginId,
      name: listing?.name ?? pluginId,
      version: resolvedVersion,
      installedAt: now(),
    };

    this.installed.set(pluginId, plugin);

    this.emitEvent('marketplace.installed', pluginId, {
      name: plugin.name,
      version: resolvedVersion,
    });

    return plugin;
  }

  /**
   * Uninstall a plugin.
   */
  async uninstall(pluginId: string): Promise<boolean> {
    const existed = this.installed.delete(pluginId);
    if (existed) {
      this.emitEvent('marketplace.uninstalled', pluginId, { id: pluginId });
    }
    return existed;
  }

  /**
   * Update a plugin to a specific or latest version.
   */
  async update(pluginId: string, version?: string): Promise<InstalledPlugin | null> {
    const current = this.installed.get(pluginId);
    if (!current) return null;

    const listing = this.registry.find(p => p.id === pluginId);
    const newVersion = version ?? listing?.version ?? current.version;

    current.version = newVersion;
    current.installedAt = now();

    this.emitEvent('marketplace.updated', pluginId, {
      name: current.name,
      oldVersion: current.version,
      newVersion,
    });

    return current;
  }

  /**
   * List installed plugins.
   */
  listInstalled(): InstalledPlugin[] {
    return Array.from(this.installed.values());
  }

  /**
   * Check if a plugin is installed.
   */
  isInstalled(pluginId: string): boolean {
    return this.installed.has(pluginId);
  }

  /**
   * Add a plugin listing to the local registry (for testing/development).
   */
  addToRegistry(listing: PluginListing): void {
    this.registry.push(listing);
  }

  private emitEvent(eventType: string, subjectId: string, data: Record<string, unknown>): void {
    this.eventBus.publish({
      id: generateId('evt'),
      eventType,
      category: 'system',
      severity: 'info',
      timestamp: now(),
      subjectId,
      subjectType: 'marketplace',
      actorId: 'plugin-marketplace',
      correlationId: subjectId,
      data,
      metadata: { schemaVersion: '1.0.0', source: 'plugin-marketplace', environment: 'runtime' },
    });
  }
}
