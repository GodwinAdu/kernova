/**
 * scaffold — Creates the project directory structure and files.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface ScaffoldOptions {
  name: string;
  directory?: string;
  template?: 'default' | 'minimal' | 'multi-agent';
  framework?: 'next' | 'react' | 'none';
}

export function scaffoldProject(options: ScaffoldOptions): void {
  const { name, template = 'default', framework = 'next' } = options;
  const projectDir = options.directory || resolve(process.cwd(), name);

  if (existsSync(projectDir)) {
    throw new Error(`Directory "${name}" already exists`);
  }

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
    mkdirSync(join(projectDir, dir), { recursive: true });
  }

  // Write kernova.config.ts
  writeFileSync(join(projectDir, 'kernova.config.ts'), generateConfig(name, framework));

  // Write package.json
  writeFileSync(join(projectDir, 'package.json'), generatePackageJson(name, framework));

  // Write tsconfig.json
  writeFileSync(join(projectDir, 'tsconfig.json'), generateTsConfig());

  // Write .env.local
  writeFileSync(join(projectDir, '.env.local'), generateEnv());

  // Write .gitignore
  writeFileSync(join(projectDir, '.gitignore'), generateGitignore());

  // Write starter agent
  writeFileSync(join(projectDir, 'agents', 'assistant.agent.ts'), generateStarterAgent());

  // Write starter tool
  writeFileSync(join(projectDir, 'agents', 'tools', 'web-search.ts'), generateStarterTool());

  // Write memory schema
  writeFileSync(join(projectDir, 'memory', 'conversations.ts'), generateMemorySchema());

  // Write frontend files (if applicable)
  if (framework === 'next') {
    writeFileSync(join(projectDir, 'app', 'layout.tsx'), generateLayout(name));
    writeFileSync(join(projectDir, 'app', 'page.tsx'), generateHomePage(name));
    writeFileSync(join(projectDir, 'app', 'chat', 'page.tsx'), generateChatPage());
    writeFileSync(join(projectDir, 'next.config.ts'), generateNextConfig());
  }
}

// --- Template generators ---

function generateConfig(name: string, framework: string): string {
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

function generatePackageJson(name: string, framework: string): string {
  const deps: Record<string, string> = {
    '@kernova/framework': '^0.1.0',
    '@kernova/core': '^0.2.0',
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

function generateTsConfig(): string {
  return JSON.stringify({
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
      declaration: true,
      sourceMap: true,
      paths: {
        '@/*': ['./*'],
      },
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'dist', '.next'],
  }, null, 2) + '\n';
}

function generateEnv(): string {
  return `# AI Model API Keys
OPENAI_API_KEY=your-openai-key-here

# Kernova Cloud (after deploying)
# KERNOVA_URL=https://your-app.kernova.app
`;
}

function generateGitignore(): string {
  return `node_modules/
dist/
.next/
.env.local
.env
*.db
*.db-shm
*.db-wal
`;
}

function generateStarterAgent(): string {
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

function generateStarterTool(): string {
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

    // Placeholder — replace with your search implementation
    return {
      results: [
        { title: \`Result for "\${query}"\`, url: 'https://example.com', snippet: 'Example result' },
      ],
    };
  },
});
`;
}

function generateMemorySchema(): string {
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

function generateLayout(name: string): string {
  return `import { KernovaProvider } from '@kernova/framework/react';
import type { ReactNode } from 'react';

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

function generateHomePage(name: string): string {
  return `import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>${name}</h1>
      <p>Your AI-powered app is running.</p>
      <Link href="/chat">Open Chat →</Link>
    </main>
  );
}
`;
}

function generateChatPage(): string {
  return `'use client';

import { useAgentStream } from '@kernova/framework/react';
import { useState } from 'react';

export default function ChatPage() {
  const { messages, send, isStreaming, streamingContent } = useAgentStream('assistant');
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    send(input.trim());
    setInput('');
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1>Chat</h1>

      <div style={{ minHeight: '400px', border: '1px solid #eee', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: '1rem' }}>
            <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong>
            <p>{msg.content}</p>
          </div>
        ))}
        {isStreaming && (
          <div style={{ marginBottom: '1rem', opacity: 0.7 }}>
            <strong>Assistant:</strong>
            <p>{streamingContent}</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: '1px solid #ddd' }}
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '6px', background: '#000', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Send
        </button>
      </form>
    </main>
  );
}
`;
}

function generateNextConfig(): string {
  return `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Kernova Framework handles the agent backend proxy in dev
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: \`\${process.env.KERNOVA_URL || 'http://localhost:4555'}/:path*\`,
      },
      {
        source: '/agents/:path*',
        destination: \`\${process.env.KERNOVA_URL || 'http://localhost:4555'}/agents/:path*\`,
      },
      {
        source: '/memory/:path*',
        destination: \`\${process.env.KERNOVA_URL || 'http://localhost:4555'}/memory/:path*\`,
      },
    ];
  },
};

export default nextConfig;
`;
}
