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
    writeFileSync(join(directory, 'app', 'providers.tsx'), providersTemplate());
    writeFileSync(join(directory, 'app', 'page.tsx'), homePageTemplate(name));
    writeFileSync(join(directory, 'app', 'chat', 'page.tsx'), chatPageTemplate());
    writeFileSync(join(directory, 'app', 'globals.css'), globalsCssTemplate());
    writeFileSync(join(directory, 'next.config.ts'), nextConfigTemplate());
    writeFileSync(join(directory, 'postcss.config.mjs'), postcssTemplate());
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
    '@kernova/framework': '^1.0.0',
    '@kernova/core': '^1.0.0',
    '@kernova/cli': '^1.0.0',
  };

  const devDeps: Record<string, string> = {};

  if (framework === 'next') {
    deps['next'] = '^16.0.0';
    deps['react'] = '^19.0.0';
    deps['react-dom'] = '^19.0.0';
    deps['@tailwindcss/postcss'] = '^4';
    deps['tailwindcss'] = '^4';
    deps['typescript'] = '^5.5.0';
    deps['@types/node'] = '^22.0.0';
    deps['@types/react'] = '^19.0.0';
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

# Web Search (Tavily — get free key at https://tavily.com)
TAVILY_API_KEY=your-tavily-key-here

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