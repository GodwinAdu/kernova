/**
 * Project scaffolding — generates the full directory structure.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { globalsCss } from './templates/globals-css.js';
import { landingPage } from './templates/landing-page.js';
import { chatPage } from './templates/chat-page.js';

export interface ScaffoldOptions {
  name: string;
  directory: string;
  template: 'default' | 'minimal' | 'multi-agent';
  framework: 'next' | 'react' | 'none';
}

export function scaffoldProject(options: ScaffoldOptions): void {
  const { name, directory, template, framework } = options;

  // Create directories
  const dirs = [
    '',
    'agents',
    'agents/tools',
    'memory',
    'middleware',
    'public',
  ];

  if (framework === 'next') {
    dirs.push('app', 'app/chat');
  } else if (framework === 'react') {
    dirs.push('src');
  }

  if (template === 'multi-agent') {
    dirs.push('agents/teams');
  }

  for (const dir of dirs) {
    mkdirSync(join(directory, dir), { recursive: true });
  }

  // Core files
  writeFileSync(join(directory, 'kernova.config.ts'), configTemplate(name, framework));
  writeFileSync(join(directory, 'package.json'), packageJsonTemplate(name, framework));
  writeFileSync(join(directory, 'tsconfig.json'), tsconfigTemplate(framework));
  writeFileSync(join(directory, '.env.local'), envTemplate());
  writeFileSync(join(directory, '.gitignore'), gitignoreTemplate());

  // Agents
  if (template === 'multi-agent') {
    writeFileSync(join(directory, 'agents', 'support.agent.ts'), supportAgentTemplate());
    writeFileSync(join(directory, 'agents', 'researcher.agent.ts'), researcherAgentTemplate());
    writeFileSync(join(directory, 'agents', 'tools', 'search-kb.ts'), searchKbToolTemplate());
    writeFileSync(join(directory, 'agents', 'tools', 'web-search.ts'), webSearchToolTemplate());
    writeFileSync(join(directory, 'agents', 'teams', 'main-team.ts'), teamTemplate());
  } else {
    writeFileSync(join(directory, 'agents', 'assistant.agent.ts'), assistantAgentTemplate());
    writeFileSync(join(directory, 'agents', 'tools', 'web-search.ts'), webSearchToolTemplate());
  }

  // Memory
  writeFileSync(join(directory, 'memory', 'conversations.ts'), memoryTemplate());

  // Frontend
  if (framework === 'next') {
    writeFileSync(join(directory, 'app', 'layout.tsx'), layoutTemplate(name));
    writeFileSync(join(directory, 'app', 'providers.tsx'), providersTemplate());
    writeFileSync(join(directory, 'app', 'page.tsx'), homePageTemplate(name));
    writeFileSync(join(directory, 'app', 'chat', 'page.tsx'), chatPageTemplate());
    writeFileSync(join(directory, 'app', 'globals.css'), globalsCssTemplate());
    writeFileSync(join(directory, 'next.config.ts'), nextConfigTemplate());
    writeFileSync(join(directory, 'postcss.config.mjs'), postcssTemplate());
  } else if (framework === 'react') {
    writeFileSync(join(directory, 'index.html'), reactIndexHtml(name));
    writeFileSync(join(directory, 'vite.config.ts'), viteConfigTemplate());
    writeFileSync(join(directory, 'src', 'main.tsx'), reactMainTemplate());
    writeFileSync(join(directory, 'src', 'App.tsx'), reactAppTemplate(name));
    writeFileSync(join(directory, 'src', 'Chat.tsx'), reactChatTemplate());
    writeFileSync(join(directory, 'src', 'index.css'), reactCssTemplate());
  }
}

// ─── Templates ───────────────────────────────────────────────────────────────

function configTemplate(name: string, framework: string): string {
  return `import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: '${name}',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
  },
  memory: {
    version: 2,
    provider: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
    url: process.env.DATABASE_URL,
    embedding: {
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    scoring: {
      similarityWeight: 0.5,
      recencyWeight: 0.25,
      frequencyWeight: 0.1,
      relevanceWeight: 0.15,
      recencyHalfLife: 168, // 1 week
    },
    compaction: {
      enabled: true,
      threshold: 50,
      keepRecent: 10,
    },
    autoRecall: true,
    autoSave: false,
    contextMessages: 20,
  },
  gateway: {
    openaiCompat: true,
    cors: ['*'],
    rateLimit: { requests: 100, window: '1m' },
  },
  app: {
    framework: '${framework}',
    port: 3000,
  },
});
`;
}

function packageJsonTemplate(name: string, framework: string): string {
  const deps: Record<string, string> = {
    '@kernova/framework': '^2.0.0',
    '@kernova/core': '^2.0.0',
    '@kernova/cli': '^1.2.0',
    'pg': '^8.22.0',
  };

  const devDeps: Record<string, string> = {};

  if (framework === 'next') {
    deps['next'] = '^16.0.0';
    deps['react'] = '^19.0.0';
    deps['react-dom'] = '^19.0.0';
    deps['@tailwindcss/postcss'] = '^4';
    deps['tailwindcss'] = '^4';
    deps['typescript'] = '^6.0.0';
    deps['@types/node'] = '^22.0.0';
    deps['@types/react'] = '^19.0.0';
  } else if (framework === 'react') {
    deps['react'] = '^19.0.0';
    deps['react-dom'] = '^19.0.0';
    devDeps['vite'] = '^6.0.0';
    devDeps['@vitejs/plugin-react'] = '^4.0.0';
    devDeps['typescript'] = '^6.0.0';
    devDeps['@types/node'] = '^22.0.0';
    devDeps['@types/react'] = '^19.0.0';
    devDeps['@types/react-dom'] = '^19.0.0';
  } else {
    devDeps['typescript'] = '^6.0.0';
    devDeps['@types/node'] = '^22.0.0';
  }

  const scripts: Record<string, string> = framework === 'react'
    ? { dev: 'kernova dev', build: 'vite build', start: 'kernova start', deploy: 'kernova deploy' }
    : { dev: 'kernova dev', build: 'kernova build', start: 'kernova start', deploy: 'kernova deploy' };

  return JSON.stringify({
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts,
    dependencies: deps,
    devDependencies: Object.keys(devDeps).length > 0 ? devDeps : undefined,
  }, null, 2) + '\n';
}

function tsconfigTemplate(framework: string): string {
  const lib = framework === 'none'
    ? ['ES2022']
    : ['ES2022', 'DOM', 'DOM.Iterable'];

  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib,
      // TypeScript 6 includes no @types packages unless listed
      types: ['node'],
      jsx: framework !== 'none' ? 'react-jsx' : undefined,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      declaration: true,
      sourceMap: true,
      paths: { '@/*': ['./*'] },
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'dist', '.next'],
  }, null, 2) + '\n';
}

function envTemplate(): string {
  return `# AI Model Configuration
OPENAI_API_KEY=your-openai-key-here

# Database (Memory v2 — supports PostgreSQL + pgvector or SQLite)
# Uncomment for PostgreSQL (recommended for production):
# DATABASE_URL=postgresql://user:password@host:5432/dbname

# Web Search (Tavily — get free key at https://tavily.com)
TAVILY_API_KEY=your-tavily-key-here
`;
}

function gitignoreTemplate(): string {
  return `node_modules/
dist/
.next/
.env.local
.env
*.db
*.db-shm
*.db-wal
kernova-data/
`;
}

// ─── Agent Templates ─────────────────────────────────────────────────────────

function assistantAgentTemplate(): string {
  return `import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Assistant',
  description: 'A helpful AI assistant',
  model: 'gpt-4o',
  instructions: \`
    You are a helpful AI assistant powered by Kernova.
    Be concise, friendly, and accurate in your responses.
    Use your tools when needed to provide better answers.
  \`,
  tools: ['web-search'],
  memory: {
    type: 'conversational',
    ttl: '7d',
  },
});
`;
}

function supportAgentTemplate(): string {
  return `import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Support Agent',
  description: 'Handles customer support inquiries',
  model: 'gpt-4o',
  instructions: \`
    You are a customer support agent. Help users resolve their issues.
    Search the knowledge base before answering.
    If you cannot resolve the issue, offer to escalate.
  \`,
  tools: ['search-kb'],
  memory: {
    type: 'conversational',
    ttl: '30d',
  },
});
`;
}

function researcherAgentTemplate(): string {
  return `import { defineAgent } from '@kernova/framework';

export default defineAgent({
  name: 'Researcher',
  description: 'Researches topics and provides summaries',
  model: 'gpt-4o',
  instructions: \`
    You are a research assistant. When given a topic, search the web
    for current information and provide a clear, sourced summary.
  \`,
  tools: ['web-search'],
  memory: {
    type: 'persistent',
    ttl: '90d',
  },
});
`;
}

// ─── Tool Templates ──────────────────────────────────────────────────────────

function webSearchToolTemplate(): string {
  return `import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'web-search',
  description: 'Search the web for current, real-time information. Returns titles, URLs, and content snippets from search results.',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query',
      required: true,
    },
  },
  execute: async ({ query }, ctx) => {
    ctx.log(\`Searching web for: \${query}\`);

    // If Tavily key is available, use it (better results)
    const tavilyKey = ctx.env.TAVILY_API_KEY;
    if (tavilyKey && tavilyKey !== 'your-tavily-key-here') {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: query as string,
            max_results: 5,
            include_answer: true,
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          return {
            answer: data.answer || null,
            results: (data.results || []).map((r: any) => ({
              title: r.title,
              url: r.url,
              content: r.content?.slice(0, 300),
            })),
          };
        }
      } catch {}
    }

    // Fallback: DuckDuckGo instant answer API (free, no key needed)
    try {
      const encoded = encodeURIComponent(query as string);
      const res = await fetch(\`https://api.duckduckgo.com/?q=\${encoded}&format=json&no_html=1&skip_disambig=1\`);
      if (res.ok) {
        const data = await res.json() as any;
        const results: Array<{ title: string; url: string; content: string }> = [];

        // Abstract (main answer)
        if (data.Abstract) {
          results.push({ title: data.Heading || 'Answer', url: data.AbstractURL || '', content: data.Abstract });
        }

        // Related topics
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 5)) {
            if (topic.Text && topic.FirstURL) {
              results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, content: topic.Text });
            }
          }
        }

        if (results.length > 0) {
          return { answer: data.Abstract || null, results };
        }
      }
    } catch {}

    // Final fallback: scrape DuckDuckGo HTML
    try {
      const encoded = encodeURIComponent(query as string);
      const res = await fetch(\`https://html.duckduckgo.com/html/?q=\${encoded}\`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KernovaBot/1.0)' },
      });
      if (res.ok) {
        const html = await res.text();
        const results: Array<{ title: string; url: string; content: string }> = [];

        // Simple regex extraction of search results
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\\/a>[\\s\\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)/g;
        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
          results.push({
            title: match[2].trim(),
            url: match[1],
            content: match[3].trim(),
          });
        }

        // Alternative simpler extraction
        if (results.length === 0) {
          const snippetRegex = /class="result__snippet"[^>]*>([^<]+)/g;
          const titleRegex = /class="result__a"[^>]*>([^<]+)/g;
          const titles: string[] = [];
          const snippets: string[] = [];
          let m;
          while ((m = titleRegex.exec(html)) !== null) titles.push(m[1]);
          while ((m = snippetRegex.exec(html)) !== null) snippets.push(m[1]);
          for (let i = 0; i < Math.min(titles.length, snippets.length, 5); i++) {
            results.push({ title: titles[i], url: '', content: snippets[i] });
          }
        }

        if (results.length > 0) {
          return { results };
        }
      }
    } catch {}

    return { results: [], message: 'No results found. Try a different query.' };
  },
});
`;
}

function searchKbToolTemplate(): string {
  return `import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'search-kb',
  description: 'Search the internal knowledge base',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query for the knowledge base',
      required: true,
    },
  },
  execute: async ({ query }, ctx) => {
    ctx.log(\`Searching knowledge base: \${query}\`);

    // TODO: Connect to your knowledge base
    return {
      articles: [
        { title: 'Getting Started', content: 'Welcome to our product...' },
      ],
    };
  },
});
`;
}

// ─── Memory Template ─────────────────────────────────────────────────────────

function memoryTemplate(): string {
  return `import { defineMemoryConfig } from '@kernova/framework';

/**
 * Memory configuration for this project.
 * 
 * The Memory Engine v2 provides:
 * - Working Memory: In-process cache (task state, tool outputs)
 * - Session Memory: Conversation threads with auto-compaction
 * - Long-term Memory: Vector-indexed facts with scored retrieval
 *
 * Adapters: 'postgres' (production), 'sqlite' (local), 'memory' (testing)
 */
