---
title: "Configuration"
description: Layered runtime configuration and declarative agent config files — YAML/JSON parsing, inheritance, hot-reload, and environment variable overrides.
---

Kernova's config system has two distinct subsystems that work together to configure your application at runtime and define agents declaratively.

| Subsystem | Purpose | Package |
|-----------|---------|---------|
| **ConfigManager** | Layered runtime configuration with dot-path access, env overrides, change watching | `@kernova/core` |
| **Agent Config Loader** | YAML/JSON agent definition files with inheritance, validation, discovery, hot-reload | `@kernova/core` |

---

## Overview

**Runtime configuration** (`ConfigManager`) handles your application's settings — model provider, ports, budgets, feature flags. It resolves values through a priority chain: hardcoded defaults → file config → environment variables → programmatic overrides. Any layer can be changed at runtime, and watchers fire when values change.

**Agent config files** are declarative `.agent.yaml` / `.agent.yml` / `.agent.json` files that define agents without writing TypeScript. They support `extends` inheritance, are validated on load, and can be hot-reloaded during development. The CLI's `kernova serve --watch` picks up changes automatically.

Both systems are exported from `@kernova/core`:

```typescript
import {
  ConfigManager,
  parseAgentConfigFile,
  loadAgentConfigWithExtends,
  discoverAgentConfigFiles,
  AgentConfigError,
} from '@kernova/core';
```

---

## Runtime Configuration (ConfigManager)

### Layer Priority

ConfigManager resolves values through four layers, highest priority first:

| Priority | Layer | Source | Typical Use |
|----------|-------|--------|-------------|
| 1 (highest) | `runtime` | Set programmatically via `.set()` | Feature flags, temporary overrides |
| 2 | `env` | Environment variables with `KERNOVA_` prefix | Secrets, deployment-specific values |
| 3 | `file` | Loaded from `kernova.config.json` | Project defaults, shared team settings |
| 4 (lowest) | `defaults` | Hardcoded in code | Safe fallbacks |

When you call `.get('models.default.provider')`, ConfigManager checks each layer top-to-bottom and returns the first defined value.

### Initialization

ConfigManager is created by the kernel during startup. You can also instantiate it directly:

```typescript
import { ConfigManager } from '@kernova/core';
import { EventBus } from '@kernova/core';

const eventBus = new EventBus();

const configManager = new ConfigManager(eventBus, {
  defaults: {
    models: { default: { provider: 'openai', model: 'gpt-4o' } },
    gateway: { port: 3000 },
  },
  fileConfig: loadedFromDisk, // parsed JSON object
  envPrefix: 'KERNOVA_',     // default prefix
});
```

### API Reference

#### `get<T>(path): T | undefined`

Resolve a value through all layers using dot-path notation.

```typescript
const provider = kernel.configManager.get<string>('models.default.provider');
// Returns: 'openai' (from whichever layer has it at highest priority)

const missing = kernel.configManager.get<string>('nonexistent.path');
// Returns: undefined
```

#### `getOrDefault<T>(path, defaultValue): T`

Same as `get()` but returns a fallback if no layer has the value.

```typescript
const port = kernel.configManager.getOrDefault('gateway.port', 3000);
// Returns: 3000 if no layer defines gateway.port

const debug = kernel.configManager.getOrDefault('runtime.debug', false);
```

#### `set(path, value): void`

Set a runtime override. This is the highest-priority layer — it wins over env, file, and defaults.

```typescript
kernel.configManager.set('models.default.model', 'gpt-4o-mini');

// Immediately effective
const model = kernel.configManager.get('models.default.model');
// Returns: 'gpt-4o-mini'
```

Setting a value also triggers watchers and emits a `config.changed` event.

#### `reload(fileConfig): void`

Replace the file layer entirely. Useful after detecting a config file change on disk.

```typescript
import { readFileSync } from 'node:fs';

const updated = JSON.parse(readFileSync('./kernova.config.json', 'utf-8'));
kernel.configManager.reload(updated);
// Diffs previous file config against new one and emits change events
```

