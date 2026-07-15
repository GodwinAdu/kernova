---
title: "Agent Loops"
description: "Build agents that keep working until the goal is fully achieved — iterative, goal-oriented execution with tool calling and self-evaluation."
---

# Agent Loops

By default, an agent responds in a single pass — one LLM call, one response. But real-world tasks often require multiple steps: searching, reading, processing, and acting on multiple items.

**Agent Loops** enable iterative execution: the agent keeps working in a cycle until the goal is fully achieved.

```
┌─────────────────────────────────────────────────┐
│                                                  │
│   1. THINK    → Analyze state, plan next step    │
│   2. ACT      → Call a tool, delegate, reason    │
│   3. EVALUATE → "Is the goal fully complete?"    │
│                                                  │
│   If NO  → Back to step 1 (next iteration)       │
│   If YES → Return final result to user           │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Quick Start

Add `loop` to your agent definition:

```typescript
// agents/assistant.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Assistant',
  instructions: 'You are a helpful AI assistant...',
  tools: ['gmail', 'calendar', 'web-search'],
  loop: {
    enabled: true,
    maxIterations: 10,
  },
});
```

That's it. Now when you tell the agent "reply to all unread emails", it won't just describe what it would do — it'll iterate through each email, read it, compose a contextual reply, send it, and continue until all are handled.

## Configuration

```typescript
loop: {
  /** Enable loop mode (default: false) */
  enabled: true,

  /** Max iterations before stopping (default: 10) */
  maxIterations: 15,

  /** Max total execution time in ms (default: 120000 = 2 min) */
  timeout: 180000,  // 3 minutes

  /** Confidence threshold to stop (default: 0.8) */
  completionThreshold: 0.85,

  /** Stream step progress to client (default: true) */
  streamSteps: true,

  /** Allow delegation to other agents (default: true) */
  allowDelegation: true,
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Turn on loop mode |
| `maxIterations` | `10` | Safety cap — prevents infinite loops |
| `timeout` | `120000` | Hard time limit (2 min default) |
| `completionThreshold` | `0.8` | Agent must be 80%+ confident before stopping |
| `streamSteps` | `true` | Client sees progress as each step completes |
| `allowDelegation` | `true` | Agent can hand off subtasks to other agents |

## How It Works

### The Loop Cycle

On each iteration, the agent receives a structured prompt that includes:
- The original goal
- What tools are available
- Steps taken so far (with results)
- Current iteration count / max

The agent responds with:
```json
{
  "thought": "I need to check the inbox for unread emails first",
  "action": {
    "type": "tool_call",
    "tool": "gmail",
    "params": { "action": "search", "query": "is:unread newer_than:1d" }
  },
  "evaluation": {
    "goalComplete": false,
    "confidence": 0.2,
    "remaining": "Found 3 unread emails. Need to read and reply to each.",
    "nextAction": "Read the first unread email"
  }
}
```

### Action Types

| Type | What it does |
|------|-------------|
| `tool_call` | Calls a registered tool with parameters |
| `delegate` | Hands a subtask to another agent |
| `reason` | Pure thinking step (no external action) |
| `evaluate` | Assessment-only step |

### Stopping Conditions

The loop stops when ANY of these are true:
1. `goalComplete: true` AND `confidence >= completionThreshold`
2. `iterations >= maxIterations` (returns partial result)
3. Total time exceeds `timeout` (returns what's done so far)
4. LLM call fails (returns error)

---

## Examples

### Example 1: Reply to All Unread Emails

```typescript
// agents/email-handler.agent.ts
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Email Handler',
  instructions: `You handle email tasks autonomously.
    When asked to reply to emails:
    1. Search for matching emails
    2. Read each one to understand context
    3. Compose a contextual reply (NOT generic templates)
    4. Send the reply
    5. Continue until all are handled`,
  tools: ['gmail'],
  loop: {
    enabled: true,
    maxIterations: 20,    // Might need many steps for multiple emails
    timeout: 300000,      // 5 minutes
    completionThreshold: 0.9,
  },
});
```

**User says:** "Reply to all unread emails from today"

**Loop execution:**
```
Step 1: THINK → "I need to find today's unread emails"
        ACT   → gmail(search, "is:unread newer_than:1d")
        EVAL  → goalComplete: false (found 3 emails, need to process each)

Step 2: THINK → "Reading first email from Albert about design thumbnails"
        ACT   → gmail(read, messageId: "abc123")
        EVAL  → goalComplete: false (read email, now need to reply)

Step 3: THINK → "Replying to Albert — acknowledging the shared design"
        ACT   → gmail(reply, messageId: "abc123", body: "Thanks Albert! I'll review...")
        EVAL  → goalComplete: false (1/3 done, 2 remaining)

Step 4: THINK → "Reading second email from Samsung about phone launch"
        ACT   → gmail(read, messageId: "def456")
        EVAL  → goalComplete: false (marketing email, will skip reply)

Step 5: THINK → "Samsung email is promotional, no reply needed. Reading third..."
        ACT   → gmail(read, messageId: "ghi789")
        EVAL  → goalComplete: false (need to reply to this one)

Step 6: THINK → "Replying to SyncBooks about financial report"
        ACT   → gmail(reply, messageId: "ghi789", body: "Thanks for flagging this...")
        EVAL  → goalComplete: true, confidence: 0.95

RESULT: "Done! I replied to 2 emails (Albert's design share and SyncBooks report).
         Skipped 1 promotional email from Samsung."
```

### Example 2: Research and Report

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Researcher',
  instructions: `You research topics thoroughly.
    For each research task:
    1. Search for multiple sources
    2. Read and analyze key findings
    3. Cross-reference information
    4. Compile a structured report
    5. Save findings to memory for future reference`,
  tools: ['web-search', 'save-note'],
  loop: {
    enabled: true,
    maxIterations: 12,
    timeout: 120000,
    completionThreshold: 0.85,
  },
});
```

**User says:** "Research the latest trends in AI agent frameworks for 2026"

**Loop execution:**
```
Step 1: web-search("AI agent frameworks 2026 trends")
Step 2: web-search("LangGraph vs CrewAI vs AutoGen 2026 comparison")
Step 3: web-search("new AI agent frameworks released 2026")
Step 4: reason → Synthesizing findings from 3 searches...
Step 5: save-note("AI Framework Trends 2026: 1. Multi-agent orchestration...")
Step 6: evaluate → goalComplete: true, confidence: 0.9

