/**
 * Property-Based Test: Agent Config File Round-Trip (Property 11)
 *
 * Validates: Requirements 8.1, 8.2
 *
 * For all valid agent config files, parse(serialize(parse(config))) ≡ parse(config)
 * — round-trip fidelity through YAML and JSON serialization.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  parseAgentConfigString,
  serializeAgentConfigToYaml,
  serializeAgentConfigToJson,
  validateAgentConfig,
} from './agent-config-loader.js';
import type { AgentConfigFile } from '@kernova/types';

/**
 * Arbitrary generator for valid AgentConfigSchedule objects.
 */
const scheduleArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  cron: fc.option(fc.constantFrom('* * * * *', '0 * * * *', '30 8 * * 1-5', '0 0 1 * *'), { nil: undefined }),
  delayMs: fc.option(fc.integer({ min: 100, max: 86400000 }), { nil: undefined }),
  goal: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
});

/**
 * Arbitrary generator for valid AgentConfigTrigger objects.
 */
const triggerArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  event: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  condition: fc.option(fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0), { nil: undefined }),
  goal: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
});

/**
 * Arbitrary generator for valid AgentConfigFile objects.
 * Only generates configs with printable, YAML-safe content.
 */
const agentConfigArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 64 }).filter(s => s.trim().length > 0 && !s.includes('\x00')),
  description: fc.option(fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0 && !s.includes('\x00')), { nil: undefined }),
  instructions: fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0 && !s.includes('\x00')),
  model: fc.option(fc.constantFrom('gpt-4o', 'claude-sonnet-4-20250514', 'gemini-pro', 'llama-3'), { nil: undefined }),
  tools: fc.option(fc.array(fc.constantFrom('http-fetch', 'file-read', 'file-write', 'shell-exec', 'date-time', 'web-search'), { minLength: 1, maxLength: 4 }), { nil: undefined }),
  schedules: fc.option(fc.array(scheduleArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
  triggers: fc.option(fc.array(triggerArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
}) as fc.Arbitrary<AgentConfigFile>;

/**
 * Normalize an AgentConfigFile for comparison.
 * Removes undefined fields and normalizes empty arrays.
 */
function normalize(config: AgentConfigFile): AgentConfigFile {
  const result: AgentConfigFile = {
    name: config.name,
    instructions: config.instructions,
  };

  if (config.description !== undefined) result.description = config.description;
  if (config.model !== undefined) result.model = config.model;
  if (config.tools !== undefined && config.tools.length > 0) result.tools = config.tools;
  if (config.schedules !== undefined && config.schedules.length > 0) {
    result.schedules = config.schedules.map(s => {
      const norm: Record<string, unknown> = { name: s.name, goal: s.goal };
      if (s.cron !== undefined) norm.cron = s.cron;
      if (s.delayMs !== undefined) norm.delayMs = s.delayMs;
      return norm as unknown as typeof s;
    });
  }
  if (config.triggers !== undefined && config.triggers.length > 0) {
    result.triggers = config.triggers.map(t => {
      const norm: Record<string, unknown> = { name: t.name, event: t.event, goal: t.goal };
      if (t.condition !== undefined) norm.condition = t.condition;
      return norm as unknown as typeof t;
    });
  }

  return result;
}

describe('Property 11: Agent Config File Round-Trip', () => {
  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * Property: parse(serialize(parse(config))) ≡ parse(config) via YAML
   */
  it('YAML round-trip: parse(serialize(parse(config))) ≡ parse(config)', () => {
    fc.assert(
      fc.property(agentConfigArb, (config) => {
        // First parse: our input is already a valid config object
        const original = normalize(config);

        // Serialize to YAML
        const yaml = serializeAgentConfigToYaml(original);

        // Parse the YAML back
        const reparsed = parseAgentConfigString(yaml, 'test.agent.yaml');

        // Normalize both for comparison
        const normalizedReparsed = normalize(reparsed);

        expect(normalizedReparsed).toEqual(original);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * Property: parse(serialize(parse(config))) ≡ parse(config) via JSON
   */
  it('JSON round-trip: parse(serialize(parse(config))) ≡ parse(config)', () => {
    fc.assert(
      fc.property(agentConfigArb, (config) => {
        // First parse: our input is already a valid config object
        const original = normalize(config);

        // Serialize to JSON
        const json = serializeAgentConfigToJson(original);

        // Parse the JSON back
        const reparsed = parseAgentConfigString(json, 'test.agent.json');

        // Normalize both for comparison
        const normalizedReparsed = normalize(reparsed);

        expect(normalizedReparsed).toEqual(original);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * Property: serialization is idempotent — serialize(parse(serialize(config))) ≡ serialize(config)
   */
  it('serialization idempotency: YAML serialization is stable', () => {
    fc.assert(
      fc.property(agentConfigArb, (config) => {
        const original = normalize(config);

        // First serialize
        const yaml1 = serializeAgentConfigToYaml(original);

        // Parse and serialize again
        const reparsed = parseAgentConfigString(yaml1, 'test.agent.yaml');
        const yaml2 = serializeAgentConfigToYaml(normalize(reparsed));

        expect(yaml2).toEqual(yaml1);
      }),
      { numRuns: 200 },
    );
  });
});