After reload, a `config.reloaded` event is emitted with the number of changed paths.

#### `watch(path, callback): () => void`

Subscribe to changes for a specific config path. Returns an unsubscribe function.

```typescript
const unwatch = kernel.configManager.watch('models.default.provider', (newValue) => {
  console.log(`Provider changed to: ${newValue}`);
  // Reinitialize model client, etc.
});

// Later: stop watching
unwatch();
```

Watchers fire when:
- `set()` is called with a new value for that path
- `reload()` is called and the file layer has a different value at that path

#### `getAll(): Record<string, unknown>`

Get the fully merged configuration object (all layers combined, higher priority wins).

```typescript
const allConfig = kernel.configManager.getAll();
console.log(allConfig.models.default.provider); // resolved value
```

### Environment Variable Mapping

Environment variables are mapped to config paths using a prefix and double-underscore nesting:

| Environment Variable | Config Path |
|---------------------|-------------|
| `KERNOVA_MODELS__DEFAULT__PROVIDER` | `models.default.provider` |
| `KERNOVA_GATEWAY__PORT` | `gateway.port` |
| `KERNOVA_RUNTIME__DEBUG` | `runtime.debug` |

**Rules:**
- Prefix: `KERNOVA_` (configurable via `envPrefix` option)
- Nesting separator: `__` (double underscore) → converted to `.` in config paths
- Case: environment variable keys are lowercased after stripping the prefix
- Values: always strings (you may need to parse numbers/booleans yourself)

```bash
# Shell
export KERNOVA_MODELS__DEFAULT__PROVIDER=anthropic
export KERNOVA_MODELS__DEFAULT__MODEL=claude-sonnet-5-5
export KERNOVA_GATEWAY__PORT=8080
```

```typescript
// These resolve from the env layer:
kernel.configManager.get('models.default.provider'); // 'anthropic'
kernel.configManager.get('gateway.port');            // '8080' (string!)
```

### Merge Behavior

When `getAll()` merges layers, it uses deep merge for objects and replacement for scalars/arrays:

- **Objects** — recursively merged (keys from higher-priority layers override lower)
- **Scalars** — replaced entirely
- **Arrays** — replaced entirely (not concatenated)

```typescript
// defaults layer:
{ models: { default: { provider: 'openai', model: 'gpt-4o' } } }

// env layer:
{ models: { default: { provider: 'anthropic' } } }

// getAll() result:
{ models: { default: { provider: 'anthropic', model: 'gpt-4o' } } }
//                      ↑ from env              ↑ from defaults
```

---

## Agent Config Files

Agent config files let you define agents declaratively without writing TypeScript. They're ideal for prompt iteration, non-developer authoring, and version-controlled agent definitions.

### File Format

Agents can be defined in YAML or JSON. The schema is the same for both formats.

#### Full Schema (YAML)

```yaml
name: my-agent                    # Required — unique agent identifier
description: What this agent does # Optional — used in agent selection scoring
instructions: |                   # Required — the system prompt
  You are a helpful assistant.
  Always be concise and accurate.
model: gpt-4o                     # Optional — overrides kernel default model
tools:                            # Optional — tool IDs this agent can access
  - http-fetch
  - web-search
schedules:                        # Optional — time-based triggers
  - name: hourly-check
    cron: "0 * * * *"
    goal: "Run health check"
  - name: delayed-init
    delayMs: 5000
    goal: "Initialize cache"
triggers:                         # Optional — event-based triggers
  - name: on-error
    event: "intent.failed"
    goal: "Investigate failure"
    condition: "event.data.priority === 'critical'"
extends: ./base-agent.agent.yaml  # Optional — inherit from another config
```

#### JSON Equivalent

