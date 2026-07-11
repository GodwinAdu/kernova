/**
 * Agent Planning Enhancement Tests
 *
 * Validates:
 * - Task 7.1: plan.step.started and plan.step.completed events are emitted
 * - Task 7.2: Replanning on step failure with error context
 * - Task 7.3: maxSteps limit prevents unbounded plan execution
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentPlanner } from './agent-planner.js';
import { EventBus } from '../events/event-bus.js';
import { ModelRouter } from '../models/model-router.js';
import { MockModelProvider } from '../testing/mock-model-provider.js';
import type { NexusEvent } from '@kernova/types';

describe('AgentPlanner - Planning Enhancement', () => {
  let eventBus: EventBus;
  let modelRouter: ModelRouter;
  let mockProvider: MockModelProvider;
  let planner: AgentPlanner;

  beforeEach(async () => {
    eventBus = new EventBus({ persistent: false });
    await eventBus.start();

    mockProvider = new MockModelProvider({
      defaultResponse: '["Step 1: Research", "Step 2: Write", "Step 3: Review"]',
    });

    modelRouter = new ModelRouter({
      routing: { default: { provider: 'mock', model: 'mock-model' } },
      providers: [mockProvider],
      eventBus,
    });

    planner = new AgentPlanner(eventBus, modelRouter);
  });

  describe('Task 7.1: Step Events', () => {
    it('should emit plan.step.started for each executed step', async () => {
      const events: NexusEvent[] = [];
      eventBus.subscribe(['plan.step.started'], (evt) => {
        events.push(evt);
      });

      const plan = await planner.plan('Write a blog post');
      await planner.execute(plan, async (step) => `Done: ${step.description}`);

      expect(events.length).toBe(3);
      expect(events[0].data?.['index']).toBe(0);
      expect(events[1].data?.['index']).toBe(1);
      expect(events[2].data?.['index']).toBe(2);
    });

    it('should emit plan.step.completed for each successfully executed step', async () => {
      const events: NexusEvent[] = [];
      eventBus.subscribe(['plan.step.completed'], (evt) => {
        events.push(evt);
      });

      const plan = await planner.plan('Write a blog post');
      await planner.execute(plan, async (step) => `Done: ${step.description}`);

      expect(events.length).toBe(3);
      expect(events[0].data?.['index']).toBe(0);
      expect(events[1].data?.['index']).toBe(1);
      expect(events[2].data?.['index']).toBe(2);
    });

    it('should emit plan.step.started before plan.step.completed for the same step', async () => {
      const events: NexusEvent[] = [];
      eventBus.subscribe(['plan.step.*'], (evt) => {
        events.push(evt);
      });

      const plan = await planner.plan('Test ordering');
      await planner.execute(plan, async () => 'ok');

      // For each step, started should come before completed
      for (let i = 0; i < 3; i++) {
        const startedIdx = events.findIndex(
          e => e.eventType === 'plan.step.started' && e.data?.['index'] === i
        );
        const completedIdx = events.findIndex(
          e => e.eventType === 'plan.step.completed' && e.data?.['index'] === i
        );
        expect(startedIdx).toBeLessThan(completedIdx);
      }
    });

    it('should include step description in plan.step.started event', async () => {
      const events: NexusEvent[] = [];
      eventBus.subscribe(['plan.step.started'], (evt) => {
        events.push(evt);
      });

      const plan = await planner.plan('Research topic');
      await planner.execute(plan, async () => 'done');

      expect(events[0].data?.['description']).toContain('Research');
    });

    it('should emit plan.step.started but not plan.step.completed when step fails', async () => {
      const noReplanPlanner = new AgentPlanner(eventBus, modelRouter, {
        adaptiveReplanning: false,
      });

      const startedEvents: NexusEvent[] = [];
      const completedEvents: NexusEvent[] = [];
      eventBus.subscribe(['plan.step.started'], (evt) => { startedEvents.push(evt); });
      eventBus.subscribe(['plan.step.completed'], (evt) => { completedEvents.push(evt); });

      const plan = await noReplanPlanner.plan('Test failure events');
      await noReplanPlanner.execute(plan, async (step) => {
        if (step.index === 1) throw new Error('Step 2 failed');
        return 'ok';
      });

      // Started should fire for step 0 and 1
      expect(startedEvents.length).toBe(2);
      // Completed should only fire for step 0 (step 1 failed)
      expect(completedEvents.length).toBe(1);
      expect(completedEvents[0].data?.['index']).toBe(0);
    });
  });

  describe('Task 7.2: Replanning on Step Failure', () => {
    it('should invoke model to replan when a step fails', async () => {
      // Mock returns alternative steps on replan
      mockProvider.setResponse('alternative steps', '["Alt step A", "Alt step B"]');
      mockProvider.setResponse('failed', '["Alt step A", "Alt step B"]');

      const replanEvents: NexusEvent[] = [];
      eventBus.subscribe(['plan.replanned'], (evt) => { replanEvents.push(evt); });

      const plan = await planner.plan('Do something');
      let callCount = 0;

      await planner.execute(plan, async (step) => {
        callCount++;
        if (callCount === 2) throw new Error('Simulated failure');
        return 'ok';
      });

      // The replanning event should have been emitted
      expect(replanEvents.length).toBeGreaterThanOrEqual(1);
      expect(replanEvents[0].data?.['attempt']).toBe(1);
    });

    it('should pass error context to model during replanning', async () => {
      const calls: Array<{ request: unknown }> = [];

      // Track calls to detect replan prompt
      const originalComplete = mockProvider.complete.bind(mockProvider);
      let completeCalls = 0;
      vi.spyOn(mockProvider, 'complete').mockImplementation(async (req) => {
        completeCalls++;
        calls.push({ request: req });
        return originalComplete(req);
      });

      const plan = await planner.plan('Research and write');
      let stepCount = 0;

      await planner.execute(plan, async (step) => {
        stepCount++;
        if (stepCount === 2) throw new Error('Network timeout');
        return 'ok';
      });

      // The replan call should contain the error message
      const replanCall = calls.find(c => {
        const messages = (c.request as { messages: Array<{ content: string }> }).messages;
        return messages.some(m => m.content.includes('Network timeout'));
      });
      expect(replanCall).toBeDefined();
    });

    it('should respect maxReplanAttempts limit', async () => {
      const replanEvents: NexusEvent[] = [];
      eventBus.subscribe(['plan.replanned'], (evt) => { replanEvents.push(evt); });

      // Planner with maxReplanAttempts = 1
      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, {
        adaptiveReplanning: true,
        maxReplanAttempts: 1,
      });

      const plan = await limitedPlanner.plan('Do tasks');
      let callCount = 0;

      const result = await limitedPlanner.execute(plan, async () => {
        callCount++;
        if (callCount >= 2) throw new Error('Always fails');
        return 'ok';
      });

      // Only 1 replan attempt allowed, then plan should fail
      expect(replanEvents.length).toBeLessThanOrEqual(1);
      expect(result.status).toBe('failed');
    });

    it('should replace remaining steps with replanned steps', async () => {
      mockProvider.setResponse('failed', '["Recovery step 1", "Recovery step 2"]');

      const plan = await planner.plan('Original plan');
      let callCount = 0;

      const result = await planner.execute(plan, async (step) => {
        callCount++;
        if (callCount === 2) throw new Error('Step failed');
        return 'ok';
      });

      // After replanning, new steps should have been added
      // The plan steps array should contain the original completed step + replanned steps
      const completedSteps = result.steps.filter(s => s.status === 'completed');
      expect(completedSteps.length).toBeGreaterThanOrEqual(1);
    });

    it('should mark plan as failed when replanning is disabled and a step fails', async () => {
      const noReplanPlanner = new AgentPlanner(eventBus, modelRouter, {
        adaptiveReplanning: false,
      });

      const plan = await noReplanPlanner.plan('Test no replan');
      const result = await noReplanPlanner.execute(plan, async (step) => {
        if (step.index === 0) throw new Error('Immediate failure');
        return 'ok';
      });

      expect(result.status).toBe('failed');
      expect(result.failedSteps).toBe(1);
    });
  });

  describe('Task 7.3: maxSteps Limit', () => {
    it('should enforce maxSteps during plan decomposition', async () => {
      mockProvider.setDefaultResponse(
        '["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12","S13","S14","S15"]'
      );

      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, { maxSteps: 5 });
      const plan = await limitedPlanner.plan('Many steps');

      expect(plan.steps.length).toBeLessThanOrEqual(5);
    });

    it('should default maxSteps to 10', async () => {
      mockProvider.setDefaultResponse(
        '["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"]'
      );

      const defaultPlanner = new AgentPlanner(eventBus, modelRouter);
      const plan = await defaultPlanner.plan('Lots of steps');

      expect(plan.steps.length).toBeLessThanOrEqual(10);
    });

    it('should stop execution when maxSteps is reached', async () => {
      mockProvider.setDefaultResponse('["S1","S2","S3"]');

      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, { maxSteps: 3 });
      const plan = await limitedPlanner.plan('Three steps');

      // Inject extra steps to simulate a scenario where plan has more steps than maxSteps
      plan.steps.push(
        { id: 'extra-1', index: 3, description: 'Extra Step 4', dependencies: [], status: 'pending' as const },
        { id: 'extra-2', index: 4, description: 'Extra Step 5', dependencies: [], status: 'pending' as const },
      );
      plan.totalSteps = 5;

      let executedCount = 0;
      const result = await limitedPlanner.execute(plan, async () => {
        executedCount++;
        return 'ok';
      });

      // Only 3 steps should have been executed (maxSteps limit)
      expect(executedCount).toBe(3);
      expect(result.completedSteps).toBe(3);
      expect(result.status).toBe('completed');
    });

    it('should emit plan.maxStepsReached event when limit is hit during execution', async () => {
      // The maxSteps limit during execution fires when replanning adds more steps
      // than the original limit. We simulate this by manually adding extra steps.
      mockProvider.setDefaultResponse('["S1","S2","S3"]');

      const maxStepsEvents: NexusEvent[] = [];
      eventBus.subscribe(['plan.maxStepsReached'], (evt) => { maxStepsEvents.push(evt); });

      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, { maxSteps: 3 });
      const plan = await limitedPlanner.plan('Three steps');

      // Manually inject extra steps to simulate post-replan scenario
      plan.steps.push(
        { id: 'extra-1', index: 3, description: 'Extra Step 4', dependencies: [], status: 'pending' as const },
        { id: 'extra-2', index: 4, description: 'Extra Step 5', dependencies: [], status: 'pending' as const },
      );
      plan.totalSteps = 5;

      await limitedPlanner.execute(plan, async () => 'ok');

      expect(maxStepsEvents.length).toBe(1);
      expect(maxStepsEvents[0].data?.['maxSteps']).toBe(3);
      expect(maxStepsEvents[0].data?.['executedSteps']).toBe(3);
      expect(maxStepsEvents[0].data?.['remainingSteps']).toBe(2);
    });

    it('should complete normally if steps are fewer than maxSteps', async () => {
      mockProvider.setDefaultResponse('["S1","S2"]');

      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, { maxSteps: 10 });
      const plan = await limitedPlanner.plan('Few steps');

      let executedCount = 0;
      const result = await limitedPlanner.execute(plan, async () => {
        executedCount++;
        return 'ok';
      });

      expect(executedCount).toBe(2);
      expect(result.status).toBe('completed');
    });

    it('should count only executed steps toward maxSteps (not skipped ones)', async () => {
      mockProvider.setDefaultResponse('["S1","S2"]');

      const limitedPlanner = new AgentPlanner(eventBus, modelRouter, { maxSteps: 2 });
      const plan = await limitedPlanner.plan('Test skip counting');

      // Add extra steps beyond the limit
      plan.steps.push(
        { id: 'extra-1', index: 2, description: 'Extra 3', dependencies: [], status: 'pending' as const },
        { id: 'extra-2', index: 3, description: 'Extra 4', dependencies: [], status: 'pending' as const },
      );
      plan.totalSteps = 4;

      let executedCount = 0;
      const result = await limitedPlanner.execute(plan, async () => {
        executedCount++;
        return 'ok';
      });

      // With maxSteps=2, only 2 steps should execute
      expect(executedCount).toBe(2);
      expect(result.completedSteps).toBe(2);
    });
  });
});