RESULT: "## AI Agent Framework Trends 2026
1. Multi-agent orchestration is dominant...
2. Memory systems evolved to vector-indexed...
3. Tool-use became the standard pattern..."
```

### Example 3: Project Setup Automation

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Project Manager',
  instructions: `You help set up and manage development projects.
    When asked to set up a project:
    1. Create the GitHub repo
    2. Set up initial issues/milestones
    3. Create Notion project page
    4. Add calendar events for deadlines
    5. Notify team on Slack`,
  tools: ['github', 'notion', 'google-calendar', 'slack'],
  loop: {
    enabled: true,
    maxIterations: 15,
    timeout: 180000,
    completionThreshold: 0.85,
    allowDelegation: true,
  },
});
```

**User says:** "Set up a new project called 'Kernova Mobile' with 3 milestones"

**Loop execution:**
```
Step 1:  github(createIssue, "Milestone 1: Core SDK") → ✓
Step 2:  github(createIssue, "Milestone 2: React Native Bindings") → ✓
Step 3:  github(createIssue, "Milestone 3: App Store Release") → ✓
Step 4:  notion(createPage, "Kernova Mobile Project") → ✓
Step 5:  notion(addBlock, project overview content) → ✓
Step 6:  google-calendar(create, "Milestone 1 deadline") → ✓
Step 7:  google-calendar(create, "Milestone 2 deadline") → ✓
Step 8:  google-calendar(create, "Milestone 3 deadline") → ✓
Step 9:  slack(sendMessage, "#dev channel: New project launched!") → ✓
Step 10: evaluate → goalComplete: true, confidence: 0.92

RESULT: "Project 'Kernova Mobile' is set up:
- 3 milestones created on GitHub
- Project page created in Notion
- 3 deadline events added to calendar
- Team notified on Slack #dev"
```

### Example 4: Data Collection and Analysis

```typescript
import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Data Analyst',
  instructions: `You collect and analyze data from multiple sources.
    Always verify findings from multiple angles.
    Save important findings to memory.`,
  tools: ['web-search', 'calculate', 'save-note'],
  loop: {
    enabled: true,
    maxIterations: 10,
    completionThreshold: 0.8,
  },
});
```

### Example 5: Conditional Loops (Simple Tasks = No Loop)

The loop is smart — if the goal is simple enough to complete in one step, it does:

**User says:** "What's the weather?"

```
Step 1: THINK → "Simple weather query, one tool call needed"
        ACT   → weather({ city: "Kumasi" })
        EVAL  → goalComplete: true, confidence: 0.95

RESULT: "It's 28°C in Kumasi, partly cloudy."
```

Only 1 iteration. The loop doesn't waste steps on simple tasks.

---

## Streaming Steps to the Client

When `streamSteps: true`, the client receives progress updates as each step completes. This gives users visibility into what the agent is doing:

```
[Step 1] Searching for unread emails...
[Step 2] Found 3 emails. Reading the first one from Albert...
[Step 3] Replying to Albert's design share...
[Step 4] Reading Samsung promotional email (skipping reply)...
[Step 5] Reading SyncBooks financial report...
[Step 6] Replying to SyncBooks...
✓ All done! Replied to 2 of 3 emails.
```

