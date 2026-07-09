/**
 * Workflow helper — shorthand for defining workflows.
 * 
 * Usage:
 *   import { workflow } from '@nexus/sdk';
 *   
 *   const reviewFlow = workflow('code-review', [
 *     { id: 'analyze', name: 'Analyze', type: 'agent', config: { agentId: 'reviewer' } },
 *     { id: 'approve', name: 'Approve', type: 'approval', config: { approvers: ['lead'] } },
 *   ]);
 */

import type { WorkflowDefinition, WorkflowStep } from '@nexus/types';
import { generateId, now } from '@nexus/core';

export function workflow(name: string, steps: WorkflowStep[]): WorkflowDefinition {
  return {
    id: generateId('wf_def'),
    type: 'workflow_definition',
    version: '1.0.0',
    owner: 'system',
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    metadata: {},
    name,
    description: `Workflow: ${name}`,
    steps,
  };
}
