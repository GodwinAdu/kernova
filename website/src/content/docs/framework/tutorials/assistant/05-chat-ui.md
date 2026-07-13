---
title: "Step 4: Customize the Chat UI"
description: "Make the chat interface yours — branding, colors, and user experience."
---

# Step 4: Customize the Chat UI

The scaffolded chat page already looks good, but let's personalize it for Nova.

## Understanding the Chat Hook

The entire chat interface is powered by one hook:

```typescript
const { messages, send, isStreaming, streamingContent, abort, clear } = useAgentStream('assistant');
```

Let's understand each property:

| Property | Type | What It Does |
|----------|------|-------------|
| `messages` | `AgentMessage[]` | All messages in the conversation |
| `send` | `(text) => void` | Send a message to the agent |
| `isStreaming` | `boolean` | Whether the agent is currently responding |
| `streamingContent` | `string` | The partial response being typed |
| `abort` | `() => void` | Stop the current response |
| `clear` | `() => void` | Reset the conversation |

The `'assistant'` argument maps to the file `agents/assistant.agent.ts`. If you renamed it to `agents/nova.agent.ts`, you'd use `useAgentStream('nova')`.

## Customize the Empty State

Open `app/chat/page.tsx`. Find the empty state section (the part that shows when there are no messages) and customize the suggestions:

Find this section:
```tsx
{['What can you help me with?', 'Search the web for something', ...].map((q) => (
```

Replace the suggestions with Nova-specific ones:

```tsx
{['What can you remember about me?', 'What is the latest in AI news?', 'Help me plan my day', 'Tell me a fun fact'].map((q) => (
```

## Customize Colors

Open `app/globals.css`. The CSS variables control the entire color scheme:

```css
:root {
  --background: #ffffff;
  --foreground: #09090b;
  --primary: #7c3aed;           /* ← Change to purple for Nova */
  --primary-foreground: #fafafa;
}

.dark {
  --background: #09090b;
  --foreground: #fafafa;
  --primary: #8b5cf6;           /* ← Purple in dark mode */
  --primary-foreground: #ffffff;
}
```

This changes all buttons, the send button, and the agent avatar gradient.

## Add a Welcome Message

You can add a system-level welcome that appears before the user sends anything. In the chat page, add this to the empty state:

```tsx
{messages.length === 0 && !isStreaming && (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
    <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center mb-8 shadow-xl shadow-purple-500/20">
      {/* Nova logo */}
      <span className="text-3xl">✨</span>
    </div>
    <h2 className="text-2xl font-bold mb-2">Hi, I'm Nova</h2>
    <p className="text-[var(--muted-foreground)] max-w-md mb-10">
      Your personal AI assistant. I remember our conversations, search the web, and help with anything you need.
    </p>
    {/* suggestion buttons */}
  </div>
)}
```

## Test It

Save your changes. If `kernova dev` is running, the browser will auto-refresh (Next.js hot reload).

Check:
- ✅ Custom suggestions appear
- ✅ Colors match your brand
- ✅ Empty state shows Nova's personality
- ✅ Messages stream in real-time
- ✅ "New conversation" button works

## How Streaming Works

When the user sends a message, here's what happens in the UI:

```
1. User types "Hello" and hits Send
2. Message appears in the chat immediately (optimistic)
3. isStreaming = true, streamingContent = ""
4. Tokens arrive: "Hi" → "Hi there" → "Hi there, Alex"
5. Each token updates streamingContent in real-time
6. When done: isStreaming = false, message added to messages[]
```

The streaming creates the "typing" effect you see in ChatGPT. It's done via Server-Sent Events (SSE) from the agent backend.

---

[Continue to Step 5: Deploy Nova →](/framework/tutorials/assistant/06-deploy)
