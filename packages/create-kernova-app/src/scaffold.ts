/**
 * Project scaffolding — generates the full directory structure.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

  if (framework !== 'none') {
    dirs.push('app', 'app/chat');
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
  } else {
    writeFileSync(join(directory, 'agents', 'assistant.agent.ts'), assistantAgentTemplate());
    writeFileSync(join(directory, 'agents', 'tools', 'web-search.ts'), webSearchToolTemplate());
  }

  // Memory
  writeFileSync(join(directory, 'memory', 'conversations.ts'), memoryTemplate());

  // Frontend
  if (framework === 'next') {
    writeFileSync(join(directory, 'app', 'layout.tsx'), layoutTemplate(name));
    writeFileSync(join(directory, 'app', 'page.tsx'), homePageTemplate(name));
    writeFileSync(join(directory, 'app', 'chat', 'page.tsx'), chatPageTemplate());
    writeFileSync(join(directory, 'app', 'globals.css'), globalsCssTemplate());
    writeFileSync(join(directory, 'next.config.ts'), nextConfigTemplate());
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
    provider: 'local',
    embeddingModel: 'text-embedding-3-small',
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
    '@kernova/framework': '^0.1.0',
    '@kernova/core': '^0.2.0',
    '@kernova/cli': '^0.2.0',
  };

  const devDeps: Record<string, string> = {
    'typescript': '^5.5.0',
    '@types/node': '^22.0.0',
    '@types/react': '^19.0.0',
  };

  if (framework === 'next') {
    deps['next'] = '^16.0.0';
    deps['react'] = '^19.0.0';
    deps['react-dom'] = '^19.0.0';
  }

  return JSON.stringify({
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'kernova dev',
      build: 'kernova build',
      start: 'kernova start',
      deploy: 'kernova deploy',
    },
    dependencies: deps,
    devDependencies: devDeps,
  }, null, 2) + '\n';
}

function tsconfigTemplate(framework: string): string {
  const lib = framework === 'none'
    ? ['ES2022']
    : ['ES2022', 'DOM', 'DOM.Iterable'];

  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib,
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

# Kernova
# KERNOVA_URL=https://your-app.kernova.app  (set after deploying)
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
  description: 'Search the web for current information',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query',
      required: true,
    },
    limit: {
      type: 'number',
      description: 'Max results to return',
      default: 5,
    },
  },
  execute: async ({ query, limit }, ctx) => {
    ctx.log(\`Searching for: \${query}\`);

    // TODO: Replace with your preferred search API
    return {
      results: [
        { title: \`Result for "\${query}"\`, url: 'https://example.com', snippet: 'Example result' },
      ],
    };
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
  return `import { defineMemory } from '@kernova/framework';

export default defineMemory({
  name: 'conversations',
  schema: {
    summary: { type: 'text', indexed: true },
    userId: { type: 'text', indexed: true, required: true },
    sentiment: { type: 'text' },
    topics: { type: 'json' },
  },
  ttl: '30d',
  autoSummarize: true,
});
`;
}

// ─── Frontend Templates ──────────────────────────────────────────────────────

function layoutTemplate(name: string): string {
  return `import { KernovaProvider } from '@kernova/framework/react';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '${name}',
  description: 'Powered by Kernova',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <KernovaProvider>
          {children}
        </KernovaProvider>
      </body>
    </html>
  );
}
`;
}

function homePageTemplate(name: string): string {
  return `import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="container">
      <h1>${name}</h1>
      <p>Your AI-powered app is running. Agents are ready.</p>
      <Link href="/chat" className="btn">
        Open Chat →
      </Link>
    </main>
  );
}
`;
}

function chatPageTemplate(): string {
  return `'use client';

import { useAgentStream } from '@kernova/framework/react';
import { useState, useRef, useEffect } from 'react';

export default function ChatPage() {
  const { messages, send, isStreaming, streamingContent } = useAgentStream('assistant');
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    <main className="chat-container">
      <header className="chat-header">
        <h1>Chat</h1>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Send a message to start talking to your agent.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={\`message \${msg.role}\`}>
            <div className="message-role">{msg.role === 'user' ? 'You' : 'Agent'}</div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {isStreaming && (
          <div className="message assistant streaming">
            <div className="message-role">Agent</div>
            <div className="message-content">{streamingContent || '...'}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
          autoFocus
        />
        <button type="submit" disabled={isStreaming || !input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
`;
}

function globalsCssTemplate(): string {
  return `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #fafafa;
  color: #111;
}

.container {
  max-width: 600px;
  margin: 0 auto;
  padding: 4rem 2rem;
  text-align: center;
}

.container h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

.container p {
  color: #666;
  margin-bottom: 2rem;
}

.btn {
  display: inline-block;
  padding: 0.75rem 2rem;
  background: #000;
  color: #fff;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.btn:hover {
  opacity: 0.8;
}

/* Chat Page */
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 800px;
  margin: 0 auto;
}

.chat-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #eee;
}

.chat-header h1 {
  font-size: 1.25rem;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}

.message {
  margin-bottom: 1.5rem;
  max-width: 80%;
}

.message.user {
  margin-left: auto;
}

.message-role {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #999;
  margin-bottom: 0.25rem;
}

.message-content {
  padding: 0.75rem 1rem;
  border-radius: 12px;
  line-height: 1.5;
}

.message.user .message-content {
  background: #000;
  color: #fff;
}

.message.assistant .message-content {
  background: #f0f0f0;
}

.message.streaming .message-content {
  opacity: 0.7;
}

.input-form {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #eee;
}

.input-form input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.input-form input:focus {
  border-color: #000;
}

.input-form button {
  padding: 0.75rem 1.5rem;
  background: #000;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.input-form button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.input-form button:hover:not(:disabled) {
  opacity: 0.8;
}
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
