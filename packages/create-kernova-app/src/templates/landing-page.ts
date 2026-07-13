export function landingPage(name: string): string {
  return `import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-[var(--border)]/50 bg-[var(--background)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white" />
              </svg>
            </div>
            <span className="text-base font-bold tracking-tight">${name}</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/chat" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
              Chat
            </Link>
            <a href="https://kernova.dev" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
              Docs
            </a>
            <Link href="/chat" className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-all hover:shadow-lg hover:shadow-[var(--primary)]/10 active:scale-[0.98]">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-[40%] left-1/2 -translate-x-1/2 w-[80rem] h-[40rem] bg-gradient-to-b from-violet-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 pt-28 pb-24 text-center">
          {/* Badge */}
          <div className="animate-fade-in mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-4 py-1.5 text-xs text-[var(--muted-foreground)] shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            Powered by Kernova Framework
          </div>

          {/* Heading */}
          <h1 className="animate-slide-up text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl leading-[1.1]">
            Build AI agents
            <br />
            <span className="bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 bg-clip-text text-transparent">that actually ship.</span>
          </h1>

          {/* Subtitle */}
          <p className="animate-slide-up mx-auto mt-8 max-w-2xl text-lg text-[var(--muted-foreground)] leading-relaxed [animation-delay:100ms]">
            Define agents with instructions and tools. Connect a React frontend with one hook.
            Deploy with a single command. This is ${name}.
          </p>

          {/* CTA Buttons */}
          <div className="animate-slide-up mt-12 flex flex-col sm:flex-row items-center justify-center gap-4 [animation-delay:200ms]">
            <Link href="/chat" className="group inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-8 py-3.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-all hover:shadow-xl hover:shadow-[var(--primary)]/20 active:scale-[0.98]">
              Start chatting
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="transition-transform group-hover:translate-x-0.5"><path d="M3 8H13M10 5L13 8L10 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <a href="https://kernova2026.vercel.app" className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-8 py-3.5 text-sm font-semibold hover:bg-[var(--muted)] transition-all active:scale-[0.98]">
              Read the docs
            </a>
          </div>

          {/* Terminal Preview */}
          <div className="animate-slide-up mt-20 mx-auto max-w-2xl [animation-delay:400ms]">
            <div className="rounded-2xl border border-[var(--border)] bg-[#0a0a0b] overflow-hidden shadow-2xl shadow-black/20 ring-1 ring-white/5">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-white/10 hover:bg-[#ff5f57] transition-colors" />
                  <div className="h-3 w-3 rounded-full bg-white/10 hover:bg-[#febc2e] transition-colors" />
                  <div className="h-3 w-3 rounded-full bg-white/10 hover:bg-[#28c840] transition-colors" />
                </div>
                <span className="ml-3 text-xs text-gray-500 font-mono">Terminal</span>
              </div>
              <div className="p-6 font-mono text-[13px] leading-7 text-gray-400">
                <p><span className="text-gray-500">$</span> <span className="text-white">npx create-kernova-app ${name}</span></p>
                <p className="text-emerald-400">✓ Project created</p>
                <p><span className="text-gray-500">$</span> <span className="text-white">kernova dev</span></p>
                <p className="text-emerald-400">✓ Ready at http://localhost:3000</p>
                <p className="mt-3"><span className="text-gray-500">$</span> <span className="text-white">kernova deploy</span></p>
                <p className="text-emerald-400">✓ Live at <span className="text-blue-400 underline">https://kn-${name}.onrender.com</span></p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[var(--border)] py-24 bg-[var(--muted)]/30">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">Everything you need to ship AI</h2>
            <p className="mt-4 text-[var(--muted-foreground)] max-w-xl mx-auto">From local development to global production — one framework, one command.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: '🧠', title: 'Intelligent Agents', desc: 'Define agents with instructions, tools, and memory. File-based routing — each file becomes an API endpoint.' },
              { icon: '⚡', title: 'Real-time Streaming', desc: 'Token-by-token streaming with abort. Users see responses form in real-time, just like ChatGPT.' },
              { icon: '🔧', title: 'Custom Tools', desc: 'Give agents superpowers — web search, databases, APIs. The LLM decides when and how to use them.' },
              { icon: '💾', title: 'Persistent Memory', desc: 'Agents remember across sessions. Conversational or long-term, with automatic summarization.' },
              { icon: '🚀', title: 'One-Command Deploy', desc: 'kernova deploy ships your frontend + agents to production. No Docker, no config.' },
              { icon: '🎨', title: 'React Hooks', desc: 'useAgent, useAgentStream, useMemory — connect your UI to agents with zero configuration.' },
            ].map((f) => (
              <div key={f.title} className="group rounded-2xl border border-[var(--border)] bg-[var(--background)] p-8 hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300">
                <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">{f.icon}</div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--border)] py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">Three files. One command. Live.</h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-500/10 text-violet-600 font-bold text-lg mb-4">1</div>
              <h3 className="font-semibold mb-2">Define an agent</h3>
              <p className="text-sm text-[var(--muted-foreground)]">Write instructions and tools in a .agent.ts file. That's your backend.</p>
            </div>
            <div className="text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-500/10 text-blue-600 font-bold text-lg mb-4">2</div>
              <h3 className="font-semibold mb-2">Connect your UI</h3>
              <p className="text-sm text-[var(--muted-foreground)]">Use useAgentStream('name') in React. Auto-connects, streams responses.</p>
            </div>
            <div className="text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-100 dark:bg-cyan-500/10 text-cyan-600 font-bold text-lg mb-4">3</div>
              <h3 className="font-semibold mb-2">Deploy</h3>
              <p className="text-sm text-[var(--muted-foreground)]">Run kernova deploy. Frontend + agents live at one URL. Done.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--border)] py-24 bg-[var(--muted)]/30">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to build something?</h2>
          <p className="mt-4 text-[var(--muted-foreground)]">Start a conversation with the AI agent right now.</p>
          <Link href="/chat" className="mt-10 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-8 py-4 text-sm font-semibold text-white hover:opacity-90 transition-all hover:shadow-xl hover:shadow-violet-500/20 active:scale-[0.98]">
            Open Chat
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8H13M10 5L13 8L10 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" fill="white"/></svg>
              </div>
              <span className="text-sm font-semibold">${name}</span>
              <span className="text-xs text-[var(--muted-foreground)] ml-2">Built with Kernova</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-[var(--muted-foreground)]">
              <a href="https://kernova2026.vercel.app" className="hover:text-[var(--foreground)] transition-colors">Docs</a>
              <a href="https://github.com/GodwinAdu/kernova" className="hover:text-[var(--foreground)] transition-colors">GitHub</a>
              <a href="https://kernova-cloud.vercel.app" className="hover:text-[var(--foreground)] transition-colors">Cloud</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
`;
}
