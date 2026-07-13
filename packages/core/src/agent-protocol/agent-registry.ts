/**
 * Agent Registry — Discovery service for finding remote agents.
 *
 * Agents register themselves here. Other agents query the registry
 * to find agents by capability, tag, or organization.
 *
 * Can be:
 * - Local (in-memory, for development)
 * - Remote (Kernova Cloud registry, for production)
 */

import type {
  AgentCard,
  AgentRegistryEntry,
  DiscoveryOptions,
} from './types.js';

export interface AgentRegistryConfig {
  /** Remote registry URL (Kernova Cloud) */
  registryUrl?: string;
  /** API key for the registry */
  registryKey?: string;
  /** Cache TTL in ms */
  cacheTtl?: number;
}

export class AgentRegistry {
  private config: AgentRegistryConfig;
  private localEntries: Map<string, AgentRegistryEntry> = new Map();
  private cache: Map<string, { data: AgentRegistryEntry[]; expiresAt: number }> = new Map();

  constructor(config?: AgentRegistryConfig) {
    this.config = config || {};
  }

  /**
   * Register an agent in the registry (makes it discoverable)
   */
  async register(card: AgentCard): Promise<void> {
    const entry: AgentRegistryEntry = {
      card,
      registeredAt: new Date().toISOString(),
      online: true,
      trustScore: 0.5, // Start at neutral
      interactions: 0,
    };

    // Register locally
    this.localEntries.set(card.agent.id, entry);

    // Register remotely (if configured)
    if (this.config.registryUrl) {
      try {
        await fetch(`${this.config.registryUrl}/v1/agents/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.registryKey}`,
          },
          body: JSON.stringify({ card }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        // Remote registration failed — continue with local only
      }
    }
  }

  /**
   * Unregister an agent
   */
  async unregister(agentId: string): Promise<void> {
    this.localEntries.delete(agentId);

    if (this.config.registryUrl) {
      try {
        await fetch(`${this.config.registryUrl}/v1/agents/${agentId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${this.config.registryKey}` },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Best effort
      }
    }
  }

  /**
   * Discover agents matching criteria
   */
  async discover(options?: DiscoveryOptions): Promise<AgentRegistryEntry[]> {
    // Check cache
    const cacheKey = JSON.stringify(options || {});
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    let results: AgentRegistryEntry[] = [];

    // Query remote registry first (if configured)
    if (this.config.registryUrl) {
      try {
        const params = new URLSearchParams();
        if (options?.tags) params.set('tags', options.tags.join(','));
        if (options?.capability) params.set('capability', options.capability);
        if (options?.organization) params.set('org', options.organization);
        if (options?.query) params.set('q', options.query);
        if (options?.onlineOnly) params.set('online', 'true');
        if (options?.limit) params.set('limit', String(options.limit));

        const res = await fetch(
          `${this.config.registryUrl}/v1/agents/discover?${params.toString()}`,
          {
            headers: { 'Authorization': `Bearer ${this.config.registryKey}` },
            signal: AbortSignal.timeout(10000),
          },
        );

        if (res.ok) {
          const data = await res.json() as { agents?: AgentRegistryEntry[] };
          results = data.agents || [];
        }
      } catch {
        // Remote query failed — fall through to local
      }
    }

    // Also search local entries
    const localResults = this.searchLocal(options);
    results = [...results, ...localResults];

    // Deduplicate by agent ID
    const seen = new Set<string>();
    results = results.filter(entry => {
      if (seen.has(entry.card.agent.id)) return false;
      seen.add(entry.card.agent.id);
      return true;
    });

    // Apply limit
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    // Cache results
    this.cache.set(cacheKey, {
      data: results,
      expiresAt: Date.now() + (this.config.cacheTtl || 300000), // 5 min default
    });

    return results;
  }

  /**
   * Get a specific agent by ID
   */
  async get(agentId: string): Promise<AgentRegistryEntry | undefined> {
    // Check local first
    const local = this.localEntries.get(agentId);
    if (local) return local;

    // Check remote
    if (this.config.registryUrl) {
      try {
        const res = await fetch(
          `${this.config.registryUrl}/v1/agents/${agentId}`,
          {
            headers: { 'Authorization': `Bearer ${this.config.registryKey}` },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (res.ok) return await res.json() as AgentRegistryEntry;
      } catch {
        // Not found remotely
      }
    }

    return undefined;
  }

  /**
   * List all known agents
   */
  listLocal(): AgentRegistryEntry[] {
    return Array.from(this.localEntries.values());
  }

  /**
   * Update trust score after an interaction
   */
  recordInteraction(agentId: string, success: boolean): void {
    const entry = this.localEntries.get(agentId);
    if (!entry) return;

    entry.interactions++;
    // Simple moving average for trust score
    const factor = 1 / Math.min(entry.interactions, 100);
    entry.trustScore = entry.trustScore * (1 - factor) + (success ? 1 : 0) * factor;
  }

  /** Clear cache */
  clearCache(): void {
    this.cache.clear();
  }

  // ─── Private ───────────────────────────────────────────────────

  private searchLocal(options?: DiscoveryOptions): AgentRegistryEntry[] {
    let results = Array.from(this.localEntries.values());

    if (!options) return results;

    if (options.tags && options.tags.length > 0) {
      results = results.filter(entry =>
        options.tags!.some(tag => entry.card.agent.tags?.includes(tag)),
      );
    }

    if (options.capability) {
      results = results.filter(entry =>
        entry.card.capabilities.some(c => c.id === options.capability),
      );
    }

    if (options.organization) {
      results = results.filter(entry =>
        entry.card.agent.organization.toLowerCase() === options.organization!.toLowerCase(),
      );
    }

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(entry =>
        entry.card.agent.name.toLowerCase().includes(q) ||
        entry.card.agent.description.toLowerCase().includes(q),
      );
    }

    if (options.onlineOnly) {
      results = results.filter(entry => entry.online);
    }

    if (options.minTrustScore) {
      results = results.filter(entry => entry.trustScore >= options.minTrustScore!);
    }

    return results;
  }
}
