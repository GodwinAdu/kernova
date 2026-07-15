---
title: Autonomous Triggers
description: Make Aura proactive — scheduled triggers check email, prepare for meetings, and send daily briefings automatically.
---

## What You'll Build

Nine autonomous triggers that make Aura proactive. She'll check your inbox every 10 minutes, prepare you for upcoming meetings, send morning briefings, and nudge you about habits — all without you asking.

## What Are Triggers?

Triggers are scheduled goals fired at intervals. Unlike tools (which the agent calls reactively), triggers fire automatically on a schedule and give the agent a *goal* to accomplish.

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'trigger-name',
  description: 'What this trigger does',
  event: 'schedule.10m',        // When it fires
  agent: 'assistant',           // Which agent executes it
  goal: 'Natural language goal the agent should achieve',
  priority: 'medium',
  cooldown: 600000,             // Minimum ms between firings
});
```

The `event` field supports: `schedule.5m`, `schedule.10m`, `schedule.30m`, `schedule.1h`, `schedule.6h`, `schedule.12h`, `schedule.24h`, `schedule.weekly`.

The `goal` is a natural language prompt — the agent uses all its tools to accomplish it.

## Trigger 1: Email Monitor (every 10 minutes)

Create `agents/triggers/email-monitor.ts`:

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'email-monitor',
  description: 'Check inbox for new unread emails. Notify about important ones.',
  event: 'schedule.10m',
  agent: 'assistant',
  goal: `Check Gmail for UNREAD emails from the LAST HOUR using gmail tool (action: "search", query: "is:unread newer_than:1h").

RULES:
1. Only look at emails received in the last hour
2. Check notes for "processed-emails" — skip any IDs already there
3. For genuinely NEW emails from real people: notify-user with a brief message
4. Combine multiple new emails into ONE notification
5. Archive newsletters silently
6. Save processed IDs to memory (tag: "processed-emails")
7. If nothing new, do absolutely nothing

Example notification: "Hey! 2 new emails: John asking about the meeting, and a shipping notification."`,
  priority: 'medium',
  cooldown: 600000,
});
```

**Why track processed IDs?** Without this, every 10-minute check would re-notify about the same emails. Saving IDs to memory prevents duplicates.

## Trigger 2: Email Digest (every 6 hours)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'email-digest',
  description: 'Compile an email digest — what came in, what was handled, what needs attention.',
  event: 'schedule.6h',
  agent: 'assistant',
  goal: `Search inbox for emails from the last 6 hours. Classify each:
- ✅ Handled (auto-archived/replied)
- ⚠️ Needs attention (requires user response)
- 📋 FYI (informational)

Create a brief digest and save to memory. If urgent items exist, notify the user.`,
  priority: 'low',
  cooldown: 21600000,
});
```

## Trigger 3: Calendar Prep (every hour)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'calendar-prep',
  description: 'Prepare user for upcoming meetings.',
  event: 'schedule.1h',
  agent: 'assistant',
  goal: `Check Google Calendar for events in the next 2 hours.

IMPORTANT: Don't repeat reminders. Check conversation history — if you already reminded about an event, skip it.

For new upcoming events:
- Meetings: "Heads up — you have [meeting] in [time]. Last time you discussed [context]."
- Personal: "Don't forget: [event] in [time]"

Send via notify-user only if there's something NEW. If nothing, do nothing.`,
  priority: 'medium',
  cooldown: 3600000,
});
```

## Trigger 4: Morning Briefing (daily)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'morning-briefing',
  description: 'Daily personalized morning briefing.',
  event: 'schedule.24h',
  agent: 'assistant',
  goal: `Generate a morning briefing via notify-user:

"Good morning [name]! ☀️ Here's your day:
- [calendar events]
- [pending goals/reminders]
- [weather for their location]
Quick thought: [motivational line based on what you know about them]"

Use their name from memory. Keep it 5-8 lines. Warm and actionable.`,
  priority: 'medium',
  cooldown: 86400000,
});
```

## Trigger 5: Daily Report (daily)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'daily-report',
  description: 'End-of-day summary via email.',
  event: 'schedule.24h',
  agent: 'assistant',
  goal: `Generate a daily report. Include:
1. Warm greeting using their name
2. Today's date
3. Completed events/tasks
4. Goal progress
5. Weather tomorrow
6. Motivational insight

Send to their email using send-email. If no email stored, save to memory instead.`,
  priority: 'medium',
  cooldown: 86400000,
});
```

## Trigger 6: Evening Habit Check (daily)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'evening-habit-check',
  description: 'Evening check-in about daily habits.',
  event: 'schedule.24h',
  agent: 'assistant',
  goal: 'Do a gentle evening check-in. Ask: Did you exercise today? How much water? What time are you sleeping? Save responses for tracking.',
  priority: 'low',
  cooldown: 86400000,
});
```