```json
{
  "name": "my-agent",
  "description": "What this agent does",
  "instructions": "You are a helpful assistant.\nAlways be concise and accurate.",
  "model": "gpt-4o",
  "tools": ["http-fetch", "web-search"],
  "schedules": [
    { "name": "hourly-check", "cron": "0 * * * *", "goal": "Run health check" },
    { "name": "delayed-init", "delayMs": 5000, "goal": "Initialize cache" }
  ],
  "triggers": [
    {
      "name": "on-error",
      "event": "intent.failed",
      "goal": "Investigate failure",
      "condition": "event.data.priority === 'critical'"
    }
  ],
  "extends": "./base-agent.agent.yaml"
}
```

---

## Config Inheritance (`extends`)

The `extends` field lets an agent config inherit from a base config. This is useful for sharing instructions, model choices, or tool sets across multiple agents.

### How It Works

1. The loader reads the child config file
2. If `extends` is present, it resolves the path relative to the child file's directory
3. The base config is loaded (recursively — bases can extend other bases)
4. The child is merged on top of the base

### Merge Rules

| Field | Behavior |
|-------|----------|
| `name` | Child always wins (required in child) |
| `instructions` | Child always wins (required in child) |
| `description` | Child wins if defined, otherwise base value |
| `model` | Child wins if defined, otherwise base value |
| `tools` | Child **replaces** base (not concatenated) |
| `schedules` | Child **replaces** base (not concatenated) |
| `triggers` | Child **replaces** base (not concatenated) |
| `extends` | Consumed during loading, not propagated to result |

### Example

```yaml
# agents/base.agent.yaml
name: base
instructions: |
  You are part of the Kernova system. Be helpful, accurate, and concise.
model: gpt-4o
tools:
  - http-fetch
  - date-time
```

```yaml
# agents/specialist.agent.yaml
name: specialist
extends: ./base.agent.yaml
description: A specialist agent with custom tools
instructions: |
  You are a specialist agent. Override base behavior with domain expertise.
tools:
  - web-search      # Replaces base tools entirely (http-fetch and date-time are gone)
```

Resolved result for `specialist`:
```typescript
{
  name: 'specialist',
  description: 'A specialist agent with custom tools',
  instructions: 'You are a specialist agent. Override base behavior...',
  model: 'gpt-4o',          // inherited from base
  tools: ['web-search'],     // replaced (not merged)
}
```

### Deep Chains

Inheritance can be chained: A extends B extends C.

```yaml
# base.agent.yaml
name: base
instructions: "Core system prompt."
model: gpt-4o

# mid-tier.agent.yaml
name: mid-tier
extends: ./base.agent.yaml
instructions: "Mid-tier prompt."
tools:
  - web-search

# leaf.agent.yaml
name: leaf
extends: ./mid-tier.agent.yaml
instructions: "Leaf-level prompt."
```

Resolution order: `base` → `mid-tier` → `leaf`. Each layer's defined fields override the previous.

### Circular Detection

If a chain forms a cycle (A extends B extends A), the loader throws an `AgentConfigError`:

```
[AgentConfig] /path/to/a.agent.yaml: Circular extends dependency detected
```

---

## Parsing & Serialization Functions

The agent config loader exports utility functions for working with config files programmatically.

### `parseAgentConfigFile(filePath)`

Read and parse a config file from disk. Supports `.agent.yaml`, `.agent.yml`, and `.agent.json`.

```typescript
import { parseAgentConfigFile } from '@kernova/core';

const config = parseAgentConfigFile('./agents/researcher.agent.yaml');
console.log(config.name);         // 'researcher'
console.log(config.tools);        // ['web-search', 'http-fetch']
```

Throws `AgentConfigError` if the file doesn't exist, can't be parsed, or fails validation.

### `parseAgentConfigString(content, filePath)`

Parse config from a string. The `filePath` is used for error messages and to determine format (JSON vs YAML).

```typescript
import { parseAgentConfigString } from '@kernova/core';

const yaml = `
name: test-agent
instructions: You are a test agent.
`;

const config = parseAgentConfigString(yaml, 'virtual.agent.yaml');
```

