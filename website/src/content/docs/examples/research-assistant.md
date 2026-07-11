---
title: "Research Assistant"
description: RAG-powered research agent that ingests documents, searches the web, and produces cited reports.
---

A research assistant that accepts research requests over HTTP, ingests reference documents, searches the web for current information, uses a plan-and-execute pattern for multi-step research, self-reflects on report quality, and saves the final cited report to disk. It combines RAG retrieval, web search, and structured planning to produce thorough, sourced reports.

---

## Project Structure

```
research-assistant/
├── src/
│   └── index.ts          # Main application entry point
├── docs/                  # Reference documents to ingest
│   ├── company-brief.md
│   └── style-guide.md
├── reports/               # Generated reports saved here
├── package.json
├── tsconfig.json
└── .env
```

---

## Setup

```bash
mkdir research-assistant && cd research-assistant
npm init -y
npm install @kernova/sdk @kernova/core
npm install -D typescript @types/node
npx tsc --init
mkdir docs reports
```

### Environment Variables

Create a `.env` file:

```env
OPENAI_API_KEY=sk-...
GATEWAY_PORT=8080           # HTTP API port for research requests
REPORTS_DIR=./reports       # Directory for saved reports
```

---

## Full Source Code

```typescript
// src/index.ts
import { Kernova } from '@kernova/sdk';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const REPORTS_DIR = process.env.REPORTS_DIR || './reports';
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 8080;

async function main() {
  // ─── 1. Initialize Kernova with web search and file tools ─────
  const app = await Kernova.create({
    env: 'production',
    dataDir: './research-data',
    builtInTools: {
      enabled: ['web-search', 'http-fetch', 'file-write', 'date-time'],
      sandboxDir: REPORTS_DIR,
    },
  });

  // Ensure reports directory exists
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

  // ─── 2. Ingest reference documents via RAG ────────────────────
  // Load all markdown files from the docs/ directory
  const docsDir = './docs';
  if (existsSync(docsDir)) {
    const docFiles = readdirSync(docsDir).filter(f => f.endsWith('.md'));
    const kernel = app.getKernel();

    for (const file of docFiles) {
      const content = readFileSync(join(docsDir, file), 'utf-8');
      await kernel.rag.ingest(content, file, {
        category: 'reference',
        chunkStrategy: 'recursive',
        chunkSize: 512,
        chunkOverlap: 50,
      });
      console.log(`[RAG] Ingested: ${file}`);
    }

    const stats = kernel.rag.stats();
    console.log(`[RAG] ${stats.documents} documents, ${stats.chunks} chunks indexed`);
  }

  // ─── 3. Define the research agent ─────────────────────────────
  app.agent('researcher', {
    instructions: `You are a thorough research assistant.
Your process for every research request:
1. Break the topic into 3-5 specific sub-questions
2. Search the web for each sub-question using web-search
3. Cross-reference findings with ingested reference documents
4. Synthesize findings into a structured report

Report format:
- Executive Summary (2-3 sentences)
- Key Findings (bullet points with citations)
- Detailed Analysis (organized by sub-topic)
- Sources (numbered list of URLs/documents used)

Rules:
- Always cite sources with [1], [2], etc. notation
- Distinguish between facts (from sources) and analysis (your synthesis)
- Flag areas where sources conflict or information is uncertain
- Never fabricate citations or URLs`,
    description: 'Multi-step research with web search and document retrieval',
    tools: ['web-search', 'http-fetch'],
  });

  // ─── 4. Define the quality reviewer agent ─────────────────────
  app.agent('quality-reviewer', {
    instructions: `You are a research quality reviewer.
Evaluate research reports on these criteria:
- Completeness: Does it address all aspects of the research question?
- Accuracy: Are claims properly supported by cited sources?
- Clarity: Is the report well-organized and easy to follow?
- Citations: Are all factual claims cited? Are sources credible?

Score each criterion 1-5 and provide specific improvement suggestions.
If the overall score is below 3.5/5, recommend specific revisions.