export default defineMemoryConfig({
  adapter: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
  url: process.env.DATABASE_URL,
  path: './kernova-data/memory.db',
  
  embedding: {
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },

  scoring: {
    similarityWeight: 0.5,
    recencyWeight: 0.25,
    frequencyWeight: 0.1,
    relevanceWeight: 0.15,
    recencyHalfLife: 168,
  },

  compaction: {
    enabled: true,
    threshold: 50,
    keepRecent: 10,
  },
});
`;
}

// ─── Frontend Templates ──────────────────────────────────────────────────────

function layoutTemplate(name: string): string {
  return `import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata = {
  title: '${name}',
  description: 'Powered by Kernova',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
`;
}

function providersTemplate(): string {
  return `'use client';

import { KernovaProvider } from '@kernova/framework/react';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <KernovaProvider>
      {children}
    </KernovaProvider>
  );
}
`;
}

function homePageTemplate(name: string): string {
  return landingPage(name);
}

function chatPageTemplate(): string {
  return chatPage;
}

function globalsCssTemplate(): string {
  return globalsCss;
}

function postcssTemplate(): string {
  return `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`;
}
function nextConfigTemplate(): string {
  return `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Proxy agent API requests to Kernova backend in development.
  // In production on Kernova Cloud, the gateway handles this routing.
  async rewrites() {
    const kernova_url = process.env.KERNOVA_URL || 'http://localhost:4555';
    return [
      {
        source: '/api/agents/:path*',
        destination: \`\${kernova_url}/agents/:path*\`,
      },
      {
        source: '/api/memory/:path*',
        destination: \`\${kernova_url}/memory/:path*\`,
      },
      {
        source: '/api/threads/:path*',
        destination: \`\${kernova_url}/threads/:path*\`,
      },
      {
        source: '/v1/:path*',
        destination: \`\${kernova_url}/v1/:path*\`,
      },
    ];
  },
};

export default nextConfig;
`;
}


// ─── React (Vite) Templates ─────────────────────────────────────────────────

function reactIndexHtml(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function viteConfigTemplate(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api/agents': 'http://localhost:4555',
      '/agents': 'http://localhost:4555',
      '/memory': 'http://localhost:4555',
      '/threads': 'http://localhost:4555',
      '/health': 'http://localhost:4555',
    },
  },
});
`;
}

function reactMainTemplate(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;
}

function reactAppTemplate(name: string): string {
  return `import Chat from './Chat';

