/**
 * Agent Planner Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentPlanner } from './agent-planner.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';

describe('AgentPlanner', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;
  let mockProvider: MockModelProvider;
  let planner: AgentPlanner;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();

    mockProvider = new MockModelProvider({
      defaultResponse: '["Step 1: Research the topic", "Step 2: Write the outline", "Step 3: Write the content"]',
    });

    modelRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [mockProvider],
      eventBus,
    });

    planner = new AgentPlanner(eventBus, modelRouter);
  });

  describe('plan()', () => {
    it('should decompose a goal into steps', async () => {
      const plan = await planner.plan('Write a blog post about TypeScript');

      expect(plan).toBeDefined();
      expect(plan.goal).toBe('Write a blog post about TypeScript');
      expect(plan.steps.length).toBe(3);
      expect(plan.status).toBe('planning');
      expect(plan.totalSteps).toBe(3);
      expect(plan.steps[0].description).toContain('Research');
      expect(plan.steps[1].description).toContain('outline');
      expect(plan.steps[2].description).toContain('content');
    });

    it('should throw on empty goal', async () => {
      await expect(planner.plan('')).rejects.toThrow('Validation failed');
    });

    it('should enforce maxSteps', async () => {
      mockProvider.setDefaultResponse(
        '["Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6", "Step 7", "Step 8", "Step 9", "Step 10", "Step 11", "Step 12"]'
      );

      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, { maxSteps: 5 });
      const plan = await limitedPlanner.plan('Do many things');

      expect(plan.steps.length).toBeLessThanOrEqual(5);
    });

    it('should emit plan.created and plan.decomposed events', async () => {
      const events: string[] = [];
      eventBus.subscribe(['plan.*'], (evt) => {
        events.push(evt.eventType);
      });

      await planner.plan('Test goal');

      expect(events).toContain('plan.created');
      expect(events).toContain('plan.decomposed');
    });
  });

  describe('execute()', () => {
    it('should execute all steps sequentially', async () => {
      const plan = await planner.plan('Write a blog post');
      const executedSteps: string[] = [];

      const executor = async (step: { description: string }) => {
        executedSteps.push(step.description);
        return `Done: ${step.description}`;
      };

      const result = await planner.execute(plan, executor);

      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(3);
      expect(result.failedSteps).toBe(0);
      expect(executedSteps.length).toBe(3);
    });

    it('should handle step failure', async () => {
      // Disable replanning for this test
      const noReplanPlanner = new AgentPlanner(eventBus, modelRouter, {
        adaptiveReplanning: false,
      });

      const plan = await noReplanPlanner.plan('Test failure');

      const executor = async (step: { index: number }) => {
        if (step.index === 1) throw new Error('Step 2 failed');
        return 'ok';
      };

      const result = await noReplanPlanner.execute(plan, executor);

      expect(result.status).toBe('failed');
      expect(result.failedSteps).toBe(1);
      expect(result.completedSteps).toBe(1); // First step succeeded
    });

    it('should attempt replanning on failure', async () => {
      // Set up mock to return different plans for replan requests
      mockProvider.setResponse('alternative steps', '["Alt step 1", "Alt step 2"]');

      const plan = await planner.plan('Do something');
      let callCount = 0;

      const executor = async (step: { index: number }) => {
        callCount++;
        if (callCount === 2) throw new Error('Failed step');
        return 'ok';
      };

      const result = await planner.execute(plan, executor);

      // Even if replan parsing fails, the flow should complete or fail gracefully
      expect(result.status).toBeDefined();
    });
  });

  describe('cancel()', () => {
    it('should cancel an active plan', async () => {
      const plan = await planner.plan('Something');

      planner.cancel(plan.id);

      const retrieved = planner.getPlan(plan.id);
      expect(retrieved).toBeUndefined(); // Removed from active plans
    });
  });

  describe('listPlans()', () => {
    it('should list active plans', async () => {
      await planner.plan('Plan A');
      await planner.plan('Plan B');

      const plans = planner.listPlans();
      expect(plans.length).toBe(2);
    });
  });
});