Output format:
SCORE: X.X/5
COMPLETENESS: X/5 - brief note
ACCURACY: X/5 - brief note
CLARITY: X/5 - brief note
CITATIONS: X/5 - brief note
VERDICT: PASS | NEEDS_REVISION
SUGGESTIONS: (if revision needed)`,
    description: 'Quality control for research reports',
  });

  // ─── 5. Custom tool: save report to file ──────────────────────
  app.tool('save-report', {
    description: 'Save a research report to the reports directory',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename (without extension)' },
        content: { type: 'string', description: 'Full report content in Markdown' },
        metadata: {
          type: 'object',
          description: 'Report metadata (topic, date, sources count)',
        },
      },
    },
    execute: async (params) => {
      const { filename, content, metadata } = params as {
        filename: string;
        content: string;
        metadata?: Record<string, unknown>;
      };

      const safeName = filename.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      const filepath = join(REPORTS_DIR, `${safeName}.md`);

      const header = [
        '---',
        `title: "${metadata?.topic || filename}"`,
        `generated: "${new Date().toISOString()}"`,
        `sources: ${metadata?.sourcesCount || 'unknown'}`,
        '---',
        '',
      ].join('\n');

      const { writeFileSync } = await import('fs');
      writeFileSync(filepath, header + content, 'utf-8');

      return { saved: true, path: filepath, size: content.length };
    },
  });

  // ─── 6. Memory for tracking research findings ─────────────────
  // Store key findings so future research can build on past work
  app.tool('store-finding', {
    description: 'Store a key research finding for future reference',
    parameters: {
      type: 'object',
      properties: {
        finding: { type: 'string', description: 'The research finding to store' },
        topic: { type: 'string', description: 'Research topic category' },
        confidence: { type: 'number', description: 'Confidence level 0-1' },
      },
    },
    execute: async (params) => {
      const { finding, topic, confidence } = params as {
        finding: string;
        topic: string;
        confidence?: number;
      };

      await app.remember(
        `Research finding [${topic}]: ${finding}`,
        'longterm',
        ['research-finding', topic],
      );
      return { stored: true, topic, confidence };
    },
  });

  // ─── 7. The research workflow (plan → execute → reflect) ──────
  async function conductResearch(topic: string, depth: 'quick' | 'thorough' = 'thorough') {
    console.log(`[RESEARCH] Starting: "${topic}" (${depth})`);
    const startTime = Date.now();

    // Step 1: Recall any previous research on this topic
    const priorFindings = await app.recall(topic, { layer: 'longterm', limit: 10 });
    const priorContext = priorFindings.length > 0
      ? `\nPrior research on this topic:\n${priorFindings.map(f => `- ${f.content}`).join('\n')}`
      : '';

    // Step 2: Plan and execute the research using multi-step planning
    const maxSteps = depth === 'thorough' ? 8 : 4;
    const planResult = await app.plan(
      `Research the following topic thoroughly: "${topic}"
       ${priorContext}

       Steps to follow:
       1. Use web-search to find current information about this topic
       2. Search for 2-3 different angles or sub-topics
       3. Check ingested reference documents for relevant context
       4. Compile findings with proper citations
       5. Write a structured report following the standard format
       
       Use web-search and http-fetch tools to gather real information.
       Do NOT fabricate sources or URLs.`,
      { maxSteps },
    );

    console.log(`[RESEARCH] Plan completed: ${planResult.success ? 'success' : 'partial'}`);

    // Step 3: Generate the final report
    const { answer: report } = await app.ask(
      `Based on the research just conducted on "${topic}", write a final research report.
       
       Include all findings with proper [1], [2] citation notation.
       Follow the standard report format: Executive Summary, Key Findings, 
       Detailed Analysis, and Sources list.
       ${priorContext}`,
      { type: 'action', priority: 'high' },
    );

    // Step 4: Self-reflection — quality review
    const { answer: review } = await app.ask(
      `Review this research report for quality:
       
       TOPIC: ${topic}
       
       REPORT:
       ${report}
       
       Evaluate completeness, accuracy, clarity, and citation quality.
       Provide your SCORE and VERDICT.`,
      { type: 'query', priority: 'medium' },
    );

    console.log(`[QUALITY] Review:\n${review.slice(0, 200)}`);

    // Step 5: If quality is low, revise
    let finalReport = report;
    if (review.includes('NEEDS_REVISION')) {
      console.log('[QUALITY] Revision needed, improving report...');
      const { answer: revised } = await app.ask(
        `The research report on "${topic}" needs revision based on this feedback:
         ${review}
         
         Original report:
         ${report}
         
         Please produce an improved version addressing all feedback points.`,
        { type: 'action', priority: 'high' },
      );
      finalReport = revised;
    }

    // Step 6: Save the report
    const { answer: saveConfirm } = await app.ask(
      `Use the save-report tool to save this research report:
       Filename: ${topic.toLowerCase().replace(/\s+/g, '-')}
       Content: ${finalReport}
       Metadata: { "topic": "${topic}", "sourcesCount": 5 }`,
      { type: 'action', priority: 'medium' },
    );

    // Step 7: Store key findings for future research
    await app.remember(
      `Completed research on "${topic}" (${depth}). Key takeaway: ${finalReport.slice(0, 200)}`,
      'longterm',
      ['research-completed', topic],
    );

    const durationMs = Date.now() - startTime;
    console.log(`[RESEARCH] Completed in ${(durationMs / 1000).toFixed(1)}s`);

    return { report: finalReport, review, durationMs };
  }

  // ─── 8. API Gateway for accepting research requests ───────────
  // Exposes an HTTP endpoint: POST /research { "topic": "...", "depth": "quick|thorough" }
  const kernel = app.getKernel();
  kernel.gateway.expose({
    port: GATEWAY_PORT,
    routes: [
      {
        method: 'POST',
        path: '/research',
        handler: async (req) => {
          const { topic, depth } = req.body as { topic: string; depth?: 'quick' | 'thorough' };
          if (!topic) {
            return { status: 400, body: { error: 'Missing "topic" field' } };
          }

          // Run research asynchronously and return a task ID
          const taskId = await app.enqueue('research-job', { topic, depth: depth || 'thorough' });
          return {
            status: 202,
            body: { taskId, message: `Research started: "${topic}"`, status: 'processing' },
          };
        },
      },
      {
        method: 'GET',
        path: '/reports',
        handler: async () => {
          const files = existsSync(REPORTS_DIR)
            ? readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md'))
            : [];
          return { status: 200, body: { reports: files, count: files.length } };
        },
      },
    ],
  });

  // ─── 9. Task queue handler for research jobs ──────────────────
  kernel.taskQueue.registerHandler('research-job', async (task) => {
    const { topic, depth } = task.payload as { topic: string; depth: 'quick' | 'thorough' };
    await conductResearch(topic, depth);
  });

  // ─── 10. Start the daemon ─────────────────────────────────────
  console.log('📚 Research Assistant starting...');
  console.log(`   API Gateway on port ${GATEWAY_PORT}`);
  console.log(`   POST /research { "topic": "...", "depth": "quick|thorough" }`);
  console.log(`   GET  /reports`);
  console.log(`   Reports saved to: ${REPORTS_DIR}`);

  await app.serve({
    shutdownTimeoutMs: 60_000, // Research tasks can take a while
    heartbeatIntervalMs: 30_000,
  });
}

main().catch(console.error);
```