### `validateAgentConfig(data, filePath)`

Validate a plain object against the agent config schema. Returns the typed `AgentConfigFile` if valid.

```typescript
import { validateAgentConfig } from '@kernova/core';

const raw = JSON.parse(someString);
const validated = validateAgentConfig(raw, 'dynamic.agent.json');
// Throws AgentConfigError if invalid
```

### `mergeAgentConfigs(base, child)`

Merge two configs using inheritance rules (child overrides base, arrays replace).

```typescript
import { mergeAgentConfigs } from '@kernova/core';

const base = parseAgentConfigFile('./agents/base.agent.yaml');
const child = parseAgentConfigFile('./agents/child.agent.yaml');

const merged = mergeAgentConfigs(base, child);
// merged.name === child.name
// merged.model === child.model ?? base.model
```

### `loadAgentConfigWithExtends(filePath)`

The all-in-one loader. Parses the file, resolves `extends` chains recursively, and returns the fully merged config.

```typescript
import { loadAgentConfigWithExtends } from '@kernova/core';

const config = loadAgentConfigWithExtends('./agents/specialist.agent.yaml');
// Inherits from base, fully resolved
```

### `serializeAgentConfigToYaml(config)`

Convert an `AgentConfigFile` object back to a YAML string. Omits undefined/empty fields.

```typescript
import { serializeAgentConfigToYaml } from '@kernova/core';

const yaml = serializeAgentConfigToYaml(config);
fs.writeFileSync('./output.agent.yaml', yaml);
```

### `serializeAgentConfigToJson(config)`

Convert an `AgentConfigFile` object to a pretty-printed JSON string.

```typescript
import { serializeAgentConfigToJson } from '@kernova/core';

const json = serializeAgentConfigToJson(config);
fs.writeFileSync('./output.agent.json', json);
```

### `discoverAgentConfigFiles(dirPath)`

Find all agent config files in a directory (non-recursive scan).

```typescript
import { discoverAgentConfigFiles } from '@kernova/core';

const files = discoverAgentConfigFiles('./agents/');
// ['/abs/path/agents/researcher.agent.yaml', '/abs/path/agents/writer.agent.yaml']
```

Returns an empty array if the directory doesn't exist. If passed a single file path that matches agent config extensions, returns that file in an array.

### `isAgentConfigFile(filename)`

Check whether a filename matches recognized agent config extensions.

```typescript
import { isAgentConfigFile } from '@kernova/core';

isAgentConfigFile('researcher.agent.yaml'); // true
isAgentConfigFile('researcher.agent.yml');  // true
isAgentConfigFile('researcher.agent.json'); // true
isAgentConfigFile('researcher.ts');         // false
isAgentConfigFile('config.yaml');           // false
```

### `watchAgentConfigFiles(paths, onChange)`

Watch a set of config file paths for filesystem changes. Also watches parent directories for new files.

```typescript
import { watchAgentConfigFiles, discoverAgentConfigFiles } from '@kernova/core';

const files = discoverAgentConfigFiles('./agents/');

const stop = watchAgentConfigFiles(files, (filePath, event) => {
  console.log(`${event} detected: ${filePath}`);
  // event is 'change' or 'rename'
});

// Later: stop watching
stop();
```

---

## File Discovery & Extensions

### Recognized Extensions

| Extension | Format | Use Case |
|-----------|--------|----------|
| `.agent.yaml` | YAML | Human-edited configs (supports comments, multiline) |
| `.agent.yml` | YAML | Shorthand alternative |
| `.agent.json` | JSON | Programmatically generated configs |

### Discovery Behavior

`discoverAgentConfigFiles(path)` operates in two modes:

1. **Directory path** — scans entries (non-recursive) and returns all matching files
2. **File path** — returns the file in an array if it matches, otherwise empty array

