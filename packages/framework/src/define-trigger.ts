/**
 * defineTrigger — Proactive event-driven triggers.
 *
 * Triggers fire when events match a pattern, automatically submitting
 * a goal to an agent.
 *
 * Usage:
 *   // triggers/on-email.ts
 *   import { defineTrigger } from '@kernova/framework';
 *
 *   export default defineTrigger({
 *     name: 'on-email-received',
 *     description: 'Process incoming support emails',
 *     event: 'channel.message.email',
 *     agent: 'support',
 *     goal: 'Process the incoming support email and create a ticket',
 *     priority: 'high',
 *     cooldown: 5000,
 *   });
 */

export interface TriggerDefinition {
  /** Trigger name */
  name: string;
  /** Description */
  description?: string;
  /** Event pattern to match (glob: 'channel.message.*', 'intent.failed', etc.) */
  event: string;
  /** Which agent should handle it */
  agent?: string;
  /** Goal to submit when triggered */
  goal: string;
  /** Priority for the submitted intent */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** Minimum ms between trigger firings (prevent spam) */
  cooldown?: number;
  /** Only fire if event data matches these conditions */
  filter?: Record<string, unknown>;
  /** Whether this trigger is enabled */
  enabled?: boolean;
}

/**
 * Define a proactive trigger.
 */
export function defineTrigger(definition: TriggerDefinition): TriggerDefinition {
  if (!definition.name) {
    throw new Error('defineTrigger: "name" is required');
  }
  if (!definition.event) {
    throw new Error('defineTrigger: "event" pattern is required');
  }
  if (!definition.goal) {
    throw new Error('defineTrigger: "goal" is required');
  }

  return {
    priority: 'medium',
    cooldown: 1000,
    enabled: true,
    ...definition,
  };
}
