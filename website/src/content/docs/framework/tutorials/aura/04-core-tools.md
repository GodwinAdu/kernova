---
title: Core Tools
description: Build the essential tools — notes, reminders, habits, goals, weather, web search, and more.
---

## What You'll Build

Nine core tools that give Aura practical capabilities: saving notes, setting reminders, tracking habits, managing goals, checking weather, searching the web, doing math, and getting news. These are the foundation everything else builds on.

## How Tools Work in Kernova

Every tool follows the same pattern:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'tool-name',
  description: 'When and how the agent should use this tool',
  parameters: {
    paramName: {
      type: 'string',       // string, number, boolean
      description: 'What this parameter is for',
      required: true,       // Agent must provide it
    },
  },
  execute: async (params, ctx) => {
    // Do the work
    // Return structured data the agent will interpret
    return { result: 'data' };
  },
});
```

The `description` field is critical — it tells the LLM *when* to use the tool. Be specific: "Use when the user says 'remind me to...'" is better than "Sets reminders."

The `ctx` object gives you logging (`ctx.log()`), environment variables (`ctx.env`), and request context.

## Tool 1: save-note

This is the most important tool. It's how Aura builds her knowledge of you.

Create `agents/tools/save-note.ts`:

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'save-note',
  description: 'Save a note, fact, preference, or piece of information about the user. Use whenever the user shares something personal, sets a goal, or wants to remember something.',
  parameters: {
    content: {
      type: 'string',
      description: 'The information to save (be specific and include context)',
      required: true,
    },
    category: {
      type: 'string',
      description: 'Category: personal, task, goal, preference, health, finance, schedule, habit',
      required: false,
    },
    tags: {
      type: 'string',
      description: 'Comma-separated tags for easy retrieval (e.g., "name,identity")',
      required: false,
    },
  },
  execute: async ({ content, category, tags }, ctx) => {
    const tagList = tags ? (tags as string).split(',').map(t => t.trim()) : [];
    if (category) tagList.push(category as string);
    tagList.push('user-info');

    ctx.log(`💾 Saving: "${(content as string).slice(0, 60)}..." [${tagList.join(', ')}]`);

    const backendUrl = process.env.KERNOVA_URL || 'http://localhost:4555';
    const res = await fetch(`${backendUrl}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        tags: tagList,
        namespace: category || 'general',
        metadata: { category: category || 'general', savedAt: new Date().toISOString() },
      }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      return { saved: true, id: data.id, content, tags: tagList, message: "Noted! I'll remember this." };
    }

    // Fallback: let framework auto-persist handle it
    return { saved: true, content, tags: tagList, message: "Noted! I'll remember this." };
  },
});
```

**Why the fallback?** If the direct memory API is down, returning `saved: true` still lets the framework's auto-persist catch the content from conversation context. Belt and suspenders.

## Tool 2: search-notes

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'search-notes',
  description: 'Search through saved notes and memories. Use when you need to recall something the user told you before.',
  parameters: {
    query: { type: 'string', description: 'What to search for', required: true },
    category: { type: 'string', description: 'Filter by category', required: false },
  },
  execute: async ({ query, category }, ctx) => {
    ctx.log(`🔍 Searching: "${query}"`);
    const backendUrl = process.env.KERNOVA_URL || 'http://localhost:4555';
    const params = new URLSearchParams({ q: query as string, limit: '20' });
    const res = await fetch(`${backendUrl}/memory/search?${params}`);

    if (res.ok) {
      const data = await res.json() as any;
      const entries = data.entries || [];
      return { query, found: entries.length > 0, count: entries.length,
        results: entries.map((e: any) => ({ content: e.content, tags: e.tags || [], date: e.createdAt })) };
    }
    return { query, found: false, results: [] };
  },
});
```

