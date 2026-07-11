---
title: "Built-in Tools"
description: Six pre-packaged tools that ship with Kernova — HTTP fetch, file I/O, shell execution, date/time, and web search — all with sandbox enforcement.
---

Kernova ships six built-in tools that are automatically registered when the kernel starts. No external dependencies, no configuration files, no plugin installs — they're ready to use out of the box.

Agents can invoke tools in two ways:

| Pattern | Method | Who Decides |
|---------|--------|-------------|
| Automatic | `tools.completeWithTools()` | The LLM decides which tools to call |
| Direct | `tools.useTool(id, params)` | Your code decides explicitly |

---

## The Twelve Built-in Tools

| ID | Description |
|----|-------------|
| `http-fetch` | Make HTTP requests (GET, POST, PUT, DELETE, PATCH) |
| `file-read` | Read files from the sandboxed filesystem |
| `file-write` | Write or append to files in the sandboxed filesystem |
| `shell-exec` | Execute shell commands within the sandbox |
| `date-time` | Get current date, time, timezone, and formatting |
| `web-search` | Search the web (pluggable provider pattern) |
| `json-parse` | Parse JSON with dot-path extraction and transforms |
| `math-eval` | Safe math expression evaluation (no eval()) |
| `regex-match` | Pattern matching and replacement with ReDoS protection |
| `image-describe` | Describe images using a vision-capable model |
| `database-query` | Read-only SQL queries against SQLite |
| `code-eval` | Sandboxed JavaScript execution with timeout |

### How They're Registered

During `kernel.start()`, the `BuiltInToolRegistry` creates tool definitions and registers them into the `PluginRegistry`. This happens before any user-defined plugins load, so built-in tools are always available (unless explicitly disabled).

```
kernel.start()
  → BuiltInToolRegistry.init(config)
    → Creates 6 tool definitions
    → Applies enabled/disabled filtering
    → Registers surviving tools into PluginRegistry
  → User plugins load
  → Kernel ready
```

---

## Configuration

Control which tools are available and how they behave via `BuiltInToolConfig`:

```typescript
interface BuiltInToolConfig {
  enabled?: string[];     // Whitelist — only these tools are available
  disabled?: string[];    // Blacklist — these are removed (takes priority)
  sandboxDir?: string;    // Root dir for file operations (default: dataDir)
  shellTimeout?: number;  // Shell command timeout in ms (default: 30000)
}
```

### Via KernovaKernel (Core)

```typescript
import { KernovaKernel } from '@kernova/core';

const kernel = new KernovaKernel({
  builtInTools: {
    disabled: ['shell-exec'],
    sandboxDir: './workspace',
  },
});
```

### Via SDK

```typescript
import { Kernova } from '@kernova/sdk';

const app = await Kernova.create({
  builtInTools: {
    enabled: ['http-fetch', 'date-time', 'file-read'],
    sandboxDir: './data',
  },
});
```

---

## Tool: http-fetch

Make HTTP requests to external APIs, webhooks, or any URL.

**ID:** `http-fetch`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | URL to fetch |
| `method` | string | No | `'GET'` | HTTP method (GET, POST, PUT, DELETE, PATCH) |
| `headers` | object | No | `{}` | HTTP headers |
| `body` | string | No | — | Request body (only sent for POST/PUT/PATCH) |
| `timeout` | number | No | 30000 | Timeout in ms |

### Returns

On success:
```typescript
{
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json', ... },
  body: '{"login":"kernova","id":12345,...}'
}
```

On failure:
```typescript
{
  error: true,
  message: 'Request timeout after 30000ms'
}
```

### Error Handling

Network errors and timeouts return an error object — they never throw. This means the LLM sees the error message in context and can decide how to recover (retry, try a different URL, or report the failure to the user).

### Examples

```typescript
// Simple GET request
const result = await tools.useTool('http-fetch', {
  url: 'https://api.github.com/repos/kernova/core',
});

console.log(JSON.parse(result.body).stargazers_count);
```

```typescript
// POST with headers and JSON body
const result = await tools.useTool('http-fetch', {
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-...',
  },
  body: JSON.stringify({ name: 'test', value: 42 }),
});

if (result.error) {
  console.error('Request failed:', result.message);
} else {
  console.log('Created:', result.status); // 201
}
```