## Trigger 7: Smart Reply (every 30 minutes)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'smart-reply',
  description: 'Draft replies for emails that need responses.',
  event: 'schedule.30m',
  agent: 'assistant',
  goal: `Check for emails from known contacts that need replies.

For emails needing response:
- Understand context
- Check memory for relationship with sender
- Draft appropriate reply matching user's style

Based on settings:
- If autoSendEmail enabled → send via gmail reply
- If NOT → save as draft to memory (tag: "draft-reply")

RULES:
- Never auto-reply to emails user hasn't seen unless auto-send is ON
- Match tone of original email
- For complex/sensitive emails → ALWAYS save as draft, never auto-send`,
  priority: 'low',
  cooldown: 1800000,
});
```

## Trigger 8: Proactive Check (every 12 hours)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'proactive-check',
  description: 'Helpful nudges based on goals and habits.',
  event: 'schedule.12h',
  agent: 'assistant',
  goal: `Based on what you know about the user:
- Fitness goals + no exercise logged → gentle nudge
- Reminders due soon → heads-up
- Recent stress → supportive message
- Upcoming event → brief preparation

IMPORTANT: Don't be annoying. Only reach out if genuinely useful.
If nothing notable, do nothing.`,
  priority: 'low',
  cooldown: 43200000,
});
```

## Trigger 9: Weekly Summary (Sunday)

```typescript
import { defineTrigger } from '@kernova/framework';

export default defineTrigger({
  name: 'weekly-summary',
  description: 'Comprehensive weekly summary every Sunday.',
  event: 'schedule.weekly',
  agent: 'assistant',
  goal: `Generate weekly summary email:
1. Accomplishments this week (from memory)
2. Goals progress
3. Health/habit streaks
4. Financial summary (if tracking expenses)
5. New things learned about user
6. Suggestions for next week

Send via email (subject: "Your Week with Aura — [date range]").
If no email stored, save to memory.`,
  priority: 'low',
  cooldown: 604800000,
});
```

## Respecting User Settings

Triggers check the `autonomousMode` setting before acting. In Aura's instructions:

```
When running autonomously (via triggers):
- Check if autonomousMode is enabled
- If disabled, save findings to memory but don't notify
- Respect quiet hours (don't notify between 11pm-7am)
```

The permission check happens inside each tool (Gmail, Calendar, etc.), so triggers that are blocked simply return "autonomous mode disabled" without taking action.

## How Triggers Avoid Repeating

The email monitor saves processed IDs to memory:

```
save-note(content: "Processed email IDs: abc123, def456", tags: "processed-emails")
```

Next time it fires, it searches for that tag and skips known IDs. This pattern works for any trigger that processes items.

## The notify-user Tool

Trigger results reach the user through `notify-user`:

```typescript
// Adds a message to the chat thread + sends push notification
await fetch(`${backendUrl}/threads/main-chat/messages`, {
  method: 'POST',
  body: JSON.stringify({ role: 'assistant', content: message }),
});
```

When the user opens the chat, they see Aura's proactive messages waiting — like text messages from a friend.

## Testing Triggers

Triggers fire on schedule during `kernova dev`. Watch the terminal:

```
[trigger] email-monitor fired (schedule.10m)
[trigger] → searching unread emails...
[trigger] → found 2 new emails, notifying user
[trigger] email-monitor completed (1.2s)
```

To test immediately without waiting, hit the agent endpoint with the trigger's goal:

```bash
curl -X POST http://localhost:4555/agents/assistant -H "Content-Type: application/json" \
  -d '{"input":"Check my inbox for unread emails from the last hour and notify me about important ones."}'
```

## Exercise

1. Create all 9 trigger files in `agents/triggers/`
2. Run `kernova dev` and watch the terminal — see triggers fire on schedule
3. Send yourself a test email and wait 10 minutes — verify the email monitor notifies you
4. Toggle `autonomousMode` off in settings — verify triggers respect it
5. Create a custom trigger for something you'd want (social media check, stock price alert, etc.)

Next: we'll build the frontend and deploy to production.
