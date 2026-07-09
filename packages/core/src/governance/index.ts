/**
 * Nexus Governance System
 * 
 * Pillar 7: Governance — "Who is accountable?"
 * 
 * Budget management, rate limiting, cost control, and policy enforcement.
 */

export { BudgetManager } from './budget-manager.js';
export type {
  BudgetConfig,
  IdentityBudget,
  UsageRecord,
  BudgetCheckResult,
} from './budget-manager.js';
