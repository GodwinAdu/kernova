/**
 * kernova create
 *
 * Creates a new full-stack Kernova project (framework mode).
 * This is the modern alternative to `kernova init` — generates a full-stack
 * project with agents/ + app/ structure.
 *
 * Usage:
 *   kernova create my-app
 *   kernova create my-app --template multi-agent
 *   kernova create my-app --no-frontend
 */

import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { printBanner, success, info, error } from '../ui.js';

interface CreateOptions {
  name: string;
  template: 'default' | 'minimal' | 'multi-agent';
  framework: 'next' | 'react' | 'none';
  install: boolean;
}

function parseCreateArgs(args: string[]): CreateOptions {
  const options: CreateOptions = {
    name: '',
    template: 'default',
    framework: 'next',
    install: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--template' || arg === '-t') {
      const val = args[++i];
      if (val === 'minimal' || val === 'multi-agent' || val === 'default') {
        options.template = val;
      }
    } else if (arg === '--no-frontend') {
      options.framework = 'none';
    } else if (arg === '--react') {
      options.framework = 'react';
    } else if (arg === '--no-install') {
      options.install = false;
    } else if (!arg.startsWith('-') && !options.name) {
      options.name = arg;
    }
  }

  return options;
}

export async function handleCreate(args: string[]): Promise<void> {
  const options = parseCreateArgs(args);

  printBanner();

  if (!options.name) {
    error('Please provide a project name:');
    console.log('    kernova create my-app');
    console.log('');
    console.log('  Options:');
    console.log('    --template, -t   Template (default, minimal, multi-agent)');
    console.log('    --no-frontend    Agents only (no React frontend)');
    console.log('    --react          Use Vite + React instead of Next.js');
    console.log('    --no-install     Skip npm install');
    process.exit(1);
  }

  const projectDir = resolve(process.cwd(), options.name);

  if (existsSync(projectDir)) {
    error(`Directory "${options.name}" already exists.`);
    process.exit(1);
  }

  info(`Creating "${options.name}" (template: ${options.template}, framework: ${options.framework})`);
  console.log('');

  // Build directory structure
  const dirs = ['', 'agents', 'agents/tools', 'memory', 'middleware', 'public'];
  if (options.framework !== 'none') {
    dirs.push('app', 'app/chat');
  }

  for (const dir of dirs) {
    mkdirSync(resolve(projectDir, dir), { recursive: true });
  }

  // Write config
  writeFileSync(resolve(projectDir, 'kernova.config.ts'), `import { defineConfig } from '@kernova/framework/config';

export default defineConfig({
  name: '${options.name}',
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
    framework: '${options.framework}',
    port: 3000,
  },
});
`);

  // Write package.json
  const deps: Record<string, string> = {
    '@kernova/framework': '^0.1.0',
    '@kernova/core': '^0.2.0',
    '@kernova/cli': '^0.2.0',
  };

  if (options.framework === 'next') {
    deps['next'] = '^16.0.0';
    deps['react'] = '^19.0.0';
    deps['react-dom'] = '^19.0.0';
  }

  writeFileSync(resolve(projectDir, 'package.json'), JSON.stringify({
    name: options.name,
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
    devDependencies: {
      'typescript': '^5.5.0',
      '@types/node': '^22.0.0',
      '@types/react': '^19.0.0',
    },
  }, null, 2) + '\n');

  // Write tsconfig
  writeFileSync(resolve(projectDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      paths: { '@/*': ['./*'] },
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'dist', '.next'],
  }, null, 2) + '\n');

  // Write .env.local
  writeFileSync(resolve(projectDir, '.env.local'), `# AI Model Configuration
OPENAI_API_KEY=your-openai-key-here
`);

  // Write .gitignore
  writeFileSync(resolve(projectDir, '.gitignore'), `node_modules/
dist/
.next/
.env.local
.env
*.db
kernova-data/
`);

  // Write starter agent
  writeFileSync(resolve(projectDir, 'agents', 'assistant.agent.ts'), `import { defineAgent } from '@kernova/framework';

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
`);

  // Write starter tool
  writeFileSync(resolve(projectDir, 'agents', 'tools', 'web-search.ts'), `import { defineTool } from '@kernova/framework';

export default defineTool({
  name: 'web-search',
  description: 'Search the web for current information',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query',
      required: true,
    },
  },
  execute: async ({ query }, ctx) => {
    ctx.log(\`Searching for: \${query}\`);
    // TODO: Connect to your search API
    return { results: [] };
  },
});
`);

  // Write memory schema
  writeFileSync(resolve(projectDir, 'memory', 'conversations.ts'), `import { defineMemory } from '@kernova/framework';

export default defineMemory({
  name: 'conversations',
  schema: {
    summary: { type: 'text', indexed: true },
    userId: { type: 'text', indexed: true, required: true },
    sentiment: { type: 'text' },
  },
  ttl: '30d',
  autoSummarize: true,
});
`);

  // Write frontend (Next.js)
  if (options.framework === 'next') {
    writeFileSync(resolve(projectDir, 'next.config.ts'), `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const kernovaUrl = process.env.KERNOVA_URL || 'http://localhost:4555';
    return [
      { source: '/api/agents/:path*', destination: \`\${kernovaUrl}/agents/:path*\` },
      { source: '/api/memory/:path*', destination: \`\${kernovaUrl}/memory/:path*\` },
      { source: '/api/threads/:path*', destination: \`\${kernovaUrl}/threads/:path*\` },
      { source: '/v1/:path*', destination: \`\${kernovaUrl}/v1/:path*\` },
    ];
  },
};

export default nextConfig;
`);

    writeFileSync(resolve(projectDir, 'app', 'layout.tsx'), `import { KernovaProvider } from '@kernova/framework/react';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '${options.name}',
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
`);

    writeFileSync(resolve(projectDir, 'app', 'page.tsx'), `import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ padding: '4rem 2rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
      <h1>${options.name}</h1>
      <p style={{ color: '#666', margin: '1rem 0 2rem' }}>Your AI-powered app is running.</p>
      <Link href="/chat" style={{ padding: '0.75rem 2rem', background: '#000', color: '#fff', borderRadius: '8px', textDecoration: 'none' }}>
        Open Chat →
      </Link>
    </main>
  );
}
`);

    writeFileSync(resolve(projectDir, 'app', 'chat', 'page.tsx'), `'use client';

import { useAgentStream } from '@kernova/framework/react';
import { useState } from 'react';

export default function ChatPage() {
  const { messages, send, isStreaming, streamingContent } = useAgentStream('assistant');
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    send(input.trim());
    setInput('');
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: '800px', margin: '0 auto' }}>
      <header style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #eee' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Chat</h1>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: '1.5rem', maxWidth: '80%', marginLeft: msg.role === 'user' ? 'auto' : undefined }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#999', marginBottom: '0.25rem' }}>
              {msg.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              background: msg.role === 'user' ? '#000' : '#f0f0f0',
              color: msg.role === 'user' ? '#fff' : '#111',
            }}>
              {msg.content}
            </div>
          </div>
        ))}
        {isStreaming && (
          <div style={{ marginBottom: '1.5rem', opacity: 0.7 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#999', marginBottom: '0.25rem' }}>Agent</div>
            <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', background: '#f0f0f0' }}>
              {streamingContent || '...'}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', padding: '1rem 1.5rem', borderTop: '1px solid #eee' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
          style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid #ddd', borderRadius: '8px', fontSize: '1rem' }}
        />
        <button type="submit" disabled={isStreaming || !input.trim()} style={{ padding: '0.75rem 1.5rem', background: '#000', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          Send
        </button>
      </form>
    </main>
  );
}
`);

    writeFileSync(resolve(projectDir, 'app', 'globals.css'), `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
`);
  }

  success('Project structure created');

  // Git init
  try {
    execSync('git init', { cwd: projectDir, stdio: 'ignore' });
    execSync('git add -A', { cwd: projectDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit from kernova create"', { cwd: projectDir, stdio: 'ignore' });
    success('Git repository initialized');
  } catch {
    // Git not available
  }

  // Install
  if (options.install) {
    info('Installing dependencies...');
    try {
      execSync('npm install', { cwd: projectDir, stdio: 'pipe' });
      success('Dependencies installed');
    } catch {
      info('Could not install dependencies. Run "npm install" manually.');
    }
  }

  // Done
  console.log('');
  success(`Project "${options.name}" is ready!`);
  console.log('');
  info('Next steps:');
  console.log(`    cd ${options.name}`);
  console.log('    kernova dev');
  console.log('');
  info('This will start:');
  console.log('    • Your app at      http://localhost:3000');
  console.log('    • Agent API at     http://localhost:3000/api/agents/*');
  console.log('');
  info('When ready to ship:');
  console.log('    kernova deploy');
  console.log('');
}