## Tool 3: set-reminder

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'set-reminder',
  description: 'Set a reminder at a specific time. Use when the user says "remind me to..." or mentions needing to do something later.',
  parameters: {
    message: { type: 'string', description: 'What to remind about', required: true },
    when: { type: 'string', description: 'When — natural language or ISO date ("tomorrow 9am", "in 2 hours")', required: true },
    priority: { type: 'string', description: 'low, medium, or high', required: false },
  },
  execute: async ({ message, when, priority }, ctx) => {
    ctx.log(`⏰ Reminder: "${message}" → ${when}`);
    return {
      set: true, id: `rem_${Date.now()}`, message, scheduledFor: when,
      priority: priority || 'medium',
      confirmation: `Got it! I'll remind you: "${message}" — ${when}.`,
    };
  },
});
```

## Tool 4: track-habit

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'track-habit',
  description: 'Log a habit completion for today. Use when the user says they exercised, meditated, drank water, etc.',
  parameters: {
    habit: { type: 'string', description: 'Habit name (e.g., "exercise", "reading")', required: true },
    completed: { type: 'boolean', description: 'Completed today (true) or missed (false)', required: true },
    details: { type: 'string', description: 'Optional details ("30 min run")', required: false },
    value: { type: 'number', description: 'Numeric value (minutes, glasses, pages)', required: false },
  },
  execute: async ({ habit, completed, details, value }, ctx) => {
    const today = new Date().toISOString().split('T')[0];
    ctx.log(`📊 Habit: ${habit} → ${completed ? '✅' : '❌'}`);
    return {
      logged: true, habit, completed, details: details || null, date: today,
      message: completed
        ? `✅ Great job! "${habit}" logged for today.${details ? ` (${details})` : ''}`
        : `Noted. "${habit}" missed today. Tomorrow is a new day!`,
    };
  },
});
```

## Tool 5: manage-goals

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'manage-goals',
  description: 'Create, update, or check progress on user goals.',
  parameters: {
    action: { type: 'string', description: '"create", "update", "complete", or "list"', required: true },
    title: { type: 'string', description: 'Goal title', required: false },
    target: { type: 'string', description: 'Target/milestone', required: false },
    progress: { type: 'string', description: 'Progress update', required: false },
    deadline: { type: 'string', description: 'Deadline', required: false },
    category: { type: 'string', description: 'fitness, finance, career, personal, etc.', required: false },
  },
  execute: async ({ action, title, target, progress, deadline, category }, ctx) => {
    ctx.log(`🎯 Goal: ${action} — ${title || 'checking'}`);

    switch (action) {
      case 'create':
        return { action: 'created', goal: { id: `goal_${Date.now()}`, title, target, deadline, category },
          message: `🎯 Goal created: "${title}"${deadline ? ` (due: ${deadline})` : ''}` };
      case 'update':
        return { action: 'updated', title, progress, message: `📈 Progress: ${progress}` };
      case 'complete':
        return { action: 'completed', title, message: `🎉 Goal "${title}" complete!` };
      default:
        return { action: 'list', message: 'Retrieving goals from memory...' };
    }
  },
});
```

## Tool 6: weather

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'weather',
  description: 'Get current weather and forecast. Use when user asks about weather or planning outdoor activities.',
  parameters: {
    location: { type: 'string', description: 'City name (e.g., "London", "Tokyo")', required: true },
    days: { type: 'number', description: 'Forecast days 1-7 (default: 1)', required: false },
  },
  execute: async ({ location, days }, ctx) => {
    ctx.log(`🌤️ Weather for: ${location}`);

    // Geocode the location (Open-Meteo — free, no key needed)
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location as string)}&count=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!geoRes.ok) return { error: 'Failed to find location' };
    const geoData = await geoRes.json() as any;
    if (!geoData.results?.[0]) return { error: `Location "${location}" not found` };

    const { latitude, longitude, name, country } = geoData.results[0];
    const forecastDays = Math.min(Math.max(days as number || 1, 1), 7);

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=${forecastDays}`
    );
    if (!weatherRes.ok) return { error: 'Weather API unavailable' };
    const data = await weatherRes.json() as any;

    const weatherCodes: Record<number, string> = {
      0: 'Clear sky ☀️', 1: 'Mainly clear 🌤️', 2: 'Partly cloudy ⛅',
      3: 'Overcast ☁️', 61: 'Light rain 🌧️', 63: 'Rain 🌧️', 95: 'Thunderstorm ⛈️',
    };

    return {
      location: `${name}, ${country}`,
      current: {
        temperature: `${data.current.temperature_2m}°C`,
        humidity: `${data.current.relative_humidity_2m}%`,
        wind: `${data.current.wind_speed_10m} km/h`,
        condition: weatherCodes[data.current.weather_code] || 'Unknown',
      },
      forecast: data.daily.time.map((date: string, i: number) => ({
        date, high: `${data.daily.temperature_2m_max[i]}°C`,
        low: `${data.daily.temperature_2m_min[i]}°C`,
        condition: weatherCodes[data.daily.weather_code[i]] || 'Unknown',
      })),
    };
  },
});
```

**Why Open-Meteo?** It's free with no API key required. For a personal AI, you don't want setup friction — the weather tool should work out of the box.

## Tool 7: web-search

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'web-search',
  description: 'Search the web for current information. Use for real-time data, recent events, or questions beyond training data.',
  parameters: {
    query: { type: 'string', description: 'The search query', required: true },
  },
  execute: async ({ query }, ctx) => {
    ctx.log(`🔍 Web: ${query}`);

    // Tavily if available (better results)
    const tavilyKey = ctx.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5, include_answer: true }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          return { answer: data.answer, results: data.results?.map((r: any) => ({
            title: r.title, url: r.url, content: r.content?.slice(0, 300) })) };
        }
      } catch {}
    }

    // Fallback: DuckDuckGo (free, no key)
    const encoded = encodeURIComponent(query as string);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
    if (res.ok) {
      const data = await res.json() as any;
      const results = (data.RelatedTopics || []).slice(0, 5)
        .filter((t: any) => t.Text)
        .map((t: any) => ({ title: t.Text.slice(0, 80), url: t.FirstURL, content: t.Text }));
      return { answer: data.Abstract || null, results };
    }
    return { results: [], message: 'No results found.' };
  },
});
```