```typescript
// DELETE with custom timeout
const result = await tools.useTool('http-fetch', {
  url: 'https://api.example.com/records/123',
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer sk-...' },
  timeout: 5000,
});
```

---

## Tool: file-read

Read files from the sandboxed filesystem.

**ID:** `file-read`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | — | File path relative to sandbox |
| `encoding` | string | No | `'utf-8'` | Encoding (utf-8, base64, hex) |

### Returns

```typescript
{
  path: 'config/settings.json',
  content: '{"theme":"dark","lang":"en"}',
  size: 28
}
```

### Sandbox Enforcement

The path is resolved relative to `sandboxDir`. Any attempt to traverse outside the sandbox is blocked:

```typescript
// ✓ Valid — resolves to {sandboxDir}/config/settings.json
await tools.useTool('file-read', { path: 'config/settings.json' });

// ✓ Valid — resolves to {sandboxDir}/data.txt
await tools.useTool('file-read', { path: './data.txt' });

// ✗ BLOCKED — path traversal detected
await tools.useTool('file-read', { path: '../../etc/passwd' });
// → throws SandboxViolationError
```

### Errors

| Condition | Behavior |
|-----------|----------|
| File not found | Throws with clear message: `File not found: reports/q4.csv` |
| Permission denied | Throws with OS-level error |
| Path traversal | Throws `SandboxViolationError` (code: `'SANDBOX_VIOLATION'`) |

### Example

```typescript
// Read a JSON config
const { content } = await tools.useTool('file-read', { path: 'config.json' });
const config = JSON.parse(content);

// Read a binary file as base64
const { content: b64 } = await tools.useTool('file-read', {
  path: 'images/logo.png',
  encoding: 'base64',
});
```

---

## Tool: file-write

Write or append content to files in the sandboxed filesystem.

**ID:** `file-write`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | — | File path relative to sandbox |
| `content` | string | Yes | — | Content to write |
| `encoding` | string | No | `'utf-8'` | Encoding (utf-8, base64, hex) |
| `append` | boolean | No | `false` | Append instead of overwrite |

### Returns

```typescript
{
  path: 'output/report.md',
  bytesWritten: 1024,
  append: false,
  success: true
}
```

### Behavior

- **Overwrite (default):** Replaces the file if it exists, creates it if it doesn't.
- **Append:** Adds content to the end of an existing file, or creates a new file.
- **Auto-mkdir:** Parent directories are created automatically (like `mkdir -p`). Writing to `reports/2025/q3/summary.md` creates all intermediate directories.

### Sandbox Enforcement

Same rules as `file-read`. The path must resolve within `sandboxDir`, or a `SandboxViolationError` is thrown.

### Examples

```typescript
// Write a new file
await tools.useTool('file-write', {
  path: 'output/results.json',
  content: JSON.stringify({ processed: 42, errors: 0 }, null, 2),
});

// Append to a log file
await tools.useTool('file-write', {
  path: 'logs/agent.log',
  content: `[${new Date().toISOString()}] Task completed successfully\n`,
  append: true,
});

// Write binary data from base64
await tools.useTool('file-write', {
  path: 'exports/chart.png',
  content: base64ImageData,
  encoding: 'base64',
});
```

---

## Tool: shell-exec

Execute shell commands within the sandboxed environment.

**ID:** `shell-exec`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `command` | string | Yes | — | Shell command to execute |
| `cwd` | string | No | sandbox root | Working directory (relative to sandbox) |
| `timeout` | number | No | 30000 | Timeout in ms |
| `env` | object | No | — | Extra environment variables |

### Returns

```typescript
// Successful execution
{
  stdout: 'Hello, world!\n',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  error: null
}

// Non-zero exit (does NOT throw)
{
  stdout: '',
  stderr: 'fatal: not a git repository\n',
  exitCode: 128,
  timedOut: false,
  error: null
}

// Timeout (process killed)
{
  stdout: '... partial output ...',
  stderr: '',
  exitCode: 143,
  timedOut: true,
  error: 'Process timed out after 30000ms'
}
```

### Error Behavior

Non-zero exit codes do **not** throw. The LLM receives stdout, stderr, and the exit code so it can reason about what went wrong and decide how to proceed. This is intentional — many CLI tools use non-zero exits for non-fatal conditions.