```typescript
// Scan a directory
const agents = discoverAgentConfigFiles('./agents/');

// Validate a single file
const single = discoverAgentConfigFiles('./agents/researcher.agent.yaml');
```

The scan is intentionally non-recursive. If you need nested directories, call it multiple times or walk the tree yourself.

---

## Hot-Reload

When running in development with `kernova serve --watch`, agent config files are hot-reloaded automatically.

### How It Works

1. **Discovery** — `DaemonRunner` calls `discoverAgentConfigFiles(configPath)` at startup
2. **Watch setup** — `fs.watch` is attached to each discovered file and to the parent directory
3. **Change detection** — When a filesystem event fires, it's debounced (100ms) to batch rapid saves
4. **Re-parse** — The changed file is re-parsed with `loadAgentConfigWithExtends()`
5. **Re-register** — The kernel's agent registry is updated with the new definition
6. **Error handling** — Parse errors are logged but don't crash; the previous agent definition stays active

### Lifecycle Events

| Filesystem Event | Action |
|-----------------|--------|
| File modified | Debounce → re-parse → re-register agent |
| File deleted | Unregister the agent from the kernel |
| New file created | Parse → register as a new agent |
| Parse error | Log error, keep previous definition active |

### Example Development Workflow

```bash
# Terminal 1: Start with hot-reload
kernova serve --config ./agents --watch

# Terminal 2: Edit an agent
vim agents/researcher.agent.yaml
# Save → "Agent 'researcher' reloaded" appears in Terminal 1
```

```typescript
// Programmatic equivalent (DaemonRunner with { configPath, watch: true } does all of this for you)
import {
  watchAgentConfigFiles,
  discoverAgentConfigFiles,
  loadAgentConfigWithExtends,
  defineAgent,
  AgentConfigError,
} from '@kernova/core';
import type { AgentConfigFile } from '@kernova/types';

/** Register an agent from a config file, replacing the previous version (same stable ID) */
function registerFromConfig(config: AgentConfigFile) {
  const agent = defineAgent({
    name: config.name,
    description: config.description ?? config.name,
    capabilities: [{ id: config.name, name: config.name, description: config.description ?? config.name, confidence: 0.8 }],
    tools: [],
    instructions: config.instructions,
    ...(config.model && { model: { model: config.model } }),
  });
  agent.definition.id = `config-agent-${config.name}`;
  kernel.agentRegistry.unregister(agent.definition.id);
  kernel.agentRegistry.register(agent.definition, agent.executor);
}

const configDir = './agents/';
const files = discoverAgentConfigFiles(configDir);

let debounceTimer: NodeJS.Timeout | null = null;

const stop = watchAgentConfigFiles(files, (filePath, event) => {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    try {
      const config = loadAgentConfigWithExtends(filePath);
      registerFromConfig(config);
      console.log(`Agent '${config.name}' reloaded`);
    } catch (err) {
      if (err instanceof AgentConfigError) {
        console.error(`Config error: ${err.message}`);
        // Previous agent definition stays active
      }
    }
  }, 100);
});
```

---

## Validation Rules

All config files are validated on parse. Invalid configs throw `AgentConfigError` with a descriptive message.

### Required Fields

| Field | Rule |
|-------|------|
| `name` | Must be a non-empty string |
| `instructions` | Must be a non-empty string |

### Optional Field Validation

| Field | Rule |
|-------|------|
| `description` | If present, must be a string |
| `model` | If present, must be a string |
| `tools` | If present, must be an array of strings |
| `extends` | If present, must be a string (relative path) |
| `schedules` | If present, must be an array of schedule objects |
| `triggers` | If present, must be an array of trigger objects |

### Schedule Object Validation

| Field | Required | Rule |
|-------|----------|------|
| `name` | Yes | Non-empty string |
| `goal` | Yes | Non-empty string |
| `cron` | No | String (5-field cron format, e.g., `"0 * * * *"`) |
| `delayMs` | No | Number (milliseconds) |

### Trigger Object Validation

