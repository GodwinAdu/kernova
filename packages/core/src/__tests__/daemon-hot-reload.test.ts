/**
 * Tests for DaemonRunner hot-reload functionality (Task 8.6)
 *
 * Covers:
 * - File change triggers agent re-registration
 * - Parse errors during hot-reload keep old agent active
 * - File deletion unregisters the agent
 * - New file created in watched directory registers a new agent
 * - Debouncing of rapid file change events
 * - Watchers cleaned up on daemon stop
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DaemonRunner } from '../daemon/index.js';
import type { KernovaKernel } from '../kernel.js';
import type { NexusEvent } from '@kernova/types';

/**
 * Create a minimal mock KernovaKernel for testing the DaemonRunner.
 */
function createMockKernel() {
  const events: NexusEvent[] = [];
  const registeredAgents = new Map<string, any>();

  const mockKernel = {
    events: {
      publish(event: NexusEvent) {
        events.push(event);
      },
      subscribe: vi.fn(),
    },
    agentRegistry: {
      register: vi.fn((definition: any, executor: any) => {
        registeredAgents.set(definition.id, { definition, executor });
      }),
      unregister: vi.fn((definitionId: string) => {
        const had = registeredAgents.has(definitionId);
        registeredAgents.delete(definitionId);
        return had;
      }),
      count: () => registeredAgents.size,
      list: () => Array.from(registeredAgents.values()).map((a: any) => a.definition),
    },
    scheduler: {
      register: vi.fn(),
    },
    triggers: {
      register: vi.fn(),
    },
    getStatus: vi.fn().mockReturnValue({
      running: true,
      activeIntents: 0,
      registeredAgents: registeredAgents.size,
      environment: 'test',
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  return {
    kernel: mockKernel as unknown as KernovaKernel,
    events,
    registeredAgents,
    mocks: mockKernel,
  };
}

/**
 * Create a temp directory with an agent config file for testing.
 */
function createTestConfigDir(configs?: Record<string, string>) {
  const dirPath = path.join(tmpdir(), `kernova-hot-reload-test-${randomUUID()}`);
  mkdirSync(dirPath, { recursive: true });

  if (configs) {
    for (const [filename, content] of Object.entries(configs)) {
      writeFileSync(path.join(dirPath, filename), content, 'utf-8');
    }
  }

  const cleanup = () => {
    rmSync(dirPath, { recursive: true, force: true });
  };

  return { dirPath, cleanup };
}

const VALID_AGENT_YAML = `
name: test-agent
instructions: |
  You are a helpful test agent.
model: gpt-4o
tools:
  - http-fetch
`;

const VALID_AGENT_YAML_V2 = `
name: test-agent
instructions: |
  You are an updated helpful test agent with new instructions.
model: gpt-4o-mini
tools:
  - http-fetch
  - file-read
`;

const VALID_AGENT_YAML_RENAMED = `
name: renamed-agent
instructions: |
  You are a renamed agent.
`;

const INVALID_AGENT_YAML = `
name: 
  - this is not valid
instructions: !!!broken
`;

describe('DaemonRunner Hot-Reload', () => {
  let testDir: { dirPath: string; cleanup: () => void };
  let daemon: DaemonRunner;
  let mockData: ReturnType<typeof createMockKernel>;

  beforeEach(() => {
    testDir = createTestConfigDir({
      'my-agent.agent.yaml': VALID_AGENT_YAML,
    });
    mockData = createMockKernel();
  });

  afterEach(async () => {
    if (daemon?.isRunning()) {
      await daemon.stop();
    }
    testDir.cleanup();
  });

  it('should load initial config and register the agent on start', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999, // prevent heartbeat noise
    });

    // Start but don't await (it resolves only on stop)
    const startPromise = daemon.start();
    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50));

    expect(mockData.mocks.agentRegistry.register).toHaveBeenCalled();
    expect(mockData.registeredAgents.has('config-agent-test-agent')).toBe(true);

    await daemon.stop();
    await startPromise;
  });

  it('should re-register agent when config file is modified', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    // Modify the config file
    writeFileSync(
      path.join(testDir.dirPath, 'my-agent.agent.yaml'),
      VALID_AGENT_YAML_V2,
      'utf-8',
    );

    // Wait for debounce + processing (100ms debounce + buffer)
    await new Promise((r) => setTimeout(r, 300));

    // Agent should be re-registered (register called more than once)
    expect(mockData.mocks.agentRegistry.register.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The latest registration should reflect the updated config
    const agent = mockData.registeredAgents.get('config-agent-test-agent');
    expect(agent).toBeDefined();

    await daemon.stop();
    await startPromise;
  });

  it('should keep old agent definition active on parse error during hot-reload', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    const initialRegisterCount = mockData.mocks.agentRegistry.register.mock.calls.length;

    // Write invalid YAML to the file
    writeFileSync(
      path.join(testDir.dirPath, 'my-agent.agent.yaml'),
      INVALID_AGENT_YAML,
      'utf-8',
    );

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 300));

    // Agent should still be registered (not unregistered)
    expect(mockData.registeredAgents.has('config-agent-test-agent')).toBe(true);

    // Register should NOT have been called again (error case skips registration)
    expect(mockData.mocks.agentRegistry.register.mock.calls.length).toBe(initialRegisterCount);

    // unregister should NOT have been called
    expect(mockData.mocks.agentRegistry.unregister).not.toHaveBeenCalled();

    // Should emit a config error event
    const errorEvent = mockData.events.find((e) => e.eventType === 'daemon.config.error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.data?.keepingOld).toBe(true);

    await daemon.stop();
    await startPromise;
  });

  it('should unregister agent when config file is deleted', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockData.registeredAgents.has('config-agent-test-agent')).toBe(true);

    // Delete the config file
    unlinkSync(path.join(testDir.dirPath, 'my-agent.agent.yaml'));

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 300));

    // Agent should be unregistered
    expect(mockData.mocks.agentRegistry.unregister).toHaveBeenCalledWith('config-agent-test-agent');

    // Should emit an unregistered event
    const unregEvent = mockData.events.find((e) => e.eventType === 'daemon.agent.unregistered');
    expect(unregEvent).toBeDefined();
    expect(unregEvent?.data?.reason).toBe('file_deleted');

    await daemon.stop();
    await startPromise;
  });

  it('should register new agent when a new config file is created in watched directory', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    // Create a new config file in the directory
    const newAgentYaml = `
name: new-agent
instructions: |
  I'm a new agent added after daemon started.
`;
    writeFileSync(
      path.join(testDir.dirPath, 'new-agent.agent.yaml'),
      newAgentYaml,
      'utf-8',
    );

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 300));

    // New agent should be registered
    expect(mockData.registeredAgents.has('config-agent-new-agent')).toBe(true);

    await daemon.stop();
    await startPromise;
  });

  it('should debounce rapid file change events', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    const registerCountBefore = mockData.mocks.agentRegistry.register.mock.calls.length;

    // Rapidly write to the file multiple times
    const filePath = path.join(testDir.dirPath, 'my-agent.agent.yaml');
    for (let i = 0; i < 5; i++) {
      writeFileSync(filePath, VALID_AGENT_YAML_V2, 'utf-8');
      await new Promise((r) => setTimeout(r, 20)); // 20ms between writes
    }

    // Wait for debounce to settle (100ms after last write + buffer)
    await new Promise((r) => setTimeout(r, 300));

    // Should only have registered once more (debounced), not 5 times
    const registerCountAfter = mockData.mocks.agentRegistry.register.mock.calls.length;
    // Allow 1-2 registrations (debounce may catch edge cases)
    expect(registerCountAfter - registerCountBefore).toBeLessThanOrEqual(2);

    await daemon.stop();
    await startPromise;
  });

  it('should clean up watchers on daemon stop', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    await daemon.stop();
    await startPromise;

    const registerCountAtStop = mockData.mocks.agentRegistry.register.mock.calls.length;

    // Write to the file after stopping — should NOT trigger a reload
    writeFileSync(
      path.join(testDir.dirPath, 'my-agent.agent.yaml'),
      VALID_AGENT_YAML_V2,
      'utf-8',
    );

    await new Promise((r) => setTimeout(r, 300));

    // No new registrations should have occurred
    expect(mockData.mocks.agentRegistry.register.mock.calls.length).toBe(registerCountAtStop);
  });

  it('should unregister old agent when config name changes', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: true,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockData.registeredAgents.has('config-agent-test-agent')).toBe(true);

    // Change the agent name in the config file
    writeFileSync(
      path.join(testDir.dirPath, 'my-agent.agent.yaml'),
      VALID_AGENT_YAML_RENAMED,
      'utf-8',
    );

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 300));

    // Old agent should be unregistered
    expect(mockData.mocks.agentRegistry.unregister).toHaveBeenCalledWith('config-agent-test-agent');

    // New agent should be registered
    expect(mockData.registeredAgents.has('config-agent-renamed-agent')).toBe(true);

    await daemon.stop();
    await startPromise;
  });

  it('should not start watching when watch is false', async () => {
    daemon = new DaemonRunner(mockData.kernel, {
      configPath: testDir.dirPath,
      watch: false,
      heartbeatIntervalMs: 999999,
    });

    const startPromise = daemon.start();
    await new Promise((r) => setTimeout(r, 50));

    const registerCount = mockData.mocks.agentRegistry.register.mock.calls.length;

    // Modify the config file
    writeFileSync(
      path.join(testDir.dirPath, 'my-agent.agent.yaml'),
      VALID_AGENT_YAML_V2,
      'utf-8',
    );

    await new Promise((r) => setTimeout(r, 300));

    // Should NOT have re-registered
    expect(mockData.mocks.agentRegistry.register.mock.calls.length).toBe(registerCount);

    // No watch.started event
    const watchEvent = mockData.events.find((e) => e.eventType === 'daemon.watch.started');
    expect(watchEvent).toBeUndefined();

    await daemon.stop();
    await startPromise;
  });
});
