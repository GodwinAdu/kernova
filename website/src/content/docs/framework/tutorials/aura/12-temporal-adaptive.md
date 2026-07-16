---
title: "Temporal Intelligence & Adaptive Style"
description: "Make Aura understand time patterns, predict user needs, adapt communication style, and generate smart summaries."
---

# Part 12: Temporal Intelligence, Adaptive Style & Smart Summaries

This part covers the final three intelligence systems that make Aura feel truly personal — she understands your rhythms, mirrors your style, and produces actionable reports.

## What You'll Build

1. **Temporal Intelligence** — detects productivity patterns, energy cycles, and suggests optimal timing
2. **Adaptive Personality** — learns and mirrors the user's communication style
3. **Smart Summarization** — generates intelligent daily/weekly reports with action items

## Temporal Intelligence

Aura tracks temporal data points (energy, mood, productivity) and uses them to understand the user's natural rhythms.

### The Tool

Create `agents/tools/temporal-intelligence.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'temporal-intelligence',
  description: 'Analyze time-based patterns — productivity rhythms, energy cycles, optimal scheduling.',
  parameters: {
    action: {
      type: 'string',
      description: '"logMoment", "analyzeDay", "bestTimeFor", "overloadCheck", "rhythmReport", "predict"',
      required: true,
    },
    dataType: { type: 'string', description: 'energy, mood, productivity, focus, sleep', required: false },
    value: { type: 'string', description: 'Value (1-10 or descriptive)', required: false },
    activity: { type: 'string', description: 'Activity to find best time for', required: false },
    day: { type: 'string', description: 'Day to analyze', required: false },
  },
  execute: async ({ action, dataType, value, activity, day }, ctx) => {
    const backendUrl = process.env.KERNOVA_URL || 'http://localhost:4555';
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    switch (action) {
      case 'logMoment': {
        // Store timestamped data point with time-of-day tag
        await fetch(`${backendUrl}/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `[TEMPORAL] ${dataType}: ${value} at ${now.toLocaleTimeString()} on ${currentDay}`,
            tags: ['temporal', dataType, currentDay, getTimeOfDay(currentHour)],
            namespace: 'temporal',
          }),
        });
        return { logged: true, type: dataType, value, time: now.toLocaleTimeString() };
      }

      case 'bestTimeFor': {
        // Search historical data + use chronobiology defaults
        const activityType = categorizeActivity(activity);
        return {
          activity,
          suggestion: getSuggestedTime(activityType),
          instruction: 'Recommend optimal time based on user patterns and general chronobiology.',
        };
      }

      case 'predict': {
        // Based on time + day + history, predict what user needs
        return {
          currentTime: now.toLocaleTimeString(),
          currentDay,
          timeOfDay: getTimeOfDay(currentHour),
          instruction: 'Predict what the user likely needs right now based on time patterns.',
        };
      }
      // ... more actions
    }
  },
});

function getTimeOfDay(hour) {
  if (hour < 9) return 'morning';
  if (hour < 12) return 'late-morning';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'night';
}

function categorizeActivity(activity) {
  if (/deep work|coding|writing/.test(activity)) return 'creative-focus';
  if (/exercise|workout/.test(activity)) return 'physical';
  if (/meeting|call/.test(activity)) return 'social-performance';
  return 'general';
}

function getSuggestedTime(type) {
  const suggestions = {
    'creative-focus': 'Morning (8-11am) — cortisol peaks support focused work',
    'physical': 'Late afternoon (4-6pm) — body temperature peaks',
    'social-performance': 'Mid-morning (10am-12pm) — alertness high',
  };
  return suggestions[type] || 'Depends on your patterns — log more data';
}
```

### Agent Instructions

Add to Aura's instructions:

```
TEMPORAL INTELLIGENCE

PROACTIVE LOGGING:
- When user mentions feeling tired/energized → log energy silently
- When user mentions being productive/unfocused → log productivity
- Don't announce "I'm logging" — just do it

PROACTIVE INSIGHTS:
- Late night + working → "It's 11pm. Your data shows more errors after 10pm."
- User asks to schedule → check their peak hours first
- Morning greeting → predict what they need based on time/day
```

### How It Works

```
User: "I'm feeling really focused right now"
Aura: [silently logs: energy=high, time=9:30am, day=Tuesday]
      "Great! This is your peak focus window based on your patterns.
       Want me to block the next 2 hours for deep work?"

--- 2 weeks later ---

User: "When should I schedule my coding session?"
Aura: [checks temporal data]
      "Based on your history, you're most focused on Tuesday and Wednesday
       mornings (9-11am). You tend to dip after lunch on Mondays.
       I'd suggest scheduling coding for tomorrow morning."