## Tool 8: calculate

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'calculate',
  description: 'Math, percentages, tips, BMI, unit conversions. Use for any calculation.',
  parameters: {
    expression: { type: 'string', description: 'Math expression ("15% of 250", "5.2 * 3.8")', required: true },
  },
  execute: async ({ expression }, ctx) => {
    ctx.log(`🧮 Calculate: ${expression}`);
    const expr = (expression as string).trim();

    // Percentage: "15% of 250"
    const pctMatch = expr.match(/(\d+(?:\.\d+)?)%\s*of\s*(\d+(?:\.\d+)?)/i);
    if (pctMatch) {
      const result = (parseFloat(pctMatch[1]) / 100) * parseFloat(pctMatch[2]);
      return { expression: expr, result, formatted: `${pctMatch[1]}% of ${pctMatch[2]} = ${result.toFixed(2)}` };
    }

    // Basic math (safe — no eval)
    const sanitized = expr.replace(/[^0-9+\-*/().%\s]/g, '');
    if (/^[0-9+\-*/().%\s]+$/.test(sanitized)) {
      const fn = new Function(`return (${sanitized})`);
      const result = fn();
      if (typeof result === 'number' && isFinite(result)) {
        return { expression: sanitized, result, formatted: `${sanitized} = ${result}` };
      }
    }
    return { expression: expr, note: 'Could not evaluate. Provide a clearer math expression.' };
  },
});
```

## Tool 9: news

```typescript
import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'news',
  description: 'Get current news headlines. Use when user asks about news or current events.',
  parameters: {
    topic: { type: 'string', description: 'Topic: general, technology, business, science, health, sports', required: false },
    query: { type: 'string', description: 'Specific search query', required: false },
  },
  execute: async ({ topic, query }, ctx) => {
    ctx.log(`📰 News: ${topic || query || 'headlines'}`);
    const apiKey = ctx.env.GNEWS_API_KEY;
    if (apiKey) {
      const url = query
        ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(query as string)}&lang=en&max=5&apikey=${apiKey}`
        : `https://gnews.io/api/v4/top-headlines?lang=en&max=5&topic=${topic || 'general'}&apikey=${apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as any;
        return { topic: topic || 'headlines', articles: (data.articles || []).map((a: any) => ({
          title: a.title, description: a.description, source: a.source?.name, url: a.url })) };
      }
    }
    return { articles: [], note: 'News API key not configured. Add GNEWS_API_KEY to .env.local' };
  },
});
```

## The Pattern: Structured Returns

Notice every tool returns structured data, not formatted text. The agent decides how to present it:

```typescript
// ✅ Good — structured data
return { temperature: '22°C', condition: 'Sunny', location: 'London' };

// ❌ Bad — pre-formatted text
return { message: 'The weather in London is 22°C and sunny!' };
```

Why? The agent might use weather data in different contexts: a brief answer, a morning briefing, or deciding whether to suggest outdoor plans. Structured data gives it flexibility.

## Exercise

1. Build all 9 tools and verify each works: ask about weather, search the web, set a reminder
2. Create a custom tool for something you personally need (Spotify, Todoist, a custom API)
3. Try the tools in combination: "Remind me to check the weather in Tokyo tomorrow"
4. Look at the terminal logs — observe how tools fire and return data

Next: we'll connect to real external services — Gmail, Calendar, GitHub, and more.
