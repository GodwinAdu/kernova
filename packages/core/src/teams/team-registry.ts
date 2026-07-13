/**
 * Team Registry — Manages team definitions and lookups.
 *
 * Stores all registered teams and provides query methods.
 */

import type { TeamConfig, TeamId, TeamMember } from './types.js';

export class TeamRegistry {
  private teams: Map<TeamId, TeamConfig> = new Map();

  /** Register a team */
  register(config: TeamConfig): void {
    // Validate
    if (!config.id) throw new Error('Team config must have an id');
    if (!config.name) throw new Error('Team config must have a name');
    if (!config.members || config.members.length === 0) {
      throw new Error('Team must have at least one member');
    }

    // Validate strategy-specific requirements
    if (config.strategy === 'hierarchical') {
      const hasLead = config.members.some(m => m.role === 'lead');
      if (!hasLead && !config.lead) {
        throw new Error('Hierarchical teams require a lead (set role: "lead" on a member)');
      }
    }

    this.teams.set(config.id, config);
  }

  /** Get a team by ID */
  get(teamId: TeamId): TeamConfig | undefined {
    return this.teams.get(teamId);
  }

  /** Get a team by name */
  getByName(name: string): TeamConfig | undefined {
    for (const team of this.teams.values()) {
      if (team.name === name) return team;
    }
    return undefined;
  }

  /** List all teams */
  list(): TeamConfig[] {
    return Array.from(this.teams.values());
  }

  /** Find teams that include a specific agent */
  findByAgent(agentName: string): TeamConfig[] {
    return Array.from(this.teams.values()).filter(
      team => team.members.some(m => m.agent === agentName),
    );
  }

  /** Remove a team */
  unregister(teamId: TeamId): boolean {
    return this.teams.delete(teamId);
  }

  /** Check if a team exists */
  has(teamId: TeamId): boolean {
    return this.teams.has(teamId);
  }

  /** Get team members */
  getMembers(teamId: TeamId): TeamMember[] {
    return this.teams.get(teamId)?.members ?? [];
  }

  /** Get the lead of a team */
  getLead(teamId: TeamId): TeamMember | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    return team.members.find(m => m.role === 'lead');
  }

  /** Get total registered teams count */
  get size(): number {
    return this.teams.size;
  }

  /** Clear all teams */
  clear(): void {
    this.teams.clear();
  }
}