export default function App() {
  return (
    <div className="app">
      <Chat />
    </div>
  );
}
`;
}

function reactChatTemplate(): string {
  return `import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { id: \`u_\${Date.now()}\`, role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/agents/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: userMsg.content, threadId: 'main' }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { id: \`a_\${Date.now()}\`, role: 'assistant', content: data.content || '' }]);
    } catch {
      setMessages(prev => [...prev, { id: \`a_\${Date.now()}\`, role: 'assistant', content: 'Error connecting to server.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>AI Assistant</h1>
        <span className="status">{loading ? 'Thinking...' : 'Ready'}</span>
      </header>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            <p>Start a conversation with your AI agent.</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={\`message \${msg.role}\`}>
            <p>{msg.content}</p>
          </div>
        ))}
        {loading && <div className="message assistant loading"><p>...</p></div>}
      </div>

      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Type a message..."
          disabled={loading}
        />
        <button onClick={send} disabled={!input.trim() || loading}>Send</button>
      </div>
    </div>
  );
}
`;
}

function reactCssTemplate(): string {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0a0a0a;
  color: #fafafa;
}

.chat-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.chat-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #222;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-header h1 { font-size: 1rem; font-weight: 600; }
.chat-header .status { font-size: 0.75rem; color: #888; }

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
  max-width: 48rem;
  margin: 0 auto;
  width: 100%;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
}