---

## Loop Result Object

When using the API directly, you get a full execution trace:

```typescript
import { executeLoop } from '@kernova/core';

const result = await executeLoop(goal, context, deps, config);

console.log(result);
// {
//   id: 'loop_1234567_abc',
//   goal: 'Reply to all unread emails',
//   status: 'completed',            // completed | failed | timeout | max_iterations
//   result: 'Replied to 2 of 3...',
//   steps: [...],                    // Full audit trail
//   iterations: 6,
//   totalDurationMs: 12500,
//   toolsUsed: ['gmail'],
//   agentsDelegated: [],
//   goalAchieved: true,
//   confidence: 0.95,
// }
```

### Step Object

```typescript
interface LoopStep {
  index: number;
  thought: string;           // What the agent was thinking
  action: {
    type: 'tool_call' | 'delegate' | 'reason' | 'evaluate';
    tool?: string;           // Which tool was called
    params?: object;         // Tool parameters
  };
  result: unknown;           // Tool output
  evaluation: {
    goalComplete: boolean;   // Did the agent think it's done?
    confidence: number;      // How sure (0-1)
    remaining?: string;      // What's left to do
    nextAction?: string;     // What it plans next
  };
  durationMs: number;
  timestamp: string;
}
```

---

## Using executeLoop Directly

For advanced use cases outside the framework:

```typescript
import { executeLoop } from '@kernova/core';

const result = await executeLoop(
  "Deploy the latest version to production",
  {
    agentName: 'DevOps',
    agentInstructions: 'You are a DevOps agent that deploys code safely...',
    availableTools: [
      { name: 'run-tests', description: 'Run the test suite' },
      { name: 'deploy', description: 'Deploy to environment' },
      { name: 'rollback', description: 'Rollback last deployment' },
    ],
    maxIterations: 8,
    goal: 'Deploy the latest version to production',
  },
  {
    complete: async (prompt) => {
      // Your LLM call
      return await openai.chat(prompt);
    },
    executeTool: async (name, params) => {
      // Your tool execution
      return await toolRegistry.execute(name, params);
    },
    delegate: async (agentName, input) => {
      // Delegation to another agent
      return await kernel.submit({ goal: input, targetAgent: agentName });
    },
  },
  {
    maxIterations: 8,
    timeout: 300000,  // 5 minutes for deployment
    completionThreshold: 0.9,
    onStep: (step) => {
      console.log(`[${step.index}] ${step.thought}`);
    },
    onProgress: ({ step, total, status }) => {
      updateProgressBar(step / total);
    },
  }
);
```

---

## Best Practices

### When to Use Loops

✅ **Good for:**
- Multi-step tasks ("reply to all emails", "set up a project")
- Tasks that require iteration ("research a topic from multiple angles")
- Tasks where completion isn't predictable ("find and fix all bugs")
- Autonomous workflows ("organize my inbox")

❌ **Not needed for:**
- Simple questions ("what's the weather?")
- Single-tool tasks ("send an email to X")
- Conversational replies
- Quick lookups

### Setting `maxIterations`

| Task Type | Suggested Max |
|-----------|--------------|
| Simple multi-step (2-3 tools) | 5 |
| Email batch processing | 15-20 |
| Research and analysis | 10-12 |
| Project setup | 15 |
| Complex orchestration | 20 |

### Setting `timeout`

| Task Type | Suggested Timeout |
|-----------|------------------|
| Quick tasks | 60000 (1 min) |
| Standard tasks | 120000 (2 min) |
| Complex processing | 180000 (3 min) |
| Heavy operations (deploy, research) | 300000 (5 min) |

### Setting `completionThreshold`

- `0.7` — Lenient. Agent stops quickly, might miss edge cases.
- `0.8` — Balanced. Good default for most tasks.
- `0.9` — Strict. Agent is thorough, may use more iterations.
- `0.95` — Very strict. Only for critical tasks where completeness matters.

---

## Loop vs Single-Pass

| Feature | Single-Pass (default) | Loop Mode |
|---------|----------------------|-----------|
| LLM calls | 1 | 1-N (per iteration) |
| Tool calls | 0-1 (via tool-calling) | Multiple across iterations |
| Self-evaluation | No | Yes (after each step) |
| Multi-step tasks | Limited | Full support |
| Cost | Lower | Higher (more API calls) |
| Latency | Fast | Varies (depends on steps) |
| Audit trail | None | Full step-by-step trace |

**Tip:** You can have some agents with loops enabled and others without. Use loops for task-heavy agents (email, project management) and single-pass for conversational agents (chat, Q&A).