Only sandbox violations throw.

### Sandbox Enforcement

The `cwd` parameter must resolve within the sandbox directory. Attempting to set `cwd` to a path outside the sandbox throws `SandboxViolationError`.

```typescript
// ✓ Valid — runs in {sandboxDir}/project
await tools.useTool('shell-exec', { command: 'ls -la', cwd: 'project' });

// ✗ BLOCKED — traversal detected
await tools.useTool('shell-exec', { command: 'ls', cwd: '../../../' });
// → throws SandboxViolationError
```

### Security Warning

This tool executes **arbitrary shell commands**. In production, disable it unless you have a specific, controlled use case:

```typescript
builtInTools: { disabled: ['shell-exec'] }
```

If you must keep it enabled, combine it with a strict `sandboxDir` and short `shellTimeout`.

### Examples

```typescript
// Run a build script
const result = await tools.useTool('shell-exec', {
  command: 'npm run build',
  cwd: 'project',
  timeout: 60000,
});

if (result.exitCode !== 0) {
  console.error('Build failed:', result.stderr);
}
```

```typescript
// Run with environment variables
await tools.useTool('shell-exec', {
  command: 'python analyze.py --input data.csv',
  env: { PYTHONPATH: './lib', OUTPUT_FORMAT: 'json' },
  timeout: 45000,
});
```

```typescript
// Quick check — list files
const { stdout } = await tools.useTool('shell-exec', {
  command: 'find . -name "*.ts" | head -20',
});
```

---

## Tool: date-time

Get the current date, time, and timezone information.

**ID:** `date-time`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `format` | string | No | `'iso'` | Output format (iso, unix, locale) |
| `timezone` | string | No | system TZ | IANA timezone (e.g., `'America/New_York'`) |

### Returns

```typescript
{
  iso: '2025-07-10T14:30:00-04:00',
  unix: 1720630200,
  unixMs: 1720630200000,
  date: '2025-07-10',
  time: '14:30:00',
  timezone: 'America/New_York',
  offset: '-04:00',
  dayOfWeek: 'Thursday',
}
```

### Why This Exists

LLMs don't know the current date or time. This tool gives agents temporal awareness without relying on stale training data. Common use cases:

- Scheduling: "remind me tomorrow at 9am"
- Logging: timestamp entries
- Time-zone conversions: "what time is it in Tokyo?"
- Relative dates: "what day was last Monday?"

### Examples

```typescript
// Get current time in default timezone
const now = await tools.useTool('date-time', {});
console.log(now.iso); // '2025-07-10T14:30:00-04:00'

// Get time in a specific timezone
const tokyo = await tools.useTool('date-time', { timezone: 'Asia/Tokyo' });
console.log(tokyo.time); // '03:30:00' (next day)

// Just need the unix timestamp
const { unix } = await tools.useTool('date-time', { format: 'unix' });
```

---

## Tool: web-search

Search the web and return structured results.

**ID:** `web-search`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query |
| `maxResults` | number | No | 5 | Max results to return |

### Returns

```typescript
{
  query: 'Kernova AI framework',
  results: [
    {
      title: 'Kernova — Autonomous Agent Framework',
      url: 'https://kernova.dev',
      snippet: 'Build, deploy, and manage autonomous AI agents...',
    },
    // ... more results
  ],
  resultCount: 5
}
```

When no provider is configured:
```typescript
{
  query: 'Kernova AI framework',
  results: [],
  message: 'No search provider configured'
}
```

### Provider Pattern

By default, `web-search` uses a `StubSearchProvider` that returns empty results. This is intentional — web search requires an API key, and Kernova doesn't force you to have one.

To enable real search, implement the `WebSearchProvider` interface:

```typescript
import { createWebSearchTool } from '@kernova/core';
import type { WebSearchProvider, SearchResult } from '@kernova/core';

class BraveSearchProvider implements WebSearchProvider {
  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY! },
      }
    );
    const data = await res.json();
    return data.web.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}

// Register the custom provider
const searchTool = createWebSearchTool(new BraveSearchProvider());
```

You can use any search API — Brave, SerpAPI, Tavily, or your own. Just implement the interface:

```typescript
interface WebSearchProvider {
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
```

### Example

```typescript
// Search and summarize results
const { results } = await tools.useTool('web-search', {
  query: 'Node.js 22 new features',
  maxResults: 3,
});

for (const r of results) {
  console.log(`${r.title}: ${r.url}`);
}
```

---

## Tool: json-parse

Parse raw JSON strings with optional dot-path extraction and transformations.

**ID:** `json-parse`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `input` | string | Yes | — | Raw JSON string to parse |
| `path` | string | No | — | Dot-path to extract (e.g., `"data.users[0].name"`) |
| `transform` | string | No | — | Transform: `'keys'`, `'values'`, `'flatten'`, `'pretty'` |

### Examples

```typescript
// Parse and extract a nested value
const result = await tools.useTool('json-parse', {
  input: '{"data":{"users":[{"name":"Alice","age":30}]}}',
  path: 'data.users[0].name',
});
// { result: "Alice" }

// Flatten a nested object
const flat = await tools.useTool('json-parse', {
  input: '{"a":{"b":1,"c":{"d":2}}}',
  transform: 'flatten',
});
// { result: { "a.b": 1, "a.c.d": 2 } }

// Get object keys
const keys = await tools.useTool('json-parse', {
  input: '{"name":"Alice","age":30,"role":"admin"}',
  transform: 'keys',
});
// { result: ["name", "age", "role"] }
```

---

## Tool: math-eval

Safely evaluate mathematical expressions without `eval()`. Uses a recursive-descent parser.

**ID:** `math-eval`

### Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `expression` | string | Yes | Math expression (e.g., `"2 * pi + sqrt(16)"`) |

### Supported Operations

**Arithmetic:** `+`, `-`, `*`, `/`, `%`, `^` (power)
**Functions:** `sqrt`, `abs`, `ceil`, `floor`, `round`, `sin`, `cos`, `tan`, `log`, `log2`, `log10`, `min`, `max`
**Constants:** `pi`, `e`, `random`

### Examples

```typescript
const r1 = await tools.useTool('math-eval', { expression: '2 * pi + sqrt(16)' });
// { expression: "2 * pi + sqrt(16)", result: 10.283... }

const r2 = await tools.useTool('math-eval', { expression: 'max(10, 20, 30) * 2' });
// { expression: "max(10, 20, 30) * 2", result: 60 }

const r3 = await tools.useTool('math-eval', { expression: '2^10' });
// { expression: "2^10", result: 1024 }
```

---

## Tool: regex-match

Pattern matching and replacement with ReDoS (catastrophic backtracking) protection.

**ID:** `regex-match`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `text` | string | Yes | — | Text to search in |
| `pattern` | string | Yes | — | Regex pattern |
| `flags` | string | No | `''` | Flags: `'g'`, `'i'`, `'gi'`, `'gm'`, etc. |
| `replace` | string | No | — | If set, performs replacement instead of matching |

### Returns

**Match mode:** `{ matches: string[], groups: Record<string, string>[], matchCount: number }`
**Replace mode:** `{ result: string, replacements: number }`

### Examples

```typescript
// Find all email addresses
const emails = await tools.useTool('regex-match', {
  text: 'Contact alice@example.com or bob@test.org',
  pattern: '[\\w.-]+@[\\w.-]+\\.[a-z]{2,}',
  flags: 'gi',
});
// { matches: ["alice@example.com", "bob@test.org"], groups: [], matchCount: 2 }

// Replace with named groups
const result = await tools.useTool('regex-match', {
  text: '2025-07-10',
  pattern: '(\\d{4})-(\\d{2})-(\\d{2})',
  replace: '$2/$3/$1',
});
// { result: "07/10/2025", replacements: 1 }
```

---

## Tool: image-describe

Describe images using a vision-capable AI model. Requires a model that supports image input (GPT-4o, Claude 3.5, Gemini).

