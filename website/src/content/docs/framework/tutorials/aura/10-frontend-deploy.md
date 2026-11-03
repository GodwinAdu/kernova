---
title: Chat UI & Deployment
description: Build the Next.js frontend — chat interface, memory browser, activity page, settings, and deploy to production.
---

## What You'll Build

The complete frontend: a streaming chat interface, memory browser, activity log, settings page, and push notifications. Then deploy everything to production.

## Next.js App Structure

Aura uses the App Router with rewrites to the Kernova backend:

```
app/
├── chat/page.tsx       # Main chat interface
├── memory/page.tsx     # Browse and search memories
├── activity/page.tsx   # Loop traces, tool usage, trigger log
├── settings/page.tsx   # Integrations, permissions, preferences
├── layout.tsx          # Shell with navigation
├── providers.tsx       # Context providers
├── api/
│   ├── auth/           # Google OAuth endpoints
│   ├── settings/       # Settings CRUD
│   ├── memories/       # Memory browsing API
│   ├── notifications/  # Notification store
│   └── webhooks/       # WhatsApp incoming
└── globals.css
```

Configure rewrites in `next.config.ts` to proxy agent requests:

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/kernova/:path*', destination: 'http://localhost:4555/:path*' },
    ];
  },
};

export default nextConfig;
```

## The Chat Page

The chat page is the heart of Aura. It needs streaming responses, conversation history, and notification handling.

```tsx
'use client';
import { useAgentStream } from '@kernova/framework/react';
import { useState, useEffect, useRef } from 'react';

