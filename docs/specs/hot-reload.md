# Spec: Hot Reload in Development Mode

> Written BEFORE implementation, as required by CONTRIBUTING.md.

## Summary

When running `nexus dev`, watch agent/workflow files for changes and reload them without restarting the kernel. This gives developers instant feedback.

## Problem

Currently, any change to an agent file requires stopping and restarting the entire process. This kills the development loop speed — especially when the kernel has state (memory, active intents).

## Design

### Architecture

```
nexus dev
   ↓
Kernel starts
   ↓
FileWatcher monitors src/agents/ and src/workflows/
   ↓ (file change detected)
Dynamic import with cache-busting (?t=timestamp)
   ↓
AgentRegistry.reload(definition, executor)
   ↓
Event emitted: agent.reloaded
   ↓
Console: "✓ Agent 'assistant' reloaded"
```

### Key Decisions

1. **Node.js `fs.watch`** — No external dependencies (chokidar not needed for simple case)
2. **Dynamic import with cache-bust** — Forces fresh module load via `?t=` query param
3. **Graceful reload** — Wait for active intents to finish, then swap agent
4. **Error recovery** — If new code has errors, keep old agent running, show error
5. **Debounce** — 100ms debounce to avoid reload storms on save

### Watched Paths

- `src/agents/**/*.ts` — Agent definitions
- `src/workflows/**/*.ts` — Workflow definitions (future)

### Developer Experience

```
  ◆ N E X U S  — Development Runtime
  
  ✓ Nexus runtime is running
  ✓ Watching: src/agents/, src/workflows/
  
  [8:15:22] ✓ Agent 'assistant' reloaded (50ms)
  [8:15:30] ✗ Agent 'reviewer' failed to reload: SyntaxError at line 15
```

## Success Criteria

- [ ] File change triggers agent reload within 200ms
- [ ] Syntax errors don't crash the runtime
- [ ] Currently executing intents finish before swap
- [ ] Console shows clear reload status
- [ ] Works on Windows, macOS, Linux