**ID:** `image-describe`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Image URL (https://...) or base64 data URI |
| `prompt` | string | No | `"Describe this image in detail"` | What to focus on |

### Returns

`{ description: string, url: string }`

### Examples

```typescript
// Describe a web image
const desc = await tools.useTool('image-describe', {
  url: 'https://example.com/chart.png',
  prompt: 'What trends does this chart show?',
});
// { description: "The chart shows quarterly revenue...", url: "https://..." }

// Describe a base64 image
const result = await tools.useTool('image-describe', {
  url: 'data:image/png;base64,iVBORw0KGgo...',
  prompt: 'Is there any text visible in this screenshot?',
});
```

:::note
This tool is only available when a vision-capable model provider is configured. It uses the `'vision'` purpose for model routing.
:::

---

## Tool: database-query

Execute read-only SQL queries against the Kernova SQLite database. Write operations are rejected.

**ID:** `database-query`

### Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | SQL query (SELECT only) |
| `params` | array | No | Parameterized values for `?` placeholders |

### Returns

`{ rows: Record<string, unknown>[], rowCount: number, columns: string[] }`

### Security

Only `SELECT`, `WITH...SELECT`, and `EXPLAIN` queries are allowed. All write operations (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, etc.) are rejected with a clear error message.

### Examples

```typescript
// Simple query
const users = await tools.useTool('database-query', {
  query: 'SELECT name, email FROM users WHERE active = 1 LIMIT 10',
});
// { rows: [{name: "Alice", email: "..."}, ...], rowCount: 5, columns: ["name", "email"] }

// Parameterized query (prevents SQL injection)
const events = await tools.useTool('database-query', {
  query: 'SELECT * FROM events WHERE event_type = ? AND timestamp > ?',
  params: ['intent.completed', '2025-07-01'],
});

// Rejected write attempt
const bad = await tools.useTool('database-query', {
  query: 'DELETE FROM users WHERE id = 1',
});
// { error: true, message: "Only SELECT queries are allowed..." }
```

:::note
This tool is only available when `builtInTools.databasePath` is configured. By default it points to the kernel's SQLite database.
:::

---

## Tool: code-eval

Execute JavaScript code in a sandboxed VM context with strict timeout and limited globals.

**ID:** `code-eval`

### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `code` | string | Yes | — | JavaScript code to execute |
| `timeout` | number | No | 5000 | Execution timeout in ms |

### Returns

`{ result: unknown, stdout: string, executionMs: number }`

### Available Globals

`console.log/warn/error` (captured), `JSON`, `Math`, `Date`, `parseInt`, `parseFloat`, `String`, `Number`, `Boolean`, `Array`, `Object`, `Map`, `Set`, `RegExp`, `Error`, `Promise`, `isNaN`, `isFinite`

### Blocked Globals

`process`, `require`, `import`, `fs`, `child_process`, `Buffer`, `fetch`, `setTimeout`, `setInterval`, `global`, `globalThis`

### Examples

```typescript
// Simple computation
const calc = await tools.useTool('code-eval', {
  code: `
    const data = [1, 2, 3, 4, 5];
    const sum = data.reduce((a, b) => a + b, 0);
    const avg = sum / data.length;
    console.log('Average:', avg);
    avg;
  `,
});
// { result: 3, stdout: "Average: 3", executionMs: 2 }

// Data transformation
const transform = await tools.useTool('code-eval', {
  code: `
    const input = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }];
    const names = input.map(p => p.name);
    JSON.stringify(names);
  `,
});
// { result: '["Alice","Bob"]', stdout: "", executionMs: 1 }

// Timeout protection
const infinite = await tools.useTool('code-eval', {
  code: 'while(true) {}',
  timeout: 1000,
});
// { error: true, message: "Execution timed out", executionMs: 1000 }
```

### Security

The `code-eval` tool uses Node.js `vm.runInNewContext()` which provides isolation from the host process. However:
- It does NOT protect against CPU exhaustion within the timeout window
- It's suitable for data transformation, not for running untrusted user code at scale
- In production, consider disabling it via `builtInTools.disabled: ['code-eval']`

---

## Sandbox Enforcement

The sandbox is Kernova's primary defense against filesystem and shell abuse by AI agents. It constrains all file and shell operations to a single directory tree.

### How It Works

1. **Resolution:** All paths are resolved relative to `sandboxDir` using `path.resolve(sandboxDir, userPath)`.
2. **Normalization:** The resolved path is normalized to remove `.`, `..`, and redundant separators.
3. **Containment check:** The normalized path must `startsWith(sandboxDir)`. If not → blocked.