| Field | Required | Rule |
|-------|----------|------|
| `name` | Yes | Non-empty string |
| `event` | Yes | Non-empty string (glob pattern, e.g., `"intent.failed"`) |
| `goal` | Yes | Non-empty string |
| `condition` | No | String (JavaScript expression evaluated at runtime) |

### Error Examples

```typescript
import { parseAgentConfigFile, AgentConfigError } from '@kernova/core';

try {
  parseAgentConfigFile('./broken.agent.yaml');
} catch (err) {
  if (err instanceof AgentConfigError) {
    console.error(err.message);
    // "[AgentConfig] /abs/path/broken.agent.yaml: Missing or invalid required field 'name' (must be a non-empty string)"
    console.error(err.filePath);
    // "/abs/path/broken.agent.yaml"
  }
}
```

---

## AgentConfigError

Custom error class thrown for any config file issue — missing fields, parse errors, circular extends, file not found.

```typescript
class AgentConfigError extends Error {
  /** Descriptive error text (prefixed with file path) */
  message: string;

  /** Absolute path to the file that caused the error */
  filePath: string;

  /** Always 'AgentConfigError' — useful for instanceof checks */
  name: 'AgentConfigError';
}
```

### Common Error Scenarios

| Scenario | Message Pattern |
|----------|----------------|
| File not found | `File not found` |
| Invalid JSON | `Invalid JSON: Unexpected token...` |
| Invalid YAML | `Invalid YAML: ...` |
| Missing name | `Missing or invalid required field 'name'` |
| Missing instructions | `Missing or invalid required field 'instructions'` |
| Bad tools array | `Field 'tools' must be an array of strings` |
| Circular extends | `Circular extends dependency detected` |
| Schedule missing goal | `schedules[0].goal is required and must be a string` |

---

## Events

ConfigManager emits events through the kernel's event bus when configuration changes.

| Event | When Emitted | Data |
|-------|-------------|------|
| `config.changed` | A value changes in any layer (via `set()` or `reload()`) | `{ path, value, layer }` or `{ path, oldValue, newValue, layer }` |
| `config.reloaded` | `reload()` is called with new file config | `{ changeCount }` |

### Subscribing to Config Events

```typescript
kernel.eventBus.subscribe('config.changed', (event) => {
  const { path, value, layer } = event.data;
  console.log(`[${layer}] ${path} = ${value}`);
});

kernel.eventBus.subscribe('config.reloaded', (event) => {
  console.log(`Config reloaded: ${event.data.changeCount} changes`);
});
```

### Change Detection

On `reload()`, ConfigManager diffs the previous file config against the new one. Only paths with actual value changes emit `config.changed` events. If nothing changed, `config.reloaded` still fires with `changeCount: 0`.

---

## Best Practices

### Choose the Right Format

- **YAML** for human-edited configs — supports comments, multiline strings with `|`, and is easier to read
- **JSON** for programmatically generated configs — easier to produce from code, no indentation ambiguity

### Environment Variables for Secrets

Never put API keys or credentials in config files. Use the env layer:

```bash
# .env (not committed to git)
KERNOVA_MODELS__DEFAULT__PROVIDER=openai
OPENAI_API_KEY=sk-...
```

```yaml
# kernova.config.json (committed to git) — no secrets here
{
  "models": {
    "default": { "model": "gpt-4o" }
  }
}
```

### Keep Base Configs Minimal

Base configs should contain only what's truly shared. Specialize in child configs:

```yaml
# base.agent.yaml — minimal shared defaults
name: base
instructions: |
  You are part of the Kernova system.
  Always be professional and concise.
model: gpt-4o
```

```yaml
# researcher.agent.yaml — specialized
extends: ./base.agent.yaml
name: researcher
instructions: |
  You are a research specialist. Find accurate, sourced information.
tools:
  - web-search
  - http-fetch
```

### Validate Before Deploying

Use `parseAgentConfigFile()` in your CI/CD pipeline to catch config errors before deployment:

```typescript
// scripts/validate-agents.ts
import { discoverAgentConfigFiles, loadAgentConfigWithExtends } from '@kernova/core';

const files = discoverAgentConfigFiles('./agents/');
let errors = 0;

for (const file of files) {
  try {
    loadAgentConfigWithExtends(file);
    console.log(`✓ ${file}`);
  } catch (err) {
    console.error(`✗ ${file}: ${(err as Error).message}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n${errors} config file(s) failed validation.`);
  process.exit(1);
}
```

### Runtime Override Patterns

Use `set()` for temporary overrides during testing or A/B experiments:

```typescript
// In tests
kernel.configManager.set('models.default.provider', 'mock');
kernel.configManager.set('models.default.model', 'mock-model');

// Feature flags
kernel.configManager.set('features.newPipeline', true);

if (kernel.configManager.get('features.newPipeline')) {
  // Use new pipeline
}
```

### Watch for Critical Changes

Set up watchers on paths that require re-initialization:

```typescript
kernel.configManager.watch('models.default.provider', (provider) => {
  // Re-initialize model client when provider changes
  modelClient = createModelClient(provider as string);
});

kernel.configManager.watch('gateway.port', (port) => {
  console.warn(`Port changed to ${port} — restart required for effect.`);
});
```

---

## Complete Example

A full project using both runtime config and declarative agent configs:

```
my-project/
├── agents/
│   ├── base.agent.yaml
│   ├── researcher.agent.yaml
│   └── writer.agent.yaml
├── kernova.config.json
├── src/
│   └── index.ts
└── package.json
```

```yaml
# agents/base.agent.yaml
name: base
instructions: |
  You are part of the Kernova system. Be accurate, helpful, and concise.
model: gpt-4o
```

```yaml
# agents/researcher.agent.yaml
name: researcher
extends: ./base.agent.yaml
description: Finds and synthesizes information from multiple sources
instructions: |
  You are a research specialist. When given a topic:
  1. Search for authoritative sources
  2. Cross-reference findings
  3. Summarize with citations
tools:
  - web-search
  - http-fetch
schedules:
  - name: daily-briefing
    cron: "0 9 * * *"
    goal: "Compile daily news briefing for subscribed topics"
```

```yaml
# agents/writer.agent.yaml
name: writer
extends: ./base.agent.yaml
description: Creates clear, engaging written content
instructions: |
  You are a writing specialist. Focus on clarity, structure, and engagement.
  Always use active voice and concrete examples.
tools:
  - http-fetch
triggers:
  - name: on-research-complete
    event: "agent.delegation.completed"
    goal: "Draft content from research findings"
    condition: "event.data.targetAgent === 'researcher'"
```

```typescript
// src/index.ts
import { KernovaKernel } from '@kernova/core';
import {
  discoverAgentConfigFiles,
  loadAgentConfigWithExtends,
  watchAgentConfigFiles,
  AgentConfigError,
} from '@kernova/core';

const kernel = new KernovaKernel({ environment: 'development' });
await kernel.start();

// Load all agent configs
const configDir = './agents/';
const files = discoverAgentConfigFiles(configDir);

for (const file of files) {
  try {
    const config = loadAgentConfigWithExtends(file);
    if (config.name === 'base') continue; // Skip abstract base
    registerFromConfig(config); // defined in the hot-reload example above
    console.log(`Registered agent: ${config.name}`);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      console.error(`Skipping ${err.filePath}: ${err.message}`);
    }
  }
}

// Watch for runtime config changes
kernel.configManager.watch('models.default.provider', (provider) => {
  console.log(`Model provider switched to: ${provider}`);
});

// Hot-reload agent configs in development
if (kernel.configManager.get('runtime.environment') === 'development') {
  watchAgentConfigFiles(files, (filePath, event) => {
    console.log(`Config ${event}: ${filePath}`);
    // DaemonRunner handles actual reload logic
  });
}
```
