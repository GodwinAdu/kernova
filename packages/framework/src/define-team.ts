/**
 * defineTeam — Declarative multi-agent team definition.
 *
 * Teams allow multiple agents to collaborate on complex tasks.
 * Each agent has a role, specialization, and delegation permissions.
 *
 * Usage:
 *   // teams/engineering.ts
 *   import { defineTeam } from '@kernova/framework';
 *
 *   export default defineTeam({
 *     name: 'Engineering Team',
 *     description: 'Full-stack development team',
 *     strategy: 'hierarchical',
 *     members: [
 *       {
 *         agent: 'senior-dev',
 *         role: 'lead',
 *         description: 'Decomposes tasks, reviews code, makes architectural decisions',
 *         canDelegate: true,
 *         canApprove: true,
 *       },
 *       {
 *         agent: 'frontend-dev',
 *         role: 'member',
 *         description: 'Builds React components, handles CSS/styling, client-side logic',
 *         specialization: ['react', 'typescript', 'css', 'tailwind', 'ui'],
 *         canDelegate: true,
 *       },
 *       {
 *         agent: 'backend-dev',
 *         role: 'member',
 *         description: 'Builds APIs, database schemas, server-side logic',
 *         specialization: ['node', 'api', 'database', 'prisma', 'auth'],
 *         canDelegate: true,
 *       },
 *       {
 *         agent: 'tester',
 *         role: 'reviewer',
 *         description: 'Writes tests, runs QA, verifies code quality',
 *         specialization: ['testing', 'jest', 'playwright', 'qa'],
 *         canApprove: true,
 *       },
 *     ],
 *   });
 *
 * Strategies:
 *   - 'hierarchical': Lead breaks down tasks → assigns to members → reviews results
 *   - 'sequential': Tasks flow agent → agent in defined order
 *   - 'pipeline': Output of one agent feeds into the next
 *   - 'collaborative': Agents freely delegate to each other (lead coordinates)
 *   - 'round-robin': Tasks distributed evenly across members
 *   - 'broadcast': All agents work on same task, best result wins
 */

export type DelegationStrategy =
  | 'sequential'
  | 'hierarchical'
  | 'collaborative'
  | 'round-robin'
  | 'broadcast'
  | 'pipeline';

export interface TeamMemberDefinition {
  /** Agent name (must match a defineAgent file name) */
  agent: string;
  /** Role within the team */
  role: 'lead' | 'member' | 'reviewer' | 'specialist';
  /** Human-readable description of what this member does */
  description?: string;
  /** What kind of tasks this member handles (for smart routing) */
  specialization?: string[];
  /** Can this agent delegate to others? (default: false for members) */
  canDelegate?: boolean;
  /** Can this agent approve other agents' work? (default: false) */
  canApprove?: boolean;
  /** Maximum concurrent tasks for this member */
  maxConcurrentTasks?: number;
}

export interface TeamDefinition {
  /** Team name */
  name: string;
  /** Description of the team's purpose */
  description?: string;
  /** How tasks are distributed among members */
  strategy: DelegationStrategy;
  /** Team members */
  members: TeamMemberDefinition[];
  /** Maximum delegation depth (default: 5, prevents infinite loops) */
  maxDelegationDepth?: number;
  /** Timeout for the entire team task in ms (default: 300000 = 5 min) */
  taskTimeout?: number;
  /** Whether the lead must approve before returning final output (default: true for hierarchical) */
  requireLeadApproval?: boolean;
  /** Maximum retries per task (default: 2) */
  maxRetries?: number;
  /** Shared workspace configuration */
  workspace?: {
    /** Whether workspace persists across tasks (default: false) */
    persistent?: boolean;
    /** Maximum entries in workspace (default: 500) */
    maxEntries?: number;
  };
}

/**
 * Define a team of agents that collaborate on tasks.
 *
 * @example
 * ```typescript
 * // teams/dev-team.ts
 * import { defineTeam } from '@kernova/framework';
 *
 * export default defineTeam({
 *   name: 'Dev Team',
 *   strategy: 'hierarchical',
 *   members: [
 *     { agent: 'architect', role: 'lead', description: 'System design & code review' },
 *     { agent: 'developer', role: 'member', specialization: ['typescript', 'react'] },
 *     { agent: 'qa', role: 'reviewer', specialization: ['testing'] },
 *   ],
 * });
 * ```
 */
export function defineTeam(definition: TeamDefinition): TeamDefinition {
  // Validation
  if (!definition.name) {
    throw new Error('defineTeam: "name" is required');
  }
  if (!definition.strategy) {
    throw new Error('defineTeam: "strategy" is required');
  }
  if (!definition.members || definition.members.length < 2) {
    throw new Error('defineTeam: at least 2 members are required (otherwise just use defineAgent)');
  }

  // Validate hierarchical teams have a lead
  if (definition.strategy === 'hierarchical') {
    const hasLead = definition.members.some(m => m.role === 'lead');
    if (!hasLead) {
      throw new Error(
        'defineTeam: hierarchical strategy requires at least one member with role: "lead"',
      );
    }
  }

  // Validate agent names are unique
  const names = definition.members.map(m => m.agent);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  if (duplicates.length > 0) {
    throw new Error(`defineTeam: duplicate agent names: ${duplicates.join(', ')}`);
  }

  // Apply defaults
  return {
    maxDelegationDepth: 5,
    taskTimeout: 300000,
    maxRetries: 2,
    requireLeadApproval: definition.strategy === 'hierarchical',
    workspace: {
      persistent: false,
      maxEntries: 500,
      ...definition.workspace,
    },
    ...definition,
    members: definition.members.map(m => ({
      canDelegate: m.role === 'lead' || m.role === 'reviewer',
      canApprove: m.role === 'lead' || m.role === 'reviewer',
      maxConcurrentTasks: 3,
      ...m,
    })),
  };
}