```typescript
// sandboxDir = '/app/data'

resolve('/app/data', 'reports/q4.csv')
  → '/app/data/reports/q4.csv'
  → startsWith('/app/data') ✓ ALLOWED

resolve('/app/data', '../../etc/passwd')
  → '/etc/passwd'
  → startsWith('/app/data') ✗ BLOCKED
```

### SandboxViolationError

When a path fails the containment check, Kernova throws a `SandboxViolationError`:

```typescript
import { SandboxViolationError } from '@kernova/core';

try {
  await tools.useTool('file-read', { path: '../../../etc/shadow' });
} catch (err) {
  if (err instanceof SandboxViolationError) {
    console.error(err.code);    // 'SANDBOX_VIOLATION'
    console.error(err.message); // 'Path resolves outside sandbox: /etc/shadow'
  }
}
```

### Which Tools Are Sandboxed?

| Tool | Sandboxed | What's Checked |
|------|-----------|----------------|
| `file-read` | Yes | `path` parameter |
| `file-write` | Yes | `path` parameter |
| `shell-exec` | Yes | `cwd` parameter |
| `http-fetch` | No | — |
| `date-time` | No | — |
| `web-search` | No | — |

---

## Using Tools in Agents

### Pattern 1: Let the LLM Decide (Automatic)

When an agent has tools available and you don't provide a custom executor, the default executor calls `completeWithTools()`. This sends tool definitions to the LLM as part of the prompt, and the LLM decides whether (and which) tools to invoke in a multi-turn loop.

```typescript
app.agent('researcher', {
  instructions: 'You research topics using web search and HTTP requests.',
  // No custom executor — the default executor uses completeWithTools()
  // which sends tool definitions to the LLM and lets it decide
});

// The LLM will autonomously call web-search and http-fetch as needed
const result = await app.ask('What are the latest changes in TypeScript 5.5?');
```

This is the most common pattern. The LLM sees the tool descriptions in its context and calls them as part of its reasoning loop.

### Pattern 2: Direct Invocation (Custom Executor)

When you need deterministic control over tool usage — specific order, conditional logic, or combining tool results before the LLM sees them — use a custom executor with `tools.useTool()`:

```typescript
app.agent('file-processor', {
  instructions: 'You process and transform files.',
  async execute(intent, context, tools) {
    // Step 1: Read input
    const { content } = await tools.useTool('file-read', {
      path: 'input.json',
    });

    // Step 2: Let the LLM transform the content
    const processed = await tools.complete(
      `Transform this JSON into a Markdown report:\n\n${content}`
    );

    // Step 3: Write output
    await tools.useTool('file-write', {
      path: 'output/report.md',
      content: processed,
    });

    return {
      success: true,
      summary: 'File processed and report generated',
      data: { inputSize: content.length, outputPath: 'output/report.md' },
    };
  },
});
```

### Pattern 3: Hybrid (LLM + Direct)

You can mix both approaches. Use direct calls for setup/teardown, and let the LLM handle the creative middle:

```typescript
app.agent('data-analyst', {
  instructions: 'You analyze datasets and produce insights.',
  async execute(intent, context, tools) {
    // Direct: read the data
    const { content } = await tools.useTool('file-read', { path: 'dataset.csv' });

    // LLM with tools: let it search for context and analyze
    const analysis = await tools.completeWithTools(
      `Analyze this dataset and search the web for relevant benchmarks:\n\n${content}`
    );

    // Direct: save results
    await tools.useTool('file-write', {
      path: 'analysis/results.md',
      content: analysis,
    });

    return { success: true, summary: analysis.slice(0, 200) };
  },
});
```

---

## Enable/Disable Logic

The enable/disable system follows a clear priority order:

### Priority Rules

1. **`disabled` array (highest priority):** If a tool ID appears in `disabled`, it is removed regardless of the `enabled` array.
2. **`enabled` array:** If set, _only_ tools in this list are available. Everything else is excluded.
3. **Neither set (default):** All 6 tools are registered and available.

### Examples

