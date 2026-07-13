export const chatPage = `'use client';

import { useAgentStream } from '@kernova/framework/react';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

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
      <aside className="hidden lg:flex w-72 flex-col border-r border-[var(--border)] bg-[var(--sidebar)]">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[var(--border)]">
          <Link href="/" className="flex items-center gap-2.5 mb-4">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
            </div>
            <span className="text-sm font-bold">Assistant</span>
          </Link>
          <button
            onClick={clear}
            className="w-full flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-medium hover:bg-[var(--accent)] transition-all active:scale-[0.98]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            New conversation
          </button>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
          <div className="px-2 py-2 text-[11px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest">Today</div>
          {messages.length > 0 && (
            <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium truncate">
              {messages[0]?.content.slice(0, 30) || 'Current chat'}...
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-[var(--border)] p-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold">U</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">User</p>
              <p className="text-[11px] text-[var(--muted-foreground)]">Free plan</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex flex-1 flex-col min-w-0">
        {/* Mobile Header */}
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="lg:hidden">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
              </div>
            </Link>
            <div>
              <h1 className="text-sm font-semibold">Assistant</h1>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {isStreaming ? (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Generating...
                  </span>
                ) : 'Ready'}
              </p>
            </div>
          </div>
          <button onClick={clear} className="lg:hidden text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </header>

        {/* Messages Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
            {/* Empty State */}
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
                <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center mb-8 shadow-xl shadow-violet-500/20">
                  <svg width="32" height="32" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                </div>
                <h2 className="text-2xl font-bold mb-2">How can I help you?</h2>
                <p className="text-[var(--muted-foreground)] max-w-md mb-10">
                  I'm an AI assistant. I can answer questions, search the web, and help with tasks.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 w-full max-w-lg">
                  {['What can you help me with?', 'Search the web for something', 'Tell me about AI agents', 'Write some code for me'].map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="group rounded-xl border border-[var(--border)] px-4 py-3.5 text-sm text-left hover:bg-[var(--accent)] hover:border-violet-500/30 transition-all active:scale-[0.98]"
                    >
                      <span className="text-[var(--foreground)]">{q}</span>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="inline ml-2 opacity-0 group-hover:opacity-100 transition-opacity"><path d="M3 8H13M10 5L13 8L10 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg, i) => (
              <div key={msg.id} className="animate-slide-up flex gap-4" style={{ animationDelay: \`\${i * 50}ms\` }}>
                {msg.role === 'assistant' ? (
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shadow-sm">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                  </div>
                ) : (
                  <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">U</div>
                )}
                <div className={\`flex-1 min-w-0 \${msg.role === 'user' ? 'max-w-[85%] ml-auto' : ''}\`}>
                  <div className={\`rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed \${
                    msg.role === 'user'
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)] rounded-br-md'
                      : 'bg-[var(--muted)] rounded-bl-md'
                  }\`}>
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              </div>
            ))}

            {/* Streaming */}
            {isStreaming && streamingContent && (
              <div className="animate-fade-in flex gap-4">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shadow-sm">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl rounded-bl-md bg-[var(--muted)] px-5 py-3.5 text-[15px] leading-relaxed">
                    <p className="whitespace-pre-wrap break-words">{streamingContent}<span className="inline-block w-[3px] h-[18px] bg-violet-500 ml-0.5 animate-typing rounded-full" /></p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading dots */}
            {isStreaming && !streamingContent && (
              <div className="animate-fade-in flex gap-4">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shadow-sm">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
                </div>
                <div className="rounded-2xl rounded-bl-md bg-[var(--muted)] px-5 py-4">
                  <div className="flex gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)]/60 animate-bounce [animation-delay:0ms]" />
                    <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)]/60 animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)]/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-[var(--border)] p-4 bg-[var(--background)]">
          <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
            <div className="relative flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message assistant..."
                disabled={isStreaming}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--muted)]/50 px-5 py-4 pr-14 text-[15px] outline-none placeholder:text-[var(--muted-foreground)] focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all disabled:opacity-50"
                autoFocus
              />
              <div className="absolute right-2">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={abort}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500 text-white hover:bg-red-600 transition-all active:scale-95"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-all disabled:opacity-20 active:scale-95"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">
              AI responses may be inaccurate. Verify important information.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
`;
