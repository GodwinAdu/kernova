export const chatPage = `'use client';

import { useAgentStream } from '@kernova/framework/react';
import { useState, useRef, useEffect } from 'react';

export default function ChatPage() {
  const { messages, send, isStreaming, streamingContent, abort, clear } = useAgentStream('assistant');
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    send(input.trim());
    setInput('');
  };

  return (
    <div className="flex h-screen bg-[var(--background)]">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-[var(--border)] bg-[var(--muted)]">
        <div className="p-4 border-b border-[var(--border)]">
          <button
            onClick={clear}
            className="w-full flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--accent)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wider">Today</div>
          <div className="rounded-lg bg-[var(--background)] px-3 py-2 text-sm">Current conversation</div>
        </div>
        <div className="border-t border-[var(--border)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <div className="h-7 w-7 rounded-full bg-[var(--foreground)]/10 flex items-center justify-center text-xs font-medium">U</div>
            <span>User</span>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold">Assistant</h1>
              <p className="text-xs text-[var(--muted-foreground)]">
                {isStreaming ? 'Thinking...' : 'Online'}
              </p>
            </div>
          </div>
          <button onClick={clear} className="md:hidden text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            New Chat
          </button>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mb-6">
                  <svg width="28" height="28" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                </div>
                <h2 className="text-xl font-semibold mb-2">How can I help you?</h2>
                <p className="text-sm text-[var(--muted-foreground)] max-w-md">
                  I'm an AI assistant powered by Kernova. Ask me anything.
                </p>
                <div className="mt-8 grid gap-2 sm:grid-cols-2 w-full max-w-lg">
                  {['What can you do?', 'Tell me about Kernova', 'Help me with a task', 'Search the web'].map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-left hover:bg-[var(--muted)] transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={\`flex gap-4 \${msg.role === 'user' ? 'justify-end' : ''}\`}>
                {msg.role === 'assistant' && (
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                  </div>
                )}
                <div className={\`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed \${
                  msg.role === 'user'
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)]'
                }\`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--foreground)]/10 flex items-center justify-center text-xs font-medium">U</div>
                )}
              </div>
            ))}

            {isStreaming && streamingContent && (
              <div className="flex gap-4">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                </div>
                <div className="max-w-[80%] rounded-2xl bg-[var(--muted)] px-4 py-3 text-sm leading-relaxed">
                  <p className="whitespace-pre-wrap">{streamingContent}</p>
                  <span className="inline-block w-1.5 h-4 bg-[var(--foreground)] ml-0.5 animate-pulse" />
                </div>
              </div>
            )}

            {isStreaming && !streamingContent && (
              <div className="flex gap-4">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                </div>
                <div className="rounded-2xl bg-[var(--muted)] px-4 py-3">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)] animate-bounce [animation-delay:0ms]" />
                    <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)] animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)] animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-[var(--border)] p-4">
          <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message the assistant..."
                disabled={isStreaming}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 pr-12 text-sm outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--foreground)]/30 focus:ring-1 focus:ring-[var(--foreground)]/10 transition-all disabled:opacity-50"
                autoFocus
              />
            </div>
            {isStreaming ? (
              <button
                type="button"
                onClick={abort}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 8L3 3V7L9 8L3 9V13Z" fill="currentColor"/></svg>
              </button>
            )}
          </form>
          <p className="mt-2 text-center text-xs text-[var(--muted-foreground)]">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </main>
    </div>
  );
}
`;