.message {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  max-width: 80%;
}

.message.user {
  background: #7c3aed;
  color: white;
  margin-left: auto;
}

.message.assistant {
  background: #1a1a2e;
}

.message.loading { opacity: 0.6; }

.input-area {
  padding: 1rem;
  border-top: 1px solid #222;
  display: flex;
  gap: 0.5rem;
  max-width: 48rem;
  margin: 0 auto;
  width: 100%;
}

.input-area input {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  border: 1px solid #333;
  background: #111;
  color: white;
  font-size: 0.875rem;
  outline: none;
}

.input-area input:focus { border-color: #7c3aed; }

.input-area button {
  padding: 0.75rem 1.5rem;
  border-radius: 0.75rem;
  background: #7c3aed;
  color: white;
  border: none;
  font-size: 0.875rem;
  cursor: pointer;
}

.input-area button:disabled { opacity: 0.3; cursor: not-allowed; }
`;
}

// ─── Multi-Agent Team Template ──────────────────────────────────────────────

function teamTemplate(): string {
  return `import { defineTeam } from '@kernova/framework';

export default defineTeam({
  name: 'Main Team',
  description: 'Support + Research team with delegation',
  strategy: 'hierarchical',
  members: [
    {
      agent: 'support',
      role: 'lead',
      description: 'Handles user queries, delegates research tasks',
      canDelegate: true,
    },
    {
      agent: 'researcher',
      role: 'member',
      description: 'Searches the web and provides research findings',
      specialization: ['research', 'search', 'data'],
    },
  ],
});
`;
}