```typescript
// All 6 tools available (default)
builtInTools: {}

// Only 3 tools available
builtInTools: {
  enabled: ['http-fetch', 'date-time', 'file-read'],
}

// All except shell-exec
builtInTools: {
  disabled: ['shell-exec'],
}

// enabled + disabled: disabled wins
// Result: only http-fetch and date-time (file-read is disabled)
builtInTools: {
  enabled: ['http-fetch', 'date-time', 'file-read'],
  disabled: ['file-read'],
}
```

### Decision Flowchart

```
For each built-in tool:
  ├─ Is it in `disabled`? → SKIP (not registered)
  ├─ Is `enabled` array set?
  │   ├─ Is tool in `enabled`? → REGISTER
  │   └─ Not in `enabled`? → SKIP
  └─ Neither array set? → REGISTER (default: all enabled)
```

---

## Security Best Practices

### 1. Disable shell-exec in production

Unless your agent genuinely needs to run shell commands, disable it. The risk of arbitrary command execution far outweighs convenience:

```typescript
builtInTools: {
  disabled: ['shell-exec'],
}
```

### 2. Use the narrowest sandboxDir possible

Don't set `sandboxDir` to your home directory or project root. Point it at the specific directory the agent needs access to:

```typescript
// ✗ Too broad
builtInTools: { sandboxDir: '/home/user' }

// ✓ Narrow and specific
builtInTools: { sandboxDir: '/home/user/app/agent-workspace' }
```

### 3. Prefer enabled whitelist over disabled blacklist

Explicit is better than implicit. In production, declare exactly which tools your agent needs:

```typescript
// ✓ Production: explicit whitelist
builtInTools: {
  enabled: ['http-fetch', 'date-time'],
}

// ✗ Risky: you might forget to disable a new tool in future versions
builtInTools: {
  disabled: ['shell-exec'],
}
```

### 4. Monitor tool events

Kernova emits events when tools are used. Monitor them to detect abuse or unexpected behavior:

```typescript
kernel.events.on('tool.executed', (event) => {
  console.log(`[tool] ${event.toolId} called by ${event.agentId}`);
  if (event.toolId === 'shell-exec') {
    // Log shell commands for audit
    audit.log('shell-exec', event.params.command, event.agentId);
  }
});

kernel.events.on('tool.failed', (event) => {
  console.error(`[tool:error] ${event.toolId}: ${event.error.message}`);
  if (event.error.code === 'SANDBOX_VIOLATION') {
    // Alert on sandbox violation attempts
    alerts.send('sandbox-violation', event);
  }
});
```

### 5. Set reasonable shell timeouts

The default 30-second timeout is sensible for most cases. Don't increase it to minutes unless you have a very specific reason:

```typescript
// ✓ Good: tight timeout for quick commands
builtInTools: { shellTimeout: 10000 }

// ✗ Risky: allows long-running processes
builtInTools: { shellTimeout: 300000 }
```

### 6. Review agent instructions

Your agent's system prompt is the first line of defense. Be specific about what the agent should and shouldn't do with tools:

```typescript
app.agent('data-fetcher', {
  instructions: `
    You fetch data from approved APIs only.
    NEVER make requests to internal network addresses (10.x, 192.168.x, localhost).
    NEVER write to any path outside the 'output/' directory.
    If a request fails, report the error — do not retry more than twice.
  `,
});
```

---

## Summary

| Tool | Sandboxed | Throws on Error | Default Enabled | Conditional |
|------|-----------|-----------------|-----------------|-------------|
| `http-fetch` | No | No (returns error object) | Yes | — |
| `file-read` | Yes | Yes | Yes | — |
| `file-write` | Yes | Yes | Yes | — |
| `shell-exec` | Yes | No (returns exit code) | Yes | — |
| `date-time` | No | No | Yes | — |
| `web-search` | No | No (returns empty) | Yes | — |
| `json-parse` | No | No (returns error object) | Yes | — |
| `math-eval` | No | No (returns error object) | Yes | — |
| `regex-match` | No | No (returns error object) | Yes | — |
| `image-describe` | No | No (returns error object) | Yes | Requires `modelRouter` |
| `database-query` | No | No (returns error object) | Yes | Requires `databasePath` |
| `code-eval` | VM sandbox | No (returns error object) | Yes | — |

Built-in tools provide a secure, zero-config foundation for agent capabilities. Start with the whitelist approach, keep the sandbox tight, and disable `shell-exec` and `code-eval` in production unless you need them.