export default function ChatPage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [notification, setNotification] = useState<string | null>(null);

  const { messages, send, isStreaming, streamingContent } = useAgentStream('assistant', {
    threadId: 'main-chat',
    // Auto-scroll to bottom when a reply finishes
    onComplete: () => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }),
  });

  // Poll for trigger notifications
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch('/api/notifications?unread=true');
      if (res.ok) {
        const data = await res.json();
        if (data.notifications?.length > 0) {
          setNotification(data.notifications[0].message);
        }
      }
    }, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Notification banner */}
      {notification && (
        <div className="bg-blue-50 border-b border-blue-200 p-3 text-sm">
          🔔 {notification}
          <button onClick={() => setNotification(null)} className="ml-2 text-blue-600">dismiss</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-2xl mb-2">Hey! I'm Aura ✨</p>
            <p>Your personal AI. Let's get to know each other.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-2">{streamingContent || "Thinking..."}</div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <form onSubmit={(e) => { e.preventDefault(); void send(input); setInput(''); }}
            className="border-t p-4">
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
                 placeholder="Message Aura..."
                 className="flex-1 rounded-full border px-4 py-2 focus:outline-none focus:ring-2" />
          <button type="submit" disabled={isStreaming || !input.trim()}
                  className="bg-blue-600 text-white rounded-full px-6 py-2 disabled:opacity-50">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
```

### Streaming Responses (SSE)

The `useAgentStream` hook from `@kernova/framework/react` handles Server-Sent Events: `streamingContent` grows token by token while `isStreaming` is true, so the user sees Aura typing word by word. The finished reply is added to `messages`.

Under the hood, it POSTs to `/api/agents/assistant/stream` (proxied to the agent server) and reads the SSE stream.

## The Memory Page

A searchable browser for everything Aura remembers:

```tsx
'use client';
import { useState, useEffect } from 'react';

export default function MemoryPage() {
  const [memories, setMemories] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`/api/memories${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then(r => r.json())
      .then(data => setMemories(data.entries || []));
  }, [search]);

  const deleteMemory = async (id: string) => {
    await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    setMemories(memories.filter(m => m.id !== id));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Memory</h1>
      <input value={search} onChange={(e) => setSearch(e.target.value)}
             placeholder="Search memories..." className="w-full border rounded-lg px-4 py-2 mb-6" />

      <div className="space-y-3">
        {memories.map((m) => (
          <div key={m.id} className="border rounded-lg p-4 flex justify-between items-start">
            <div>
              <p className="text-gray-900">{m.content}</p>
              <div className="flex gap-2 mt-2">
                {(m.tags || []).map((tag: string) => (
                  <span key={tag} className="text-xs bg-gray-100 rounded px-2 py-0.5">{tag}</span>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">{new Date(m.createdAt).toLocaleDateString()}</p>
            </div>
            <button onClick={() => deleteMemory(m.id)} className="text-red-400 text-sm">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## The Settings Page

Controls what Aura can and can't do:

```tsx
'use client';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({});

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings);
  }, []);

  const update = async (key: string, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated) });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Master toggle */}
      <Toggle label="Autonomous Mode" description="Allow Aura to act on triggers and take actions independently"
              checked={settings.autonomousMode} onChange={(v) => update('autonomousMode', v)} />

      {/* Google permissions */}
      <h2 className="text-lg font-semibold mt-8 mb-4">Google</h2>
      <Toggle label="Read inbox" checked={settings.google_readInbox} onChange={(v) => update('google_readInbox', v)} />
      <Toggle label="Send emails" checked={settings.google_sendEmail} onChange={(v) => update('google_sendEmail', v)} />
      <Toggle label="Archive/label emails" checked={settings.google_archiveEmail} onChange={(v) => update('google_archiveEmail', v)} />
      <Toggle label="Delete emails" checked={settings.google_deleteEmail} onChange={(v) => update('google_deleteEmail', v)} />
      <Toggle label="Read calendar" checked={settings.google_readCalendar} onChange={(v) => update('google_readCalendar', v)} />
      <Toggle label="Create events" checked={settings.google_createEvent} onChange={(v) => update('google_createEvent', v)} />
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: any) {
  return (
    <div className="flex items-center justify-between py-3 border-b">
      <div>
        <p className="font-medium">{label}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button onClick={() => onChange(!checked)}
              className={`w-12 h-6 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <div className={`w-5 h-5 bg-white rounded-full shadow transition ${checked ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
```

## Push Notifications

Enable push notifications so trigger results reach the user even when the tab is closed:

```typescript
// app/api/push/route.ts
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: Request) {
  const { action, title, message } = await req.json();
  if (action === 'send') {
    // Send to all registered subscriptions
    const subscriptions = await getSubscriptions();
    await Promise.all(subscriptions.map(sub =>
      webpush.sendNotification(sub, JSON.stringify({ title, body: message }))
    ));
    return Response.json({ sent: true });
  }
}
```

## Deployment Options

### Option 1: Kernova Cloud (simplest)

```bash
kernova deploy
```

That's it. Kernova Cloud handles the backend, database, triggers, and gives you a URL.

### Option 2: Vercel + Railway

Deploy the Next.js frontend to Vercel and the Kernova backend to Railway:

```bash
# Frontend (Vercel)
vercel deploy

# Backend (Railway)
railway init
railway up
```

Update your frontend's rewrite to point to the Railway URL instead of localhost.

### Option 3: Self-Hosted (Docker)

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000 4555
CMD ["kernova", "start"]
```

```bash
docker build -t aura .
docker run -p 3000:3000 -p 4555:4555 --env-file .env.local aura
```

## Final Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PRODUCTION                         │
├─────────────────────────────────────────────────────┤
│                                                      │
│   Next.js (Vercel/Docker)     Kernova Backend        │
│   ┌──────────────────┐       ┌──────────────────┐  │
│   │ Chat UI           │──────▶│ Aura Agent       │  │
│   │ Memory Browser    │       │ 10 Specialists   │  │
│   │ Activity Log      │       │ 29 Tools         │  │
│   │ Settings          │       │ 9 Triggers       │  │
│   └──────────────────┘       └────────┬─────────┘  │
│                                        │             │
│                              ┌─────────▼─────────┐  │
│                              │   PostgreSQL       │  │
│                              │   + pgvector       │  │
│                              │   (Neon/Railway)   │  │
│                              └───────────────────┘  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## What to Build Next

You now have a complete personal AI OS. Here's where to go from here:

- **Voice interface** — add Whisper for speech-to-text, ElevenLabs for TTS
- **Mobile app** — React Native with the same Kernova backend
- **More integrations** — Spotify, Linear, Todoist, banking APIs
- **Multi-user** — add auth so family members each get their own Aura
- **Fine-tuning** — train a custom model on your conversation style
- **Local models** — swap GPT-4o for Llama 3 via Ollama for privacy

## Exercise

1. Build the full chat page and verify streaming works
2. Implement the memory browser — search and delete memories
3. Add the settings page with integration toggles
4. Deploy to your preferred platform (Kernova Cloud is fastest)
5. Use Aura for a full week — let her learn about you and see how the triggers work

---

Congratulations — you've built a personal AI operating system. Aura knows you, manages your inbox, prepares you for meetings, tracks your habits, and grows smarter every day. The code is yours to extend in any direction.
