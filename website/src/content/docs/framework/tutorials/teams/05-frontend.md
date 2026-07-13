---
title: "Step 4: Build the Chat UI"
description: "Create a frontend that sends tasks to the team and shows real-time progress."
---

# Step 4: Build the Chat UI

Now let's build a frontend where users can give tasks to the team and watch the agents work in real-time.

---

## The Team Dashboard

Replace `app/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTeam } from '@kernova/framework/react';

export default function TeamDashboard() {
  const [input, setInput] = useState('');
  const { execute, isRunning, progress, result, error, reset } = useTeam('dev-team');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning) return;

    await execute(input.trim());
    setInput('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Coding Team
          </h1>
          <p className="text-gray-400 mt-1">
            Give your team a task — they'll decompose, build, and review it together.
          </p>
        </header>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g., Build a user settings page with password change"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isRunning}
            />
            <button
              type="submit"
              disabled={isRunning || !input.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
            >
              {isRunning ? 'Working...' : 'Execute'}
            </button>
          </div>
        </form>

        {/* Progress Feed */}
        {progress.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Team Activity
            </h2>
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 space-y-2 max-h-64 overflow-y-auto">
              {progress.map((event, i) => (
                <ProgressEvent key={i} event={event} />
              ))}
              {isRunning && (
                <div className="flex items-center gap-2 text-gray-400">
                  <span className="animate-pulse">●</span>
                  <span className="text-sm">Working...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-8 p-4 bg-red-900/30 border border-red-800 rounded-lg">
            <p className="text-red-300 text-sm">{error.message}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                Result
              </h2>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Tasks: {result.totalTasks}</span>
                <span>Duration: {Math.round(result.duration / 1000)}s</span>
                <button
                  onClick={reset}
                  className="text-blue-400 hover:text-blue-300"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-200 font-mono leading-relaxed">
                {result.result}
              </pre>
            </div>
          </div>
        )}

        {/* Team Info */}
        <div className="border-t border-gray-800 pt-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Team Members
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <TeamMemberCard name="Senior Dev" role="Lead" color="blue" />
            <TeamMemberCard name="Frontend Dev" role="Member" color="green" />
            <TeamMemberCard name="Backend Dev" role="Member" color="purple" />
            <TeamMemberCard name="QA Engineer" role="Reviewer" color="orange" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-Components ───────────────────────────────────────

function ProgressEvent({ event }: { event: any }) {
  const icons: Record<string, string> = {
    'task-assigned': '📋',
    'task-completed': '✅',
    'delegation': '🔀',
    'review': '🔍',
    'error': '❌',
    'completed': '🎉',
  };

  const colors: Record<string, string> = {
    'senior-dev': 'text-blue-400',
    'frontend-dev': 'text-green-400',
    'backend-dev': 'text-purple-400',
    'tester': 'text-orange-400',
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{icons[event.type] || '●'}</span>
      <span className={`font-mono text-xs ${colors[event.agent] || 'text-gray-400'}`}>
        {event.agent || 'system'}
      </span>
      <span className="text-gray-400">
        {formatEventType(event.type)}
      </span>
    </div>
  );
}

function TeamMemberCard({ name, role, color }: { name: string; role: string; color: string }) {
  const bgColors: Record<string, string> = {
    blue: 'bg-blue-900/30 border-blue-800',
    green: 'bg-green-900/30 border-green-800',
    purple: 'bg-purple-900/30 border-purple-800',
    orange: 'bg-orange-900/30 border-orange-800',
  };

  return (
    <div className={`p-3 rounded-lg border ${bgColors[color]}`}>
      <p className="text-sm font-medium text-white">{name}</p>
      <p className="text-xs text-gray-400">{role}</p>
    </div>
  );
}

function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    'task-assigned': 'received task',
    'task-completed': 'finished',
    'delegation': 'delegated work',
    'review': 'reviewing output',
    'error': 'encountered error',
    'completed': 'team finished!',
  };
  return labels[type] || type;
}
```

---

## How It Works

1. User types a goal → clicks "Execute"
2. `useTeam('dev-team')` sends a POST to `/v1/teams/dev-team/execute`
3. Server returns an SSE stream with progress events
4. Each event updates the `progress` array in real-time
5. When done, `result` is populated with the final output

The user sees which agent is working, when delegations happen, and when reviews occur — all in real-time.

---

## Try It

```bash
kernova dev
```

Open `http://localhost:3000` and try:

- "Build a todo list with add, edit, delete"
- "Create a login page with email/password validation"
- "Build a dashboard with a chart showing weekly activity"
- "Create a blog post editor with markdown preview"

Watch the progress feed — you'll see the senior dev decompose, the specialists work, and the review happen.

---

## What the Progress Feed Looks Like

```
📋 senior-dev    received task
✅ senior-dev    finished
🔀 senior-dev    delegated work
📋 frontend-dev  received task
📋 backend-dev   received task
📋 tester        received task
✅ frontend-dev  finished
✅ backend-dev   finished
✅ tester        finished
🔍 senior-dev    reviewing output
✅ senior-dev    finished
🎉 system        team finished!
```

---

[Continue to Step 5: Deploy →](/framework/tutorials/teams/06-deploy)
