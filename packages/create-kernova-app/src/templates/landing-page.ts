export function landingPage(name: string): string {
  return `import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <div className="h-6 w-6 rounded-md bg-[var(--foreground)] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="currentColor" className="text-[var(--background)]" />
              </svg>
            </div>
            ${name}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/chat" className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
              Chat
            </Link>
            <Link href="/chat" className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.08),transparent_50%)]" />
        <div className="relative mx-auto max-w-4xl px-6 pt-24 pb-20 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--muted)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Powered by Kernova Framework
          </div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            AI that works
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">for your users.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--muted-foreground)] leading-relaxed">
            ${name} is an intelligent assistant built with the Kernova Framework.
            Define agents, tools, and memory — deploy with one command.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/chat" className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity">
              Try the Chat
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <a href="https://kernova.dev" className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-2.5 text-sm font-medium hover:bg-[var(--muted)] transition-colors">
              Documentation
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-bold mb-12">Built with the modern AI stack</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: '🧠', title: 'Intelligent Agents', desc: 'Define agents with instructions, tools, and memory. The LLM decides what to do.' },
              { icon: '⚡', title: 'Streaming Responses', desc: 'Token-by-token streaming. Users see the response as it\\'s generated.' },
              { icon: '🔧', title: 'Custom Tools', desc: 'Give agents access to APIs, databases, and custom functions.' },
              { icon: '💾', title: 'Persistent Memory', desc: 'Agents remember conversations across sessions. Configurable TTL.' },
              { icon: '🚀', title: 'One-Command Deploy', desc: 'Run kernova deploy to ship frontend + agents to production.' },
              { icon: '🔒', title: 'Built-in Auth', desc: 'API keys, rate limiting, and middleware for access control.' },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-[var(--border)] p-6 hover:bg-[var(--muted)] transition-colors">
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code Preview */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-2xl font-bold mb-8">Simple to build</h2>
          <div className="rounded-xl border border-[var(--border)] bg-[#0d1117] overflow-hidden shadow-2xl">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <div className="h-3 w-3 rounded-full bg-[#28c840]" />
              </div>
              <span className="ml-2 text-xs text-gray-400 font-mono">agents/assistant.agent.ts</span>
            </div>
            <pre className="p-6 text-sm text-gray-300 font-mono leading-relaxed overflow-x-auto">
              <code>{\`import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Assistant',
  model: 'gpt-4o',
  instructions: \\\`
    You are a helpful AI assistant.
    Be concise and accurate.
  \\\`,
  tools: ['web-search'],
  memory: { type: 'conversational', ttl: '7d' },
});\`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold">Ready to build?</h2>
          <p className="mt-3 text-[var(--muted-foreground)]">Start a conversation with the AI agent.</p>
          <Link href="/chat" className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-8 py-3 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity">
            Open Chat
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>Built with Kernova Framework</span>
          <a href="https://kernova.dev" className="hover:text-[var(--foreground)] transition-colors">Documentation</a>
        </div>
      </footer>
    </div>
  );
}
`;
}
