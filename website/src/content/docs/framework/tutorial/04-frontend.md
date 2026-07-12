---
title: "Step 4: Build the Chat UI"
description: "Customize the frontend with React hooks that connect to your agent."
---

# Step 4: Build the Chat UI

The scaffolded `app/chat/page.tsx` already works, but let's build a more polished version to understand how the React hooks work.

## Understanding the Hook

The key hook is `useAgentStream`. Here's how it works:

```typescript
import { useAgentStream } from '@kernova/framework/react';

const { messages, send, isStreaming, streamingContent, abort } = useAgentStream('support');
```

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `AgentMessage[]` | All messages in the conversation |
| `send` | `(input: string) => Promise<void>` | Send a message to the agent |
| `isStreaming` | `boolean` | Whether the agent is currently responding |
| `streamingContent` | `string` | The partial response being typed out |
| `abort` | `() => void` | Stop the current response |
| `error` | `Error \| null` | Last error, if any |
| `clear` | `() => void` | Reset the conversation |
| `threadId` | `string` | Current thread ID |

## Replace the Chat Page

Open `app/chat/page.tsx` and replace it with:

```tsx
'use client';

import { useAgentStream } from '@kernova/framework/react';
import { useState, useRef, useEffect } from 'react';

export default function ChatPage() {
  const { messages, send, isStreaming, streamingContent, abort, clear, error } = useAgentStream('support');
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    send(input.trim());
    setInput('');
  };

  return (
    <div className="chat-layout">
      {/* Header */}
      <header className="chat-header">
        <div>
          <h1>Acme Support</h1>
          <p className="status">
            {isStreaming ? '● Typing...' : '● Online'}
          </p>
        </div>
        <button onClick={clear} className="clear-btn">
          New Chat
        </button>
      </header>

      {/* Messages */}
      <div className="messages">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="welcome">
            <h2>👋 Hi there!</h2>
            <p>I'm the Acme support agent. I can help you with:</p>
            <ul>
              <li>Product questions</li>
              <li>Account issues</li>
              <li>Billing inquiries</li>
              <li>Feature requests</li>
            </ul>
            <p>What can I help you with?</p>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-bubble">
              {msg.content}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {isStreaming && streamingContent && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-bubble streaming">
              {streamingContent}
              <span className="cursor">▊</span>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="error-message">
            <p>⚠️ {error.message}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          disabled={isStreaming}
          autoFocus
        />
        {isStreaming ? (
          <button type="button" onClick={abort} className="stop-btn">
            ⬛ Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Send ↑
          </button>
        )}
      </form>
    </div>
  );
}
```

## Add Styles

Replace `app/globals.css` with:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f9fafb;
  color: #111827;
}

/* Chat Layout */
.chat-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 800px;
  margin: 0 auto;
  background: white;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.05);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.chat-header h1 { font-size: 1.1rem; font-weight: 600; }
.chat-header .status { font-size: 0.75rem; color: #10b981; margin-top: 2px; }

.clear-btn {
  padding: 0.4rem 0.8rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  font-size: 0.8rem;
  cursor: pointer;
}
.clear-btn:hover { background: #f9fafb; }

/* Messages */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.welcome {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 12px;
  padding: 1.5rem;
  margin: auto;
  max-width: 400px;
  text-align: center;
}
.welcome h2 { margin-bottom: 0.5rem; }
.welcome p { font-size: 0.9rem; color: #4b5563; margin: 0.5rem 0; }
.welcome ul { list-style: none; font-size: 0.85rem; color: #6b7280; }
.welcome li::before { content: '• '; color: #3b82f6; }

.message {
  display: flex;
  gap: 0.75rem;
  max-width: 85%;
}
.message.user { margin-left: auto; flex-direction: row-reverse; }

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.message-bubble {
  padding: 0.75rem 1rem;
  border-radius: 16px;
  line-height: 1.5;
  font-size: 0.9rem;
  white-space: pre-wrap;
}

.message.user .message-bubble {
  background: #2563eb;
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-bubble {
  background: #f3f4f6;
  border-bottom-left-radius: 4px;
}

.message-bubble.streaming { opacity: 0.9; }
.cursor { animation: blink 1s infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

.error-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: #991b1b;
}

/* Input */
.input-area {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e7eb;
}

.input-area input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 24px;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}
.input-area input:focus { border-color: #2563eb; }
.input-area input:disabled { opacity: 0.6; }

.input-area button {
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: 24px;
  background: #2563eb;
  color: white;
  font-weight: 500;
  font-size: 0.85rem;
  cursor: pointer;
  transition: opacity 0.2s;
}
.input-area button:disabled { opacity: 0.4; cursor: not-allowed; }
.input-area button:hover:not(:disabled) { opacity: 0.9; }

.stop-btn { background: #ef4444 !important; }
```

## Test the Full Experience

With `kernova dev` running, open [http://localhost:3000/chat](http://localhost:3000/chat).

Try this conversation flow:

1. **"How do I invite my team?"** → Agent searches KB, gives specific steps
2. **"What about the pricing?"** → Agent finds pricing info from KB
3. **"I've been charged twice this month"** → Agent can't find a KB answer, offers to create a ticket
4. **"Yes please create a ticket"** → Agent calls `create-ticket` tool

Notice how:
- Responses stream in word-by-word (not a loading spinner then all at once)
- You can click "⬛ Stop" mid-response
- The "New Chat" button resets the conversation
- The agent remembers context within the conversation

## Adding Quick Action Buttons (Bonus)

Want suggested questions? Add them to the welcome screen:

```tsx
{messages.length === 0 && (
  <div className="welcome">
    {/* ... existing content ... */}
    <div className="quick-actions">
      <button onClick={() => send('How do I reset my password?')}>
        Reset password
      </button>
      <button onClick={() => send('What are the pricing plans?')}>
        Pricing
      </button>
      <button onClick={() => send('How do I invite team members?')}>
        Invite team
      </button>
    </div>
  </div>
)}
```

Add CSS:
```css
.quick-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; margin-top: 1rem; }
.quick-actions button { padding: 0.4rem 0.8rem; border: 1px solid #e5e7eb; border-radius: 16px; background: white; font-size: 0.8rem; cursor: pointer; }
.quick-actions button:hover { background: #eff6ff; border-color: #93c5fd; }
```

## What You Learned

- `useAgentStream` gives you real-time streaming from agents
- The hook manages all state: messages, loading, errors
- `abort()` lets users stop long responses
- `clear()` resets the conversation
- The agent name in the hook (`'support'`) maps to the filename (`support.agent.ts`)
- No URL configuration needed — it auto-detects

---

[Continue to Step 5: Add Memory →](/framework/tutorial/05-memory)
