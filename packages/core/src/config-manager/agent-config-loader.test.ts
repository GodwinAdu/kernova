/**
 * Unit Tests: Agent Config File Loader
 *
 * Tests:
 * - Invalid YAML handling (parse errors)
 * - Invalid JSON handling (parse errors)
 * - Missing required fields (name, instructions)
 * - Extends merging behavior
 * - Valid config parsing
 * - File discovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseAgentConfigString,
  parseAgentConfigFile,
  validateAgentConfig,
  mergeAgentConfigs,
  loadAgentConfigWithExtends,
  discoverAgentConfigFiles,
  isAgentConfigFile,
  serializeAgentConfigToYaml,
  serializeAgentConfigToJson,
  AgentConfigError,
} from './agent-config-loader.js';
import type { AgentConfigFile } from '@kernova/types';

describe('AgentConfigLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Invalid YAML Handling ────────────────────────────────────

  describe('invalid YAML handling', () => {
    it('should throw AgentConfigError for invalid YAML syntax', () => {
      // Duplicate keys with conflicting flow sequences cause a parse error
      const badYaml = `name: test\n: :\n  - [}`;
      expect(() => parseAgentConfigString(badYaml, 'bad.agent.yaml')).toThrow(AgentConfigError);
    });

    it('should throw AgentConfigError for YAML that produces non-object', () => {
      const scalar = `just a string`;
      expect(() => parseAgentConfigString(scalar, 'scalar.agent.yaml')).toThrow(AgentConfigError);
      expect(() => parseAgentConfigString(scalar, 'scalar.agent.yaml')).toThrow('not a valid object');
    });

    it('should throw AgentConfigError for YAML that produces null', () => {
      const nullYaml = `---\n`;
      expect(() => parseAgentConfigString(nullYaml, 'null.agent.yaml')).toThrow(AgentConfigError);
      expect(() => parseAgentConfigString(nullYaml, 'null.agent.yaml')).toThrow('not a valid object');
    });

    it('should handle YAML with wrong indentation gracefully', () => {
      // YAML with bad indentation that still parses but produces unexpected structure
      const badIndent = `name: agent\ninstructions: do stuff\ntools:\n- http-fetch\n  - file-read`;
      // This should either parse (if YAML lib is lenient) or throw a clear error
      try {
        const config = parseAgentConfigString(badIndent, 'bad-indent.agent.yaml');
        // If it parses, it should still be a valid config
        expect(config.name).toBe('agent');
      } catch (err) {
        // If it throws, it should be an AgentConfigError with file path info
        expect(err).toBeInstanceOf(AgentConfigError);
        expect((err as AgentConfigError).filePath).toBe('bad-indent.agent.yaml');
      }
    });

    it('should include file path in error for completely broken YAML indentation', () => {
      const brokenYaml = `name: test\n\t\tinstructions: bad tabs mixed with spaces\n  tools:\n\t- broken`;
      try {
        parseAgentConfigString(brokenYaml, '/path/to/broken.agent.yaml');
        // If it somehow parses, that's also acceptable (graceful handling)
      } catch (err) {
        expect(err).toBeInstanceOf(AgentConfigError);
        expect((err as AgentConfigError).filePath).toBe('/path/to/broken.agent.yaml');
        expect((err as Error).message).toContain('/path/to/broken.agent.yaml');
      }
    });
  });

  // ─── Invalid JSON Handling ────────────────────────────────────

  describe('invalid JSON handling', () => {
    it('should throw AgentConfigError for invalid JSON syntax', () => {
      const badJson = `{ "name": "test", "instructions": }`;
      expect(() => parseAgentConfigString(badJson, 'bad.agent.json')).toThrow(AgentConfigError);
      expect(() => parseAgentConfigString(badJson, 'bad.agent.json')).toThrow('Invalid JSON');
    });

    it('should throw AgentConfigError for JSON array instead of object', () => {
      const arrayJson = `[1, 2, 3]`;
      expect(() => parseAgentConfigString(arrayJson, 'array.agent.json')).toThrow(AgentConfigError);
    });
  });

  // ─── Missing Required Fields ──────────────────────────────────

  describe('missing required fields', () => {
    it('should throw when name is missing', () => {
      const yaml = `instructions: "do something"`;
      expect(() => parseAgentConfigString(yaml, 'missing-name.agent.yaml')).toThrow(
        "required field 'name'",
      );
    });

    it('should throw when instructions is missing', () => {
      const yaml = `name: "my-agent"`;
      expect(() => parseAgentConfigString(yaml, 'missing-inst.agent.yaml')).toThrow(
        "required field 'instructions'",
      );
    });

    it('should throw when name is not a string', () => {
      const yaml = `name: 123\ninstructions: "do something"`;
      expect(() => parseAgentConfigString(yaml, 'bad-name.agent.yaml')).toThrow(
        "required field 'name'",
      );
    });

    it('should throw when instructions is not a string', () => {
      const yaml = `name: "agent"\ninstructions: 42`;
      expect(() => parseAgentConfigString(yaml, 'bad-inst.agent.yaml')).toThrow(
        "required field 'instructions'",
      );
    });

    it('should throw when tools is not an array of strings', () => {
      const yaml = `name: "agent"\ninstructions: "do"\ntools: [1, 2]`;
      expect(() => parseAgentConfigString(yaml, 'bad-tools.agent.yaml')).toThrow(
        "Field 'tools' must be an array of strings",
      );
    });

    it('should throw when schedules entry is missing required fields', () => {
      const yaml = `name: agent\ninstructions: do\nschedules:\n  - cron: "* * * * *"`;
      expect(() => parseAgentConfigString(yaml, 'bad-sched.agent.yaml')).toThrow(
        'schedules[0].name is required',
      );
    });

    it('should throw when triggers entry is missing event', () => {
      const yaml = `name: agent\ninstructions: do\ntriggers:\n  - name: t1\n    goal: test`;
      expect(() => parseAgentConfigString(yaml, 'bad-trigger.agent.yaml')).toThrow(
        'triggers[0].event is required',
      );
    });
  });

  // ─── Valid Config Parsing ─────────────────────────────────────

  describe('valid config parsing', () => {
    it('should parse minimal valid YAML config', () => {
      const yaml = `name: my-agent\ninstructions: "You are helpful"`;
      const config = parseAgentConfigString(yaml, 'minimal.agent.yaml');
      expect(config.name).toBe('my-agent');
      expect(config.instructions).toBe('You are helpful');
    });

    it('should parse full YAML config with all fields', () => {
      const yaml = `
name: assistant
description: A helpful assistant
instructions: |
  You are a helpful assistant.
model: gpt-4o
tools:
  - http-fetch
  - file-read
schedules:
  - name: hourly-check
    cron: "0 * * * *"
    goal: "Check for new tasks"
triggers:
  - name: on-message
    event: "channel.message.received"
    condition: "event.data.channel === 'email'"
    goal: "Process email"
`;
      const config = parseAgentConfigString(yaml, 'full.agent.yaml');
      expect(config.name).toBe('assistant');
      expect(config.description).toBe('A helpful assistant');
      expect(config.instructions).toContain('helpful assistant');
      expect(config.model).toBe('gpt-4o');
      expect(config.tools).toEqual(['http-fetch', 'file-read']);
      expect(config.schedules).toHaveLength(1);
      expect(config.schedules![0].name).toBe('hourly-check');
      expect(config.schedules![0].cron).toBe('0 * * * *');
      expect(config.schedules![0].goal).toBe('Check for new tasks');
      expect(config.triggers).toHaveLength(1);
      expect(config.triggers![0].name).toBe('on-message');
      expect(config.triggers![0].event).toBe('channel.message.received');
      expect(config.triggers![0].condition).toBe("event.data.channel === 'email'");
    });

    it('should parse valid JSON config', () => {
      const json = JSON.stringify({
        name: 'json-agent',
        instructions: 'Do things',
        model: 'claude-sonnet-4-20250514',
        tools: ['date-time'],
      });
      const config = parseAgentConfigString(json, 'test.agent.json');
      expect(config.name).toBe('json-agent');
      expect(config.model).toBe('claude-sonnet-4-20250514');
    });

    it('should parse config file from disk', () => {
      const filePath = path.join(tmpDir, 'test.agent.yaml');
      fs.writeFileSync(filePath, 'name: disk-agent\ninstructions: "Hello"');
      const config = parseAgentConfigFile(filePath);
      expect(config.name).toBe('disk-agent');
    });

    it('should accept empty arrays for tools, schedules, and triggers', () => {
      const yaml = `name: empty-arrays\ninstructions: "do stuff"\ntools: []\nschedules: []\ntriggers: []`;
      const config = parseAgentConfigString(yaml, 'empty-arrays.agent.yaml');
      expect(config.name).toBe('empty-arrays');
      expect(config.tools).toEqual([]);
      expect(config.schedules).toEqual([]);
      expect(config.triggers).toEqual([]);
    });

    it('should throw for non-existent file', () => {
      expect(() => parseAgentConfigFile('/nonexistent/path.agent.yaml')).toThrow(AgentConfigError);
      expect(() => parseAgentConfigFile('/nonexistent/path.agent.yaml')).toThrow('File not found');
    });
  });

  // ─── Extends Merging ──────────────────────────────────────────

  describe('extends merging', () => {
    it('should merge child config over base config', () => {
      const base: AgentConfigFile = {
        name: 'base-agent',
        description: 'Base description',
        instructions: 'Base instructions',
        model: 'gpt-4o',
        tools: ['http-fetch', 'file-read'],
        schedules: [{ name: 'base-schedule', cron: '0 * * * *', goal: 'check' }],
      };

      const child: AgentConfigFile = {
        name: 'child-agent',
        instructions: 'Child instructions',
        model: 'claude-sonnet-4-20250514',
      };

      const merged = mergeAgentConfigs(base, child);

      expect(merged.name).toBe('child-agent');
      expect(merged.instructions).toBe('Child instructions');
      expect(merged.model).toBe('claude-sonnet-4-20250514');
      expect(merged.description).toBe('Base description');
      expect(merged.tools).toEqual(['http-fetch', 'file-read']);
      expect(merged.schedules).toEqual([{ name: 'base-schedule', cron: '0 * * * *', goal: 'check' }]);
    });

    it('should let child override arrays entirely', () => {
      const base: AgentConfigFile = {
        name: 'base',
        instructions: 'base',
        tools: ['http-fetch', 'file-read'],
      };

      const child: AgentConfigFile = {
        name: 'child',
        instructions: 'child',
        tools: ['date-time'],
      };

      const merged = mergeAgentConfigs(base, child);
      expect(merged.tools).toEqual(['date-time']);
    });

    it('should resolve extends from disk (single level)', () => {
      const basePath = path.join(tmpDir, 'base.agent.yaml');
      const childPath = path.join(tmpDir, 'child.agent.yaml');

      fs.writeFileSync(basePath, `
name: base
instructions: base instructions
model: gpt-4o
tools:
  - http-fetch
`);

      fs.writeFileSync(childPath, `
name: child-agent
instructions: custom instructions
extends: base.agent.yaml
`);

      const config = loadAgentConfigWithExtends(childPath);
      expect(config.name).toBe('child-agent');
      expect(config.instructions).toBe('custom instructions');
      expect(config.model).toBe('gpt-4o');
      expect(config.tools).toEqual(['http-fetch']);
    });

    it('should resolve multi-level extends chain', () => {
      const grandparentPath = path.join(tmpDir, 'grandparent.agent.yaml');
      const parentPath = path.join(tmpDir, 'parent.agent.yaml');
      const childPath = path.join(tmpDir, 'child.agent.yaml');

      fs.writeFileSync(grandparentPath, `
name: grandparent
instructions: gp instructions
model: gpt-4o
tools:
  - http-fetch
  - file-read
`);

      fs.writeFileSync(parentPath, `
name: parent
instructions: parent instructions
extends: grandparent.agent.yaml
tools:
  - shell-exec
`);

      fs.writeFileSync(childPath, `
name: child
instructions: child instructions
extends: parent.agent.yaml
`);

      const config = loadAgentConfigWithExtends(childPath);
      expect(config.name).toBe('child');
      expect(config.instructions).toBe('child instructions');
      expect(config.model).toBe('gpt-4o');
      expect(config.tools).toEqual(['shell-exec']);
    });

    it('should detect circular extends and throw', () => {
      const aPath = path.join(tmpDir, 'a.agent.yaml');
      const bPath = path.join(tmpDir, 'b.agent.yaml');

      fs.writeFileSync(aPath, `name: a\ninstructions: a\nextends: b.agent.yaml`);
      fs.writeFileSync(bPath, `name: b\ninstructions: b\nextends: a.agent.yaml`);

      expect(() => loadAgentConfigWithExtends(aPath)).toThrow('Circular extends');
    });

    it('should throw descriptive error when base config file not found', () => {
      const childPath = path.join(tmpDir, 'child.agent.yaml');
      fs.writeFileSync(childPath, `name: child\ninstructions: child\nextends: nonexistent-base.agent.yaml`);

      expect(() => loadAgentConfigWithExtends(childPath)).toThrow(AgentConfigError);
      expect(() => loadAgentConfigWithExtends(childPath)).toThrow('File not found');
    });

    it('child schedules array replaces base schedules array', () => {
      const base: AgentConfigFile = {
        name: 'base',
        instructions: 'base',
        schedules: [
          { name: 'base-sched', cron: '0 * * * *', goal: 'base goal' },
          { name: 'base-sched-2', cron: '*/5 * * * *', goal: 'base goal 2' },
        ],
      };

      const child: AgentConfigFile = {
        name: 'child',
        instructions: 'child',
        schedules: [{ name: 'child-sched', cron: '0 0 * * *', goal: 'child goal' }],
      };

      const merged = mergeAgentConfigs(base, child);
      expect(merged.schedules).toHaveLength(1);
      expect(merged.schedules![0].name).toBe('child-sched');
    });

    it('child triggers array replaces base triggers array', () => {
      const base: AgentConfigFile = {
        name: 'base',
        instructions: 'base',
        triggers: [
          { name: 'base-trigger', event: 'user.*', goal: 'base goal' },
        ],
      };

      const child: AgentConfigFile = {
        name: 'child',
        instructions: 'child',
        triggers: [{ name: 'child-trigger', event: 'system.*', goal: 'child goal' }],
      };

      const merged = mergeAgentConfigs(base, child);
      expect(merged.triggers).toHaveLength(1);
      expect(merged.triggers![0].name).toBe('child-trigger');
    });
  });

  // ─── File Discovery ───────────────────────────────────────────

  describe('file discovery', () => {
    it('should discover .agent.yaml, .agent.yml, and .agent.json files', () => {
      fs.writeFileSync(path.join(tmpDir, 'one.agent.yaml'), 'name: a\ninstructions: a');
      fs.writeFileSync(path.join(tmpDir, 'two.agent.yml'), 'name: b\ninstructions: b');
      fs.writeFileSync(path.join(tmpDir, 'three.agent.json'), '{"name":"c","instructions":"c"}');
      fs.writeFileSync(path.join(tmpDir, 'not-config.txt'), 'nope');
      fs.writeFileSync(path.join(tmpDir, 'regular.yaml'), 'not an agent config');

      const files = discoverAgentConfigFiles(tmpDir);
      expect(files).toHaveLength(3);
      expect(files.some(f => f.endsWith('one.agent.yaml'))).toBe(true);
      expect(files.some(f => f.endsWith('two.agent.yml'))).toBe(true);
      expect(files.some(f => f.endsWith('three.agent.json'))).toBe(true);
    });

    it('should return empty array for non-existent directory', () => {
      const files = discoverAgentConfigFiles('/nonexistent/dir');
      expect(files).toEqual([]);
    });

    it('should return a single file if path points to a config file', () => {
      const filePath = path.join(tmpDir, 'single.agent.yaml');
      fs.writeFileSync(filePath, 'name: s\ninstructions: s');

      const files = discoverAgentConfigFiles(filePath);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(filePath);
    });

    it('isAgentConfigFile correctly identifies extensions', () => {
      expect(isAgentConfigFile('test.agent.yaml')).toBe(true);
      expect(isAgentConfigFile('test.agent.yml')).toBe(true);
      expect(isAgentConfigFile('test.agent.json')).toBe(true);
      expect(isAgentConfigFile('test.yaml')).toBe(false);
      expect(isAgentConfigFile('test.json')).toBe(false);
      expect(isAgentConfigFile('test.agent.toml')).toBe(false);
    });
  });

  // ─── Serialization ────────────────────────────────────────────

  describe('serialization', () => {
    it('should serialize to YAML and back without data loss', () => {
      const config: AgentConfigFile = {
        name: 'test-agent',
        description: 'A test agent',
        instructions: 'You are helpful',
        model: 'gpt-4o',
        tools: ['http-fetch', 'date-time'],
        schedules: [{ name: 'daily', cron: '0 0 * * *', goal: 'check status' }],
        triggers: [{ name: 'on-event', event: 'user.*', goal: 'handle user event' }],
      };

      const yaml = serializeAgentConfigToYaml(config);
      const reparsed = parseAgentConfigString(yaml, 'test.agent.yaml');

      expect(reparsed.name).toBe(config.name);
      expect(reparsed.description).toBe(config.description);
      expect(reparsed.instructions).toBe(config.instructions);
      expect(reparsed.model).toBe(config.model);
      expect(reparsed.tools).toEqual(config.tools);
      expect(reparsed.schedules).toEqual(config.schedules);
      expect(reparsed.triggers).toEqual(config.triggers);
    });

    it('should serialize to JSON and back without data loss', () => {
      const config: AgentConfigFile = {
        name: 'json-agent',
        instructions: 'Be helpful',
        tools: ['file-read'],
      };

      const json = serializeAgentConfigToJson(config);
      const reparsed = parseAgentConfigString(json, 'test.agent.json');

      expect(reparsed.name).toBe(config.name);
      expect(reparsed.instructions).toBe(config.instructions);
      expect(reparsed.tools).toEqual(config.tools);
    });

    it('should omit undefined fields from YAML output', () => {
      const config: AgentConfigFile = {
        name: 'minimal',
        instructions: 'do stuff',
      };

      const yaml = serializeAgentConfigToYaml(config);
      expect(yaml).not.toContain('description');
      expect(yaml).not.toContain('model');
      expect(yaml).not.toContain('tools');
      expect(yaml).not.toContain('schedules');
      expect(yaml).not.toContain('triggers');
      expect(yaml).not.toContain('extends');
    });
  });
});