```

## Adaptive Communication Style

After observing the user's messages, Aura mirrors their style — short/long, emoji/no emoji, casual/formal.

### The Tool

Create `agents/tools/adaptive-style.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'adaptive-style',
  description: 'Analyze and adapt to user communication style.',
  parameters: {
    action: { type: 'string', description: '"analyze", "getProfile", "apply"', required: true },
    messages: { type: 'string', description: 'JSON array of recent messages to analyze', required: false },
  },
  execute: async ({ action, messages }, ctx) => {
    if (action === 'analyze') {
      const msgs = JSON.parse(messages);
      const avgLength = msgs.reduce((s, m) => s + m.length, 0) / msgs.length;
      const hasEmoji = msgs.some(m => /[\u{1F600}-\u{1F6FF}]/u.test(m));
      const hasSlang = msgs.some(m => /gonna|wanna|btw|lol/i.test(m));

      const profile = {
        length: avgLength < 50 ? 'short' : avgLength < 150 ? 'medium' : 'long',
        emoji: hasEmoji ? 'uses-emoji' : 'no-emoji',
        formality: hasSlang ? 'casual' : 'professional',
      };

      // Save to memory
      await saveProfile(profile);
      return { profile };
    }

    if (action === 'apply') {
      const profile = await getProfile();
      if (!profile) return { guidelines: 'Use balanced defaults.' };

      return {
        guidelines: [
          profile.length === 'short' ? 'Keep responses concise' : 'Provide thorough detail',
          profile.emoji === 'uses-emoji' ? 'Use emojis naturally' : 'Avoid emojis',
          profile.formality === 'casual' ? 'Use casual, friendly tone' : 'Professional tone',
        ].join('. '),
      };
    }
  },
});
```

### The Result

After ~50 messages, if the user always writes short casual messages with emojis, Aura responds the same way. If the user is formal and detailed, Aura adapts.

**User who writes casually:**
```
User: "hey whats tmrw look like"
Aura: "pretty chill! just your standup at 10 and coding block at 2. want me to add anything? 🗓️"
```

**Same user if they were formal:**
```
User: "Could you provide an overview of my schedule for tomorrow?"
Aura: "Certainly. Tomorrow's schedule includes a standup meeting at 10:00 AM
       and a coding block from 2:00-4:00 PM. Would you like me to add or adjust anything?"
```

## Smart Summarization Pipeline

Not just "here's what happened" — but "here's what MATTERS and what you should DO."

### The Tool

Create `agents/tools/smart-summary.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'smart-summary',
  description: 'Generate intelligent reports: daily reviews, weekly summaries, project status.',
  parameters: {
    action: { type: 'string', description: '"daily", "weekly", "project", "inbox", "custom"', required: true },
    topic: { type: 'string', description: 'For project/custom summaries', required: false },
  },
  execute: async ({ action, topic }, ctx) => {
    switch (action) {
      case 'daily':
        return {
          instruction: `Create end-of-day report:
            1. What was accomplished vs planned
            2. What's carrying over to tomorrow
            3. Key decisions made today
            4. Tomorrow's top 3 priorities
            5. One insight or pattern noticed`,
        };
      case 'weekly':
        return {
          instruction: `Create weekly review:
            1. Progress vs goals (% achieved)
            2. Top 3 wins
            3. What didn't get done and why
            4. Patterns noticed
            5. Next week focus areas`,
        };
    }
  },
});
```

### Smart vs Dumb Summaries

**Dumb summary (typical chatbot):**
```
"Today you had 3 meetings, received 12 emails, and completed 2 tasks."
```

**Smart summary (Aura):**
```
"Today's focus: 65% of planned tasks completed.

🏆 Key win: Deployed Kernova v1.8 — this unblocks the SyncBooks integration.

⚠️ Carrying over: The API documentation (blocked by Albert's PR review).
   Suggested action: Message Albert tonight — he's usually responsive evenings.

📊 Pattern: Third day this week with >6 meetings. Your deep work has dropped
   from 3h to 1h this week. Consider blocking tomorrow afternoon.

Tomorrow's priorities:
1. Albert PR review → unblocks documentation
2. Kernova Cloud deploy (already prepped)
3. 30min Bible reading (behind 2 chapters this week)"
```

The difference: the smart summary **prioritizes by impact**, **connects to goals**, **notices patterns**, and **suggests specific actions**.

## Wiring It All Together

Update Aura's tools array:

```typescript
tools: [...existing, 'temporal-intelligence', 'adaptive-style', 'smart-summary'],
```

Add instructions:

```
TEMPORAL INTELLIGENCE
- Log energy/mood silently when user mentions it
- Predict needs based on time of day
- Suggest optimal scheduling from patterns

ADAPTIVE STYLE
- Mirror the user's communication length, tone, emoji usage
- Don't announce adaptation — just do it naturally

SMART SUMMARIES
- "How was my day?" → smart-summary action:"daily"
- "Weekly review" → smart-summary action:"weekly"
- "Kernova status?" → smart-summary action:"project" topic:"Kernova"
```

## Exercise

1. Tell Aura "I'm feeling really productive right now" — check if she logs it silently
2. Ask "When should I do deep work?" — see temporal recommendations
3. Ask "Give me my daily summary" — see if it's actionable, not just a list
4. After 10+ messages, ask Aura to check your style profile
5. Ask "Am I overloaded this week?" — see the overload analysis

## What You've Built

Aura now has genuine intelligence:
- **35 tools** across every life domain
- **11 specialist agents** with deep expertise
- **7 intelligence systems** that learn and adapt
- **Temporal awareness** that understands time
- **Adaptive personality** that mirrors the user
- **Actionable reports** that drive decisions

This isn't a chatbot. This is a personal AI operating system.
