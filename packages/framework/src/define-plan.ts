/**
 * definePlan — Goal decomposition strategy.
 *
 * Plans let you define how complex goals get broken into steps.
 * The agent planner uses these to decompose high-level requests.
 *
 * Usage:
 *   // plans/deploy-app.ts
 *   import { definePlan } from '@kernova/framework';
 *
 *   export default definePlan({
 *     name: 'deploy-application',
 *     description: 'Deploy a web application to production',
 *     maxSteps: 10,
 *     strategy: 'sequential',
 *     steps: [
 *       { goal: 'Run tests', agent: 'tester' },
 *       { goal: 'Build the application', agent: 'builder' },
 *       { goal: 'Deploy to staging', agent: 'deployer' },
 *       { goal: 'Run smoke tests', agent: 'tester' },
 *       { goal: 'Deploy to production', agent: 'deployer', requiresApproval: true },
 *     ],
 *   });
 */

export interface PlanStep {
  /** Goal for this step */
  goal: string;
  /** Which agent handles this step */
  agent?: string;
  /** Whether this step needs human approval */
  requiresApproval?: boolean;
  /** Condition to execute (based on previous results) */
  condition?: (previousResults: Record<string, unknown>) => boolean;
}

export interface PlanDefinition {
  /** Plan name */
  name: string;
  /** Description */
  description?: string;
  /** Maximum number of steps the planner can generate */
  maxSteps?: number;
  /** Execution strategy */
  strategy?: 'sequential' | 'parallel' | 'adaptive';
  /** Pre-defined steps (if strategy is not 'adaptive') */
  steps?: PlanStep[];
  /** For adaptive strategy: let the LLM decompose dynamically */
  instructions?: string;
}

/**
 * Define a plan for goal decomposition.
 */
export function definePlan(definition: PlanDefinition): PlanDefinition {
  if (!definition.name) {
    throw new Error('definePlan: "name" is required');
  }

  return {
    maxSteps: 10,
    strategy: 'sequential',
    ...definition,
  };
}