---

## Testing It

Submit a research request via the API:

```bash
# Start a research job
curl -X POST http://localhost:8080/research \
  -H "Content-Type: application/json" \
  -d '{"topic": "Best practices for LLM-powered agents in production", "depth": "thorough"}'

# Check generated reports
curl http://localhost:8080/reports
```

Add reference documents to the `docs/` folder before starting — the agent will cross-reference them during research:

```bash
echo "# Company Brief\nWe build developer tools..." > docs/company-brief.md
echo "# Style Guide\nReports should be concise..." > docs/style-guide.md
```

---

## What This Demonstrates

| Feature | Guide |
|---------|-------|
| RAG pipeline (document ingestion & retrieval) | [Context & Memory](/guides/context-memory#rag-pipeline) |
| Built-in web-search tool | [Built-in Tools](/guides/tools#built-in-tools) |
| Plan-and-execute pattern | [Intelligence Modules](/guides/intelligence#plan-and-execute) |
| Self-reflection for quality control | [Intelligence Modules](/guides/intelligence#self-reflection) |
| Long-term memory for research findings | [Context & Memory](/guides/context-memory) |
| File-write tool for saving reports | [Built-in Tools](/guides/tools#built-in-tools) |
| API Gateway for HTTP access | [Gateway](/guides/gateway) |
| Task queue for async job processing | [Task Queue](/guides/task-queue) |
| Multi-agent (researcher + reviewer) | [Building Agents](/guides/agents) |
