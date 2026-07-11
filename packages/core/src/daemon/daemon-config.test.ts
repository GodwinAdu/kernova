/**
 * DaemonRunner Config Loading Tests
 *
 * Tests that the DaemonRunner correctly:
 * - Loads config files from a file path or directory
 * - Registers agents with the kernel's agent registry
 * - Handles config file errors gracefully (skip and log, don't crash)
 * - Registers schedules and triggers from config
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KernovaKernel } from '../kernel.js';
import { DaemonRunner } from './index.js';

describe('DaemonRunner config loading', () => {
  let kernel: KernovaKernel;
  let tmpDir: string;

  beforeEach(async () => {
    kernel = new KernovaKernel({
      environment: 'development',
      ephemeral: true,
    });
    await kernel.start();

    // Create a temp directory for config files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernova-daemon-test-'));
  });

  afterEach(async () => {
    await kernel.stop();

    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load a single agent config file and register agent with kernel', async () => {
    const configFile = path.join(tmpDir, 'test.agent.yaml');
    fs.writeFileSync(configFile, `
name: test-agent
instructions: You are a test agent.
description: A test agent for unit tests.
tools:
  - http-fetch
  - date-time
`);

    const daemon = new DaemonRunner(kernel, { configPath: configFile });

    // Start (and immediately stop to prevent hanging)
    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    // Verify agent was registered with the kernel
    const agents = kernel.agentRegistry.list();
    const testAgent = agents.find((a) => a.name === 'test-agent');
    expect(testAgent).toBeDefined();
    expect(testAgent!.instructions).toBe('You are a test agent.');
    expect(testAgent!.description).toBe('A test agent for unit tests.');
    expect(testAgent!.tools).toHaveLength(2);
    expect(testAgent!.tools[0].toolId).toBe('http-fetch');
    expect(testAgent!.tools[1].toolId).toBe('date-time');
  });

  it('should load all agent configs from a directory', async () => {
    // Create multiple config files
    fs.writeFileSync(path.join(tmpDir, 'agent-one.agent.yaml'), `
name: agent-one
instructions: First agent.
`);
    fs.writeFileSync(path.join(tmpDir, 'agent-two.agent.yml'), `
name: agent-two
instructions: Second agent.
`);
    fs.writeFileSync(path.join(tmpDir, 'agent-three.agent.json'), JSON.stringify({
      name: 'agent-three',
      instructions: 'Third agent.',
    }));
    // Non-agent file should be ignored
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'Not an agent config.');

    const daemon = new DaemonRunner(kernel, { configPath: tmpDir });

    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    const agents = kernel.agentRegistry.list();
    const names = agents.map((a) => a.name);
    expect(names).toContain('agent-one');
    expect(names).toContain('agent-two');
    expect(names).toContain('agent-three');
  });

  it('should skip invalid config files and not crash', async () => {
    // Valid config
    fs.writeFileSync(path.join(tmpDir, 'good.agent.yaml'), `
name: good-agent
instructions: I am valid.
`);
    // Invalid config — missing required field 'instructions'
    fs.writeFileSync(path.join(tmpDir, 'bad.agent.yaml'), `
name: bad-agent
`);

    const daemon = new DaemonRunner(kernel, { configPath: tmpDir });

    // Should not throw
    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    // Only the valid agent should be registered
    const agents = kernel.agentRegistry.list();
    const names = agents.map((a) => a.name);
    expect(names).toContain('good-agent');
    expect(names).not.toContain('bad-agent');
  });

  it('should register schedules from config with the scheduler', async () => {
    fs.writeFileSync(path.join(tmpDir, 'scheduled.agent.yaml'), `
name: scheduled-agent
instructions: I run on a schedule.
schedules:
  - name: hourly-check
    cron: "0 * * * *"
    goal: "Check for updates"
`);

    const daemon = new DaemonRunner(kernel, { configPath: tmpDir });

    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    // Verify the agent was registered
    const agents = kernel.agentRegistry.list();
    expect(agents.find((a) => a.name === 'scheduled-agent')).toBeDefined();

    // Verify the schedule was registered
    const jobs = kernel.scheduler.list();
    const scheduledJob = jobs.find((j) => j.name === 'scheduled-agent:hourly-check');
    expect(scheduledJob).toBeDefined();
    expect(scheduledJob!.cronExpression).toBe('0 * * * *');
  });

  it('should register triggers from config with the trigger engine', async () => {
    fs.writeFileSync(path.join(tmpDir, 'triggered.agent.yaml'), `
name: triggered-agent
instructions: I respond to events.
triggers:
  - name: on-message
    event: "channel.message.*"
    goal: "Process incoming message"
`);

    const daemon = new DaemonRunner(kernel, { configPath: tmpDir });

    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    // Verify the agent was registered
    const agents = kernel.agentRegistry.list();
    expect(agents.find((a) => a.name === 'triggered-agent')).toBeDefined();

    // Verify the trigger was registered
    const rules = kernel.triggers.list();
    const triggerRule = rules.find((r) => r.name === 'triggered-agent:on-message');
    expect(triggerRule).toBeDefined();
    expect(triggerRule!.eventPattern).toBe('channel.message.*');
  });

  it('should not load configs when configPath is not set', async () => {
    const daemon = new DaemonRunner(kernel, {});

    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    // No agents registered (besides any pre-existing ones)
    expect(kernel.agentRegistry.list()).toHaveLength(0);
  });

  it('should track loaded configs via getLoadedConfigs()', async () => {
    fs.writeFileSync(path.join(tmpDir, 'tracked.agent.yaml'), `
name: tracked-agent
instructions: I am tracked.
`);

    const daemon = new DaemonRunner(kernel, { configPath: tmpDir });

    const startPromise = daemon.start();

    const loadedConfigs = daemon.getLoadedConfigs();
    expect(loadedConfigs.size).toBe(1);

    const [filePath, config] = [...loadedConfigs.entries()][0];
    expect(filePath).toContain('tracked.agent.yaml');
    expect(config.name).toBe('tracked-agent');

    await daemon.stop();
    await startPromise;
  });

  it('should handle non-existent configPath gracefully', async () => {
    const daemon = new DaemonRunner(kernel, {
      configPath: path.join(tmpDir, 'does-not-exist'),
    });

    // Should not throw
    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    expect(kernel.agentRegistry.list()).toHaveLength(0);
  });

  it('should use agent name as stable ID for re-registration on hot-reload', async () => {
    fs.writeFileSync(path.join(tmpDir, 'stable.agent.yaml'), `
name: stable-agent
instructions: Version 1.
`);

    const daemon = new DaemonRunner(kernel, { configPath: tmpDir });

    const startPromise = daemon.start();
    await daemon.stop();
    await startPromise;

    const agents = kernel.agentRegistry.list();
    const agent = agents.find((a) => a.name === 'stable-agent');
    expect(agent).toBeDefined();
    expect(agent!.id).toBe('config-agent-stable-agent');
  });
});
