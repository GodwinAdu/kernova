---
title: React Hooks
description: Connect your frontend to agents with zero configuration.
---

# React Hooks

The framework provides React hooks that auto-connect to your agents. No API URL configuration needed — they detect the environment automatically.

## Setup

Wrap your app with `KernovaProvider` (already done if you used `create-kernova-app`):

```tsx
// app/layout.tsx
import { KernovaProvider } from '@kernova/framework/react';

export default function Layout({ children }) {
  return (
    <KernovaProvider>
      {children}
    </KernovaProvider>
  );
}
```

## useAgent — Simple Request/Response

```tsx
'use client';
import { useAgent } from '@kernova/framework/react';

export default function ChatPage() {
  const { messages, send, isLoading, error } = useAgent('assistant');

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong> {msg.content}
        </div>
      ))}
      
      <button onClick={() => send('Hello!')} disabled={isLoading}>
        Send
      </button>
    </div>
  );
}
```

### useAgent API

```typescript
const {
  messages,    // AgentMessage[] — all messages in the conversation
  send,        // (input: string) => Promise<void>
  isLoading,   // boolean — waiting for response
  error,       // Error | null
  threadId,    // string — conversation thread ID
  clear,       // () => void — reset conversation
  retry,       // () => Promise<void> — retry last message
} = useAgent('agent-name', options?);
```

Options:

```typescript
useAgent('support', {
  threadId: 'existing-thread-id',  // Resume a conversation
  context: { page: '/billing' },   // Extra context sent with each request
  user: { id: 'user_123' },        // User info
  onResponse: (msg) => { ... },    // Callback on response
  onError: (err) => { ... },       // Callback on error
});
```

## useAgentStream — Streaming Responses

For real-time token-by-token responses (like ChatGPT):

```tsx
'use client';
import { useAgentStream } from '@kernova/framework/react';

export default function Chat() {
  const { messages, send, isStreaming, streamingContent, abort } = useAgentStream('assistant');

  return (
    <div>
      {messages.map(msg => <p key={msg.id}>{msg.content}</p>)}
      
      {isStreaming && (
        <p className="animate-pulse">{streamingContent}</p>
      )}

      <button onClick={() => send('Explain quantum computing')}>Ask</button>
      {isStreaming && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

### useAgentStream API

```typescript
const {
  messages,          // AgentMessage[]
  send,             // (input: string) => Promise<void>
  isStreaming,      // boolean — tokens are being received
  streamingContent, // string — partial response so far
  error,            // Error | null
  threadId,         // string
  clear,            // () => void
  abort,            // () => void — stop generation mid-stream
} = useAgentStream('agent-name', options?);
```

## useMemory — Read/Write Agent Memory

```tsx
'use client';
import { useMemory } from '@kernova/framework/react';

export default function KnowledgeBase() {
  const { entries, search, store, remove, isLoading } = useMemory('conversations');

  return (
    <div>
      <button onClick={() => search('recent meetings')}>Search</button>
      
      {entries.map(entry => (
        <div key={entry.id}>
          <p>{entry.content}</p>
          <button onClick={() => remove(entry.id)}>Delete</button>
        </div>
      ))}

      <button onClick={() => store('New important fact', ['important'])}>
        Add Memory
      </button>
    </div>
  );
}
```

## useThread — Manage Conversations

```tsx
'use client';
import { useThread } from '@kernova/framework/react';

export default function Sidebar() {
  const { threads, create, switchTo, remove, activeId } = useThread();

  return (
    <ul>
      {threads.map(t => (
        <li key={t.id} onClick={() => switchTo(t.id)}
            style={{ fontWeight: t.id === activeId ? 'bold' : 'normal' }}>
          {t.title}
          <button onClick={() => remove(t.id)}>×</button>
        </li>
      ))}
      <button onClick={() => create('assistant')}>New Chat</button>
    </ul>
  );
}
```

## useConnectionStatus — Monitor Backend Health

```tsx
'use client';
import { useConnectionStatus } from '@kernova/framework/react';

export default function StatusBadge() {
  const { isConnected, latency } = useConnectionStatus();

  return (
    <span>
      {isConnected ? '🟢' : '🔴'} 
      {latency && `${latency}ms`}
    </span>
  );
}
```

## KernovaErrorBoundary — Error Handling

Wrap agent-connected components to catch errors gracefully:

```tsx
import { KernovaErrorBoundary } from '@kernova/framework/react';

<KernovaErrorBoundary
  fallback={(error, retry) => (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={retry}>Try again</button>
    </div>
  )}
  onError={(error) => console.error('Agent error:', error)}
>
  <ChatPage />
</KernovaErrorBoundary>
```

## How Auto-Detection Works

The hooks automatically determine where to send requests:

- **Development** (`kernova dev`): Requests go to `localhost:3000/api/agents/*` — Next.js proxies them to the agent server
- **Production** (Kernova Cloud): Requests go to same-origin `/api/agents/*` — the gateway routes them

You never configure URLs manually. It just works.

To override (e.g., connecting to a different backend):

```tsx
<KernovaProvider baseUrl="https://my-custom-backend.com" apiKey="kn_live_xxx">
  {children}
</KernovaProvider>
```
